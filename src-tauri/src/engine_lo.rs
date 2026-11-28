//! Drive LibreOffice to convert a deck to PDF.
//!
//! OWNER: subagent-rust-engine
//!
//! Two things here are load-bearing and were found the hard way in the Electron build:
//! stdout must be a pipe that is drained (an undrained pipe deadlocks the child), and
//! the process needs its own profile directory, because a shared one makes concurrent
//! conversions block on each other.

use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use tauri::AppHandle;

/// A produced PDF smaller than this is not a real conversion result.
const MIN_PDF_BYTES: u64 = 1024;
/// How much of the child's stderr is kept for the error message.
const STDERR_LIMIT: usize = 8000;
/// How long to wait for the pipes to close once the process has exited.
const EXIT_GRACE_MS: u64 = 1_500;
/// Conversion budget: long enough for a big deck, short enough to fail visibly.
const CONVERT_TIMEOUT_MS: u64 = 60_000;
/// Reusable profile slots, enough for a couple of concurrent opens.
const PROFILE_SLOTS: usize = 2;
/// Marks a profile slot as in use.
const LOCK_FILE: &str = ".lock";
/// A lock older than this belongs to a run that died, so the slot is reclaimed.
const STALE_LOCK_MS: u64 = 15 * 60 * 1000;
/// How long the orphan cleanup may run before it is abandoned.
#[cfg(windows)]
const ORPHAN_KILL_TIMEOUT_MS: u64 = 5_000;

pub struct ConvertOptions {
    pub source: PathBuf,
    pub out_dir: PathBuf,
    /// Convert only the first N pages, for a fast first paint.
    pub first_pages: Option<u32>,
}

