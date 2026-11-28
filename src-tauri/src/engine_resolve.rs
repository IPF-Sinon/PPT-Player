//! Find a LibreOffice installation.
//!
//! OWNER: subagent-rust-engine
//!
//! Order matters: a downloaded engine wins over a bundled one, which wins over a
//! system install, because that is the order of how deliberate each choice is.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::engine_lo::{hidden_command, list_subdirs, soffice_in_program_dir};
use crate::types::{EngineId, EngineOrigin, EngineStatus};

/// Registry keys LibreOffice registers itself under, both bitnesses.
#[cfg(windows)]
const WIN_REGISTRY_KEYS: [&str; 2] = [
    r"HKLM\SOFTWARE\LibreOffice\UNO\InstallPath",
    r"HKLM\SOFTWARE\WOW6432Node\LibreOffice\UNO\InstallPath",
];

/// How long a registry or version probe may take before it is abandoned.
const PROBE_TIMEOUT_MS: u64 = 5_000;
/// How much of a probe's stdout is kept. Both answers are a single short line.
const PROBE_OUTPUT_LIMIT: usize = 64 * 1024;

/// Cached status, plus the settings value it was computed from.
///
/// The override is part of the key so that changing the configured path in the
/// settings screen invalidates the cache without a separate reset call.
type CacheSlot = Option<(String, EngineStatus)>;

fn cache() -> &'static Mutex<CacheSlot> {
    static CACHE: OnceLock<Mutex<CacheSlot>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_for(override_path: &str) -> Option<EngineStatus> {
    let guard = cache().lock().ok()?;
    match guard.as_ref() {
        Some((key, status)) if key == override_path => Some(status.clone()),
        _ => None,
    }
}

fn store_cache(override_path: &str, status: &EngineStatus) {
    if let Ok(mut guard) = cache().lock() {
        *guard = Some((override_path.to_string(), status.clone()));
    }
}

/// Candidate roots for a bundled engine, most explicit first.
///
/// A downloaded engine comes first because it is the copy the user asked for; the
/// packaged resources follow, then the dev-time fallback.
fn bundled_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(from_env) = std::env::var("PPT_PLAYER_LO_DIR").ok().filter(|v| !v.is_empty()) {
        roots.push(PathBuf::from(from_env));
    }
    if let Ok(resources) = app.path().resource_dir() {
        roots.push(resources.join("lo"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources").join("lo"));
        }
    }
    roots.push(crate::paths::downloaded_engine_dir(app));
    roots
}

/// Locate the engine, or report that there is none.
///
/// The result is cached for the process, because probing spawns processes and the
/// answer only changes when the user changes it. The command layer asks for a forced
/// re-probe after every action that could install or move an engine.
pub fn resolve_engine(app: &AppHandle) -> EngineStatus {
    resolve_engine_cached(app, false)
}

/// Locate the engine, ignoring any cached answer.
pub fn resolve_engine_fresh(app: &AppHandle) -> EngineStatus {
    resolve_engine_cached(app, true)
}

fn resolve_engine_cached(app: &AppHandle, force: bool) -> EngineStatus {
    let override_path = crate::settings::load(app).lo_path_override;
    if !force {
        if let Some(status) = cached_for(&override_path) {
            return status;
        }
    }
    let status = resolve_with_roots(&override_path, &bundled_roots(app));
    store_cache(&override_path, &status);
    crate::logln!(
        "[engine] resolved available={} origin={:?} path={}",
        status.available,
        status.origin,
        status.path
    );
    status
}

/// Drop the cached status, so the next lookup probes again.
pub fn reset_engine_cache() {
    if let Ok(mut guard) = cache().lock() {
        *guard = None;
    }
}

