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
    let path = dir.join("ppt-player.log");
    if let Ok(mut slot) = LOG_FILE.lock() {
        *slot = Some(path);
    }
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