/// A Command that never flashes a console window on Windows.
///
/// Every child this crate starts goes through here, because a visible console flash
/// on each conversion is the kind of bug users report as "it flickers".
pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    // Only the Windows branch below mutates this, so silence the other platforms.
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Convert a path into a file:// URL that soffice accepts.
///
/// soffice parses -env:UserInstallation as a URL, so spaces, a hash, and any
/// non-ASCII byte in the user's profile path must be percent-encoded; a raw Windows
/// path makes it silently fall back to the shared profile.
pub fn to_file_url(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    if !raw.starts_with('/') {
        out.push('/');
    }
    for &byte in raw.as_bytes() {
        let keep = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/' | b':');
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Locate soffice inside a LibreOffice program directory.
pub fn soffice_in_program_dir(program_dir: &Path) -> Option<PathBuf> {
    for name in ["soffice.com", "soffice.exe"] {
        let candidate = program_dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Immediate sub-directories, used to pick a versioned engine folder.
pub fn list_subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect()
}

/// Find the directory that actually holds soffice.
///
/// Release archives differ in whether they wrap the engine in a top folder, so the
/// extracted tree is inspected instead of assumed.
pub fn find_engine_root(dir: &Path) -> Option<PathBuf> {
    find_engine_root_at(dir, 0)
}

fn find_engine_root_at(dir: &Path, depth: u32) -> Option<PathBuf> {
    if depth > 3 || !dir.is_dir() {
        return None;
    }
    if soffice_in_program_dir(dir).is_some() {
        return Some(dir.to_path_buf());
    }
    list_subdirs(dir)
        .into_iter()
        .find_map(|sub| find_engine_root_at(&sub, depth + 1))
}

/// Convert a deck to PDF, returning the produced file.
pub fn convert_to_pdf(app: &AppHandle, options: &ConvertOptions) -> Result<PathBuf, String> {
    let status = crate::engine_resolve::resolve_engine(app);
    if !status.available || status.path.is_empty() {
        let detail = if status.detail.is_empty() {
            "未找到 LibreOffice".to_string()
        } else {
            status.detail
        };
        return Err(format!("转换引擎不可用：{detail}"));
    }

    if options.first_pages.is_some() {
        // The headless converter has no page-range switch for PDF export, so the
        // whole deck is converted and the caller shows the first page as soon as
        // the PDF is complete.
        crate::logln!(
            "[convert] first_pages is not supported by soffice --convert-to; converting the whole deck"
        );
    }

    let out_dir = options.out_dir.clone();
    crate::paths::ensure_dir(&out_dir).map_err(|err| format!("无法创建缓存目录：{err}"))?;
    // A leftover PDF from an earlier run must never be mistaken for this run's
    // output, or a failed conversion would report success.
    let _ = std::fs::remove_file(out_dir.join("deck.pdf"));

    let profile_root = crate::paths::work_dir(app).join("lo-profiles");
    let profile_dir = pick_profile_dir(&profile_root)
        .map_err(|err| format!("无法准备 LibreOffice 配置目录：{err}"))?;
    let lock_path = profile_dir.join(LOCK_FILE);

    let result = run_conversion(
        Path::new(status.path.as_str()),
        &options.source,
        &out_dir,
        &profile_dir,
    );

    // Release the slot whatever happened, otherwise a failed run burns it forever.
    let _ = std::fs::remove_file(&lock_path);
    result
}

fn run_conversion(
    soffice: &Path,
    source: &Path,
    out_dir: &Path,
    profile_dir: &Path,
) -> Result<PathBuf, String> {
    let args = build_args(profile_dir, out_dir, source);
    let mut command = hidden_command(soffice);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| format!("无法启动 LibreOffice：{err}"))?;

    // Both pipes are read to the end on their own threads. A pipe nobody drains
    // fills its buffer and blocks the child, which is exactly how the conversion
    // used to hang forever.
    let (sender, receiver) = std::sync::mpsc::channel::<(u8, String)>();
    let stdout_pipe = child
        .stdout
        .take()
        .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>);
    let stderr_pipe = child
        .stderr
        .take()
        .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>);
    let stdout_sender = sender.clone();
    std::thread::spawn(move || {
        let text = drain(stdout_pipe, 0);
        let _ = stdout_sender.send((0, text));
    });
    let stderr_sender = sender.clone();
    std::thread::spawn(move || {
        let text = drain(stderr_pipe, STDERR_LIMIT);
        let _ = stderr_sender.send((1, text));
    });
    drop(sender);

    let deadline = Instant::now() + Duration::from_millis(CONVERT_TIMEOUT_MS);
    let mut timed_out = false;
    let mut exit_status = None;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_status = Some(status);
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("等待 LibreOffice 失败：{err}")),
        }
    }

    if timed_out {
        let _ = child.kill();
        // Reap the child before hunting the grandchildren, so the pid is not reused
        // under us while the profile is being cleaned up.
        let _ = child.wait();
        // soffice.com launches soffice.bin, so killing the child is not enough.
        kill_orphans(profile_dir);
    }

    // A stray grandchild can keep the inherited handles open, so the pipe close is
    // bounded rather than waited for forever.
    let mut stderr = String::new();
    let grace = Duration::from_millis(EXIT_GRACE_MS);
    for _ in 0..2 {
        match receiver.recv_timeout(grace) {
            Ok((1, text)) => stderr.push_str(&text),
            Ok(_) => {}
            Err(_) => break,
        }
    }

    if timed_out {
        return Err("转换超时，请重试".to_string());
    }

    // A zero exit code does not prove success, so the output is what decides.
    if let Some(pdf) = collect_pdf(out_dir) {
        return Ok(pdf);
    }

    let detail = stderr.trim();
    if detail.is_empty() {
        let code = exit_status
            .map(|status| status.to_string())
            .unwrap_or_else(|| "未知".to_string());
        Err(format!("转换失败（退出码 {code}）"))
    } else {
        Err(format!("转换失败：{detail}"))
    }
}

/// The PDF export filter for a source file.
///
/// LibreOffice picks a filter by the document it loaded, but naming it explicitly is
/// what keeps a spreadsheet from being handed to the presentation filter. Each
/// application has its own PDF exporter.
pub fn filter_for(source: &Path) -> &'static str {
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "doc" | "docx" | "docm" | "dot" | "dotx" | "odt" | "rtf" | "txt" => {
            "pdf:writer_pdf_Export"
        }
        "xls" | "xlsx" | "xlsm" | "xlt" | "xltx" | "xla" | "ods" | "csv" => {
            "pdf:calc_pdf_Export"
        }
        _ => "pdf:impress_pdf_Export",
    }
}

/// Arguments for a headless conversion to PDF.
fn build_args(profile_dir: &Path, out_dir: &Path, source: &Path) -> Vec<OsString> {
    let profile_url = to_file_url(profile_dir);
    vec![
        OsString::from("--headless"),
        OsString::from("--norestore"),
        OsString::from("--invisible"),
        OsString::from("--nologo"),
        OsString::from("--nodefault"),
        OsString::from("--nofirststartwizard"),
        OsString::from("--nolockcheck"),
        OsString::from(format!("-env:UserInstallation={profile_url}")),
        OsString::from("--convert-to"),
        OsString::from(filter_for(source)),
        OsString::from("--outdir"),
        out_dir.as_os_str().to_os_string(),
        source.as_os_str().to_os_string(),
    ]
}

