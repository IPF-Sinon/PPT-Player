//! A tiny logger.
//!
//! Diagnostics go to a file the UI can reveal. Nothing here is allowed to panic on a
//! logging failure: losing a log line must never take the app down.

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

use tauri::AppHandle;

static LOG_FILE: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);

/// Point the logger at a file under the config directory.
pub fn init(app: &AppHandle) {
    let dir = crate::paths::config_dir(app);
    let _ = crate::paths::ensure_dir(&dir);
    set_file(dir.join("ppt-player.log"));
}

/// Point the logger at an explicit file.
///
/// Separate from init so the path can be set before the app handle exists: a panic
/// during startup has to be recorded, and by definition it happens before there is
/// anything to ask for a directory.
pub fn set_file(path: std::path::PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut slot) = LOG_FILE.lock() {
        *slot = Some(path);
    }
}

/// Install a panic hook that records the panic before the process dies.
///
/// Release builds abort on panic and hide the console, so without this a crash during
/// startup is completely silent: the app simply never appears.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "no message".to_string());
        write(&format!("[panic] {payload} at {location}"));
        eprintln!("[panic] {payload} at {location}");
    }));
}

/// Append a line. Never fails loudly.
pub fn write(message: &str) {
    let path = LOG_FILE.lock().ok().and_then(|p| p.clone());
    let Some(path) = path else { return };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

/// Log a line and echo it to stderr, which is what CI reads.
#[macro_export]
macro_rules! logln {
    ($($arg:tt)*) => {{
        let line = format!($($arg)*);
        $crate::log::write(&line);
        eprintln!("{line}");
    }};
}

/// Where the log file is, for the reveal action.
pub fn log_path() -> Option<std::path::PathBuf> {
    LOG_FILE.lock().ok().and_then(|p| p.clone())
}