fn resolve_with_roots(override_path: &str, roots: &[PathBuf]) -> EngineStatus {
    let wanted = override_path.trim();
    if !wanted.is_empty() {
        if let Some(found) = accept_engine_path(Path::new(wanted)) {
            return available(found, EngineOrigin::Custom);
        }
        // A configured path that is unusable is reported, not silently ignored, so
        // the settings screen can explain why the engine is still missing.
        crate::logln!("[engine] configured LibreOffice path is unusable: {wanted}");
    }

    if let Some(found) = find_bundled(roots) {
        return available(found, EngineOrigin::Bundled);
    }

    #[cfg(windows)]
    {
        if let Some(found) = find_in_registry(&WIN_REGISTRY_KEYS) {
            return available(found, EngineOrigin::Installed);
        }
    }

    if let Some(found) = find_on_path() {
        return available(found, EngineOrigin::Path);
    }

    missing_status(roots)
}

/// The "nothing found" answer, naming where an engine was expected.
fn missing_status(roots: &[PathBuf]) -> EngineStatus {
    let expected = roots
        .first()
        .map(|root| root.join("program").join("soffice.com"))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    EngineStatus {
        available: false,
        id: EngineId::None,
        path: String::new(),
        version: String::new(),
        origin: EngineOrigin::None,
        detail: expected,
    }
}

fn available(path: PathBuf, origin: EngineOrigin) -> EngineStatus {
    let version = probe_version(&path).unwrap_or_default();
    let detail = path.to_string_lossy().to_string();
    EngineStatus {
        available: true,
        id: EngineId::Libreoffice,
        path: detail.clone(),
        version,
        origin,
        detail,
    }
}

/// Accept either a program directory or the binary itself.
fn accept_engine_path(path: &Path) -> Option<PathBuf> {
    if path.is_dir() {
        return soffice_in_program_dir(path);
    }
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    None
}

fn find_bundled(roots: &[PathBuf]) -> Option<PathBuf> {
    for root in roots {
        if root.as_os_str().is_empty() {
            continue;
        }
        if let Some(direct) = soffice_in_program_dir(&root.join("program")) {
            return Some(direct);
        }
        // Archives and installers wrap the engine in a versioned folder, so the
        // tree is searched one level down as well.
        for sub in list_subdirs(root) {
            if let Some(found) = soffice_in_program_dir(&sub.join("program")) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(windows)]
fn find_in_registry(keys: &[&str]) -> Option<PathBuf> {
    for key in keys {
        let output = run_with_timeout("reg", &["query", key, "/ve"]);
        let Some(text) = output else { continue };
        let Some(dir) = registry_value_path(&text) else {
            continue;
        };
        if let Some(found) = accept_engine_path(Path::new(&dir)) {
            return Some(found);
        }
    }
    None
}

/// Pull the default value out of reg.exe output.
///
/// A line looks like: (Default)    REG_SZ    C:/Program Files/LibreOffice/
#[cfg(windows)]
fn registry_value_path(output: &str) -> Option<String> {
    for line in output.lines() {
        let Some(rest) = line.split_once("REG_").map(|(_, rest)| rest) else {
            continue;
        };
        // rest begins with the type, e.g. "SZ    C:/path".
        let mut fields = rest.splitn(2, char::is_whitespace);
        fields.next();
        let Some(raw_value) = fields.next() else {
            continue;
        };
        let value = raw_value.trim().trim_matches('"').trim();
        if value.is_empty() {
            continue;
        }
        return Some(value.to_string());
    }
    None
}

fn find_on_path() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .filter(|dir| !dir.as_os_str().is_empty())
        .find_map(|dir| soffice_in_program_dir(&dir))
}

/// Run a command and return its stdout, giving up after a short timeout.
///
/// The Electron build called execFileSync here, which froze the whole window for
/// the length of a reg query; the timeout keeps a wedged probe from doing the same.
fn run_with_timeout(program: &str, args: &[&str]) -> Option<String> {
    use std::process::Stdio;

    let mut child = hidden_command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // stdout is drained on its own thread. Polling try_wait on a piped child whose
    // output nobody reads is the same deadlock that used to hang conversions: once
    // the pipe buffer fills, the child blocks and this loop just runs to the timeout.
    let pipe = child
        .stdout
        .take()
        .map(|pipe| Box::new(pipe) as Box<dyn Read + Send>);
    let reader = std::thread::spawn(move || crate::engine_lo::drain(pipe, PROBE_OUTPUT_LIMIT));

    let deadline = Instant::now() + Duration::from_millis(PROBE_TIMEOUT_MS);
    let mut succeeded = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                succeeded = status.success();
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }

    // The child is gone, so the reader thread reaches end of file and returns.
    let output = match reader.join() {
        Ok(text) => text,
        Err(_) => return None,
    };
    if !succeeded {
        return None;
    }
    Some(output)
}