/// Read a pipe to the end, keeping at most keep bytes of it.
///
/// Shared with the engine download, which has the same undrained-pipe hazard.
pub fn drain(mut pipe: Option<Box<dyn Read + Send>>, keep: usize) -> String {
    let Some(reader) = pipe.as_mut() else {
        return String::new();
    };
    let mut kept: Vec<u8> = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                // Clamping to the room left keeps a noisy stream from growing
                // without bound, while still draining the pipe to the end.
                kept.extend_from_slice(&buffer[..read.min(keep.saturating_sub(kept.len()))]);
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&kept).into_owned()
}

/// Pick a reusable LibreOffice profile directory.
///
/// Every conversion used to get a fresh profile that was deleted afterwards, which
/// forced LibreOffice to rebuild its configuration and font cache each time; that
/// cold start is most of the delay before the first slide appears. Slots are reused
/// instead, with a small number of them so two concurrent conversions never share
/// one profile.
fn pick_profile_dir(profile_root: &Path) -> std::io::Result<PathBuf> {
    crate::paths::ensure_dir(profile_root)?;
    let pid = std::process::id();

    for slot in 0..PROFILE_SLOTS {
        let dir = profile_root.join(format!("slot-{slot}"));
        crate::paths::ensure_dir(&dir)?;
        let lock = dir.join(LOCK_FILE);
        if lock_is_stale(&lock) {
            let _ = std::fs::remove_file(&lock);
        }
        match claim_lock(&lock, pid) {
            Ok(true) => return Ok(dir),
            Ok(false) => continue,
            Err(err) => return Err(err),
        }
    }

    // Every slot is busy: take an extra directory rather than failing. The name must
    // be unique, because two conversions starting in the same millisecond would
    // otherwise share one profile and corrupt it.
    for attempt in 0..100u32 {
        let stamp = now_millis();
        let extra = profile_root.join(format!("slot-extra-{stamp}-{attempt}"));
        if extra.exists() {
            continue;
        }
        crate::paths::ensure_dir(&extra)?;
        let lock = extra.join(LOCK_FILE);
        match claim_lock(&lock, pid) {
            Ok(true) => return Ok(extra),
            Ok(false) => continue,
            Err(err) => return Err(err),
        }
    }

    Err(std::io::Error::other("no free LibreOffice profile slot"))
}

/// Take the lock file, or report that somebody else holds it.
fn claim_lock(lock: &Path, pid: u32) -> std::io::Result<bool> {
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock)
    {
        Ok(mut file) => {
            let _ = writeln!(file, "{pid}");
            Ok(true)
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(err) => Err(err),
    }
}

fn lock_is_stale(lock: &Path) -> bool {
    let Ok(modified) = std::fs::metadata(lock).and_then(|meta| meta.modified()) else {
        return false;
    };
    let Ok(age) = SystemTime::now().duration_since(modified) else {
        return false;
    };
    age.as_millis() as u64 > STALE_LOCK_MS
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|delta| delta.as_millis())
        .unwrap_or(0)
}

/// Find the PDF soffice wrote and rename it to deck.pdf.
fn collect_pdf(out_dir: &Path) -> Option<PathBuf> {
    let target = out_dir.join("deck.pdf");
    if file_size(&target) > MIN_PDF_BYTES {
        return Some(target);
    }

    let entries = std::fs::read_dir(out_dir).ok()?;
    let candidate = entries
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
                && file_size(path) > MIN_PDF_BYTES
        })?;

    if candidate == target {
        return Some(target);
    }
    let _ = std::fs::remove_file(&target);
    if std::fs::rename(&candidate, &target).is_err() {
        // The conversion still produced something usable, so report where it is
        // rather than failing the open over a rename.
        return Some(candidate);
    }
    Some(target)
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Kill any LibreOffice process left behind by a cancelled conversion.
pub fn kill_orphans(profile: &Path) {
    #[cfg(windows)]
    {
        kill_orphans_on_windows(profile);
    }
    #[cfg(not(windows))]
    {
        // The product is Windows-only; elsewhere there is nothing safe to kill.
        let _ = profile;
    }
}

