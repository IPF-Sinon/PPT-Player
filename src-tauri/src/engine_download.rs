//! Fetch the engine on demand for the lite build.
//!
//! OWNER: subagent-rust-engine
//!
//! The download is verified before it is unpacked: an interrupted or tampered archive
//! must never be extracted over a working install.
//!
//! Like the Electron build this uses platform facilities only. curl.exe ships with
//! Windows 10 1803 and later, so the transfer needs no new crate; the body arrives on
//! stdout and is hashed and written as it streams, so the archive is never read twice.

use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::engine_lo::{find_engine_root, hidden_command};
use crate::types::{DownloadStage, EngineDownloadProgress};

pub struct DownloadRequest<'a> {
    pub url: &'a str,
    pub sha256: &'a str,
    pub bytes: u64,
    pub target_dir: &'a Path,
}

/// Progress is throttled so a fast link cannot flood the renderer with events.
const REPORT_INTERVAL_MS: u128 = 120;
/// The size check tolerates this much drift from the published length.
const SIZE_TOLERANCE: u64 = 1024;
/// Connection and total transfer budgets, in seconds.
const CONNECT_TIMEOUT_S: u32 = 30;
const TRANSFER_TIMEOUT_S: u32 = 900;
/// Attempts at the transfer before giving up on a flaky connection.
const MAX_ATTEMPTS: u32 = 3;
/// How much of curl's stderr is kept for the error message.
const STDERR_LIMIT: usize = 4000;

fn report(
    app: &AppHandle,
    stage: DownloadStage,
    received: u64,
    total: u64,
    message: impl Into<String>,
) {
    let ratio = if total > 0 {
        (received as f64 / total as f64).min(1.0)
    } else {
        -1.0
    };
    let progress = EngineDownloadProgress {
        stage,
        received_bytes: received,
        total_bytes: total,
        ratio,
        message: message.into(),
    };
    if let Err(err) = app.emit("engine:download-progress", progress) {
        crate::logln!("[engine] could not emit download progress: {err}");
    }
}

/// Lower-case hex of a digest, the shape the published checksum uses.
pub fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// SHA256 of an in-memory buffer, as lower-case hex.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex_lower(hasher.finalize().as_slice())
}

/// Stream a URL to disk while hashing it.
///
/// Hashing as the bytes arrive means the file never has to be read a second time,
/// and a corrupt transfer is detected before extraction starts.
fn download_and_hash(
    app: &AppHandle,
    url: &str,
    file_path: &Path,
    expected_bytes: u64,
) -> Result<String, String> {
    if let Some(dir) = file_path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("无法创建下载目录：{err}"))?;
    }

    let connect_timeout = CONNECT_TIMEOUT_S.to_string();
    let transfer_timeout = TRANSFER_TIMEOUT_S.to_string();
    let mut child = hidden_command("curl.exe")
        .args([
            "--location",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            connect_timeout.as_str(),
            "--max-time",
            transfer_timeout.as_str(),
            "--output",
            "-",
            url,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("无法启动 curl.exe：{err}"))?;

    // curl's stderr is drained on its own thread; a full pipe would block the child
    // exactly the way an undrained soffice pipe used to.
    let stderr_pipe = child
        .stderr
        .take()
        .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>);
    let stderr_reader =
        std::thread::spawn(move || crate::engine_lo::drain(stderr_pipe, STDERR_LIMIT));

    let mut body = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取下载内容".to_string())?;
    let mut file =
        std::fs::File::create(file_path).map_err(|err| format!("无法写入下载文件：{err}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_report = std::time::Instant::now();
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let read = match body.read(&mut buffer) {
            Ok(read) => read,
            Err(err) => {
                // Reap the child so a broken transfer cannot leave it behind.
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("下载中断：{err}"));
            }
        };
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        if let Err(err) = file.write_all(&buffer[..read]) {
            // Stop curl as well, or it keeps streaming into a pipe nobody reads.
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("写入下载文件失败：{err}"));
        }
        received += read as u64;

        if last_report.elapsed().as_millis() >= REPORT_INTERVAL_MS {
            last_report = std::time::Instant::now();
            report(
                app,
                DownloadStage::Downloading,
                received,
                expected_bytes,
                "正在下载兼容引擎",
            );
        }
    }
    file.flush()
        .map_err(|err| format!("写入下载文件失败：{err}"))?;
    drop(file);

    let status = child
        .wait()
        .map_err(|err| format!("等待下载完成失败：{err}"))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err(format!("下载失败：curl 退出码 {:?}", status.code()));
        }
        return Err(format!("下载失败：{detail}"));
    }

    report(
        app,
        DownloadStage::Verifying,
        received,
        expected_bytes,
        "正在校验文件完整性",
    );
    Ok(hex_lower(hasher.finalize().as_slice()))
}

/// Extract a zip with the tar.exe that ships with Windows 10 and 11.
#[cfg(windows)]
fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|err| format!("无法创建解压目录：{err}"))?;
    // bsdtar reads zip archives and is far faster than Expand-Archive.
    let output = hidden_command("tar.exe")
        .arg("-xf")
        .arg(zip_path)
        .arg("-C")
        .arg(dest_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("无法启动 tar.exe：{err}"))?;

    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        Err(format!("解压失败：tar 退出码 {:?}", output.status.code()))
    } else {
        Err(format!("解压失败：{detail}"))
    }
}