/// Run soffice --version against a candidate path.
pub fn probe_version(binary: &Path) -> Option<String> {
    let output = run_with_timeout(&binary.to_string_lossy(), &["--version"])?;
    parse_version(&output)
}

/// Reduce soffice --version output to the version number.
///
/// LibreOffice writes "LibreOffice 24.2.5.2 abc123..." to stdout, and some builds
/// write the same line to stderr, so only the version token is kept.
pub fn parse_version(output: &str) -> Option<String> {
    for line in output.lines() {
        let mut words = line.split_whitespace();
        // A missing word here means this line is not the version line, so the next
        // line is tried rather than the whole parse giving up.
        if words.next() != Some("LibreOffice") {
            continue;
        }
        let Some(token) = words.next() else {
            continue;
        };
        let version: String = token
            .chars()
            .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
            .collect();
        if version.is_empty() {
            continue;
        }
        return Some(version);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_version_line_is_reduced_to_the_number() {
        let output = "LibreOffice 24.2.5.2 420(Build:2)";
        assert_eq!(parse_version(output).as_deref(), Some("24.2.5.2"));
    }

    #[test]
    fn unparseable_version_output_is_not_a_version() {
        assert_eq!(parse_version("no engine here"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn a_missing_engine_reports_where_it_was_expected() {
        // Only the status builder is exercised here: resolve_with_roots also probes
        // the registry and PATH, which would make this test depend on the machine.
        let root = tempfile::tempdir().unwrap();
        let status = missing_status(&[root.path().to_path_buf()]);
        assert!(!status.available);
        assert_eq!(status.id, EngineId::None);
        assert_eq!(status.origin, EngineOrigin::None);
        // The detail names the expected binary so the UI can say what is missing.
        assert!(status.detail.ends_with("soffice.com"), "{}", status.detail);
    }

    #[test]
    fn a_bundled_engine_is_found_one_level_down() {
        let root = tempfile::tempdir().unwrap();
        let program = root.path().join("LibreOffice 24").join("program");
        std::fs::create_dir_all(&program).unwrap();
        std::fs::write(program.join("soffice.exe"), b"stub").unwrap();

        let found = find_bundled(&[root.path().to_path_buf()]).expect("engine should be found");
        assert_eq!(found, program.join("soffice.exe"));
    }

    #[test]
    fn an_override_directory_resolves_to_the_binary_inside_it() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("soffice.com"), b"stub").unwrap();
        assert_eq!(
            accept_engine_path(root.path()),
            Some(root.path().join("soffice.com"))
        );
    }

    #[test]
    fn an_override_pointing_at_a_missing_path_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("nope");
        assert_eq!(accept_engine_path(&missing), None);
    }

    #[test]
    fn the_cache_is_keyed_on_the_override() {
        reset_engine_cache();
        let status = EngineStatus {
            available: false,
            id: EngineId::None,
            path: String::new(),
            version: String::new(),
            origin: EngineOrigin::None,
            detail: String::new(),
        };
        store_cache("C:/lo", &status);
        assert!(cached_for("C:/lo").is_some());
        // Changing the configured path must force a fresh probe.
        assert!(cached_for("D:/lo").is_none());
        reset_engine_cache();
        assert!(cached_for("C:/lo").is_none());
    }
}