#[cfg(windows)]
fn kill_orphans_on_windows(profile: &Path) {
    // Match on the command line, not the image name: killing every soffice.bin on
    // the machine would take down the user's own LibreOffice windows too. The path
    // travels in the environment so it never has to survive PowerShell quoting.
    const SCRIPT: &str = "Get-CimInstance Win32_Process -Filter \"Name='soffice.bin'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:PPT_LO_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    let spawned = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("PPT_LO_PROFILE", profile)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(err) => {
            crate::logln!("[convert] could not kill orphaned soffice.bin: {err}");
            return;
        }
    };

    // WMI can be slow on a busy machine, so the cleanup is bounded; a wedged helper
    // must not turn a timeout into a hang.
    let deadline = Instant::now() + Duration::from_millis(ORPHAN_KILL_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(err) => {
                crate::logln!("[convert] could not wait for the orphan cleanup: {err}");
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_document_kind_gets_its_own_export_filter() {
        // Handing a spreadsheet to the presentation filter converts nothing, and the
        // failure looks like a hang rather than an error.
        assert_eq!(filter_for(Path::new("a.pptx")), "pdf:impress_pdf_Export");
        assert_eq!(filter_for(Path::new("a.odp")), "pdf:impress_pdf_Export");
        assert_eq!(filter_for(Path::new("a.docx")), "pdf:writer_pdf_Export");
        assert_eq!(filter_for(Path::new("a.DOC")), "pdf:writer_pdf_Export");
        assert_eq!(filter_for(Path::new("a.xlsx")), "pdf:calc_pdf_Export");
        assert_eq!(filter_for(Path::new("a.XLS")), "pdf:calc_pdf_Export");
    }

    #[test]
    fn a_windows_path_becomes_a_file_url() {
        let url = to_file_url(Path::new("C:\\Users\\Zhang San\\lo profile"));
        assert_eq!(url, "file:///C:/Users/Zhang%20San/lo%20profile");
        // A hash would truncate the URL at the fragment marker.
        assert_eq!(to_file_url(Path::new("C:\\a#b")), "file:///C:/a%23b");
    }

    #[test]
    fn non_ascii_profile_paths_are_percent_encoded() {
        // Chinese user names are the common case on the target platform.
        let url = to_file_url(Path::new("C:\\用户\\lo"));
        assert_eq!(url, "file:///C:/%E7%94%A8%E6%88%B7/lo");
    }

    #[test]
    fn convert_args_carry_every_required_flag() {
        let args: Vec<String> = build_args(
            Path::new("C:\\work\\slot-0"),
            Path::new("C:\\cache\\abc"),
            Path::new("C:\\decks\\a.ppt"),
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

        for flag in [
            "--headless",
            "--norestore",
            "--nodefault",
            "--nofirststartwizard",
            "--nolockcheck",
            "--convert-to",
            "--outdir",
        ] {
            assert!(args.iter().any(|arg| arg == flag), "missing {flag}");
        }
        assert!(args
            .iter()
            .any(|arg| arg == "-env:UserInstallation=file:///C:/work/slot-0"));
        assert_eq!(args.last().map(String::as_str), Some("C:\\decks\\a.ppt"));
    }

    #[test]
    fn profile_slots_are_reused_and_never_shared() {
        let root = tempfile::tempdir().unwrap();
        let first = pick_profile_dir(root.path()).unwrap();
        let second = pick_profile_dir(root.path()).unwrap();
        assert_eq!(first, root.path().join("slot-0"));
        assert_eq!(second, root.path().join("slot-1"));
        assert!(first.join(LOCK_FILE).is_file());

        // A third conversion cannot share either slot, so it gets its own.
        let third = pick_profile_dir(root.path()).unwrap();
        let name = third.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("slot-extra-"), "unexpected profile {name}");

        // Releasing a slot makes it reusable, which is what keeps cold starts rare.
        std::fs::remove_file(first.join(LOCK_FILE)).unwrap();
        let again = pick_profile_dir(root.path()).unwrap();
        assert_eq!(again, first);
    }

    #[test]
    fn a_stale_lock_is_reclaimed() {
        let root = tempfile::tempdir().unwrap();
        let slot = root.path().join("slot-0");
        crate::paths::ensure_dir(&slot).unwrap();
        let lock = slot.join(LOCK_FILE);
        std::fs::write(&lock, b"0").unwrap();
        // Backdate the lock past the staleness window.
        let old = SystemTime::now() - Duration::from_millis(STALE_LOCK_MS + 60_000);
        set_mtime(&lock, old);

        assert_eq!(pick_profile_dir(root.path()).unwrap(), slot);
    }

    #[test]
    fn the_produced_pdf_is_renamed_to_deck_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let produced = dir.path().join("my deck.pdf");
        std::fs::write(&produced, vec![b'x'; (MIN_PDF_BYTES + 1) as usize]).unwrap();

        let found = collect_pdf(dir.path()).expect("the pdf should be collected");
        assert_eq!(found, dir.path().join("deck.pdf"));
        assert!(found.is_file());
        assert!(!produced.exists());
    }

    #[test]
    fn a_truncated_pdf_is_not_a_conversion_result() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("deck.pdf"), b"%PDF-1.7").unwrap();
        assert!(collect_pdf(dir.path()).is_none());
    }

    fn set_mtime(path: &Path, when: SystemTime) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(when).unwrap();
    }
}