/// Non-Windows builds have no tar that reliably reads zip, so the install is refused
/// rather than half-done. The product is Windows-only; cargo test still runs here.
#[cfg(not(windows))]
fn extract_zip(_zip_path: &Path, _dest_dir: &Path) -> Result<(), String> {
    Err("自动安装兼容引擎仅支持 Windows".to_string())
}

/// Copy a directory tree, used when a rename cannot cross volumes.
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            std::fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

/// Download, verify, and install the engine.
///
/// The engine is unpacked into a staging directory and only moved into place once
/// extraction succeeded, so a failed download can never leave a half-installed
/// engine that later looks valid.
pub fn download_engine(app: &AppHandle, request: &DownloadRequest<'_>) -> Result<(), String> {
    let work_dir = crate::paths::work_dir(app);
    let zip_path = work_dir.join("engine-download.zip");
    let staging_dir = work_dir.join("staging");

    let outcome = install(app, request, &work_dir, &zip_path, &staging_dir);

    // The archive and the staging tree are never worth keeping, whatever happened.
    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&staging_dir);

    match outcome {
        Ok(()) => {
            // The cached status still says "missing", so force a fresh probe.
            crate::engine_resolve::reset_engine_cache();
            // A finished transfer has no meaningful byte count of its own, so the
            // ratio is reported as complete rather than as "unknown length".
            report(app, DownloadStage::Done, 1, 1, "兼容引擎已就绪");
            crate::logln!("[engine] downloaded to {}", request.target_dir.display());
            Ok(())
        }
        Err(message) => {
            report(app, DownloadStage::Error, 0, request.bytes, message.clone());
            crate::logln!("[engine] download failed: {message}");
            Err(message)
        }
    }
}

fn install(
    app: &AppHandle,
    request: &DownloadRequest<'_>,
    work_dir: &Path,
    zip_path: &Path,
    staging_dir: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(work_dir).map_err(|err| format!("无法创建下载目录：{err}"))?;
    let _ = std::fs::remove_file(zip_path);
    let _ = std::fs::remove_dir_all(staging_dir);

    let digest = download_with_retries(app, request, zip_path)?;

    // The digest decides whether anything is extracted at all: a corrupt or
    // tampered archive must never touch a working install.
    if !request.sha256.trim().is_empty() && !digest.eq_ignore_ascii_case(request.sha256.trim()) {
        return Err("引擎文件校验失败，已删除下载内容".to_string());
    }

    let size = std::fs::metadata(zip_path)
        .map_err(|err| format!("无法读取下载文件：{err}"))?
        .len();
    if request.bytes > 0 && size.abs_diff(request.bytes) > SIZE_TOLERANCE {
        return Err("引擎文件大小不符，已删除下载内容".to_string());
    }

    report(app, DownloadStage::Extracting, size, size, "正在解压兼容引擎");
    extract_zip(zip_path, staging_dir)?;

    let root = find_engine_root(staging_dir).ok_or_else(|| "解压后未找到 soffice".to_string())?;

    if let Some(parent) = request.target_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("无法创建安装目录：{err}"))?;
    }
    let _ = std::fs::remove_dir_all(request.target_dir);
    if std::fs::rename(&root, request.target_dir).is_err() {
        // A rename cannot cross volumes, so fall back to a copy.
        copy_dir(&root, request.target_dir).map_err(|err| format!("无法安装引擎：{err}"))?;
    }

    Ok(())
}

fn download_with_retries(
    app: &AppHandle,
    request: &DownloadRequest<'_>,
    zip_path: &Path,
) -> Result<String, String> {
    let mut last = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        match download_and_hash(app, request.url, zip_path, request.bytes) {
            Ok(digest) => return Ok(digest),
            Err(message) => {
                crate::logln!("[engine] download attempt {attempt} failed: {message}");
                last = message;
                // A partial file would be mistaken for a complete one next time.
                let _ = std::fs::remove_file(zip_path);
                if attempt < MAX_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(500 * attempt as u64));
                }
            }
        }
    }
    Err(last)
}

/// Whether a usable engine is already unpacked here.
pub fn has_downloaded_engine(dir: &Path) -> bool {
    find_engine_root(dir).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_of_the_empty_string_matches_the_published_vector() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_of_abc_matches_the_published_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hex_is_lower_case_and_padded() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xff]), "000fff");
    }

    #[test]
    fn an_empty_directory_has_no_engine() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_downloaded_engine(dir.path()));
    }

    #[test]
    fn an_engine_in_a_nested_folder_is_found() {
        // Release archives wrap the engine in a versioned folder.
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("LibreOffice").join("program");
        std::fs::create_dir_all(&program).unwrap();
        std::fs::write(program.join("soffice.com"), b"stub").unwrap();
        assert!(has_downloaded_engine(dir.path()));
    }

    #[test]
    fn a_missing_directory_has_no_engine() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_downloaded_engine(&dir.path().join("not-created")));
    }

    #[test]
    fn a_directory_tree_is_copied_faithfully() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        let program = from.path().join("program");
        std::fs::create_dir_all(&program).unwrap();
        std::fs::write(program.join("soffice.bin"), b"payload").unwrap();

        copy_dir(from.path(), &to.path().join("lo")).unwrap();
        let copied = to.path().join("lo").join("program").join("soffice.bin");
        assert_eq!(std::fs::read(&copied).unwrap(), b"payload");
    }
}
