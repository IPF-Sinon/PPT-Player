//! Where things live on disk.
//!
//! Every path the app writes goes through here, so the layout is one place to read
//! rather than scattered string joins.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Root of everything the app owns, under the platform app data directory.
pub fn data_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ppt-player"))
}

/// Converted PDFs and their sidecar metadata.
pub fn cache_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("cache")
}

/// Settings, ink, and logs.
pub fn config_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("config")
}

/// Where an on-demand engine download is unpacked.
pub fn downloaded_engine_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("engine").join("lo")
}

/// Scratch space for LibreOffice profiles and in-flight conversions.
pub fn work_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("work")
}

/// Create a directory, ignoring the error when it already exists.
pub fn ensure_dir(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(path)
}

/// Pick the file to open from the command line.
///
/// A deck path arrives either bare or after a flag, and the first existing candidate
/// wins; anything else is ignored rather than treated as an error, because the shell
/// also passes its own switches.
pub fn pending_open_path_from_args(args: Vec<String>) -> Option<String> {
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let candidate = Path::new(&arg);
        if candidate.is_file() {
            return Some(arg);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_flags_and_missing_files() {
        let args = vec!["--no-sandbox".to_string(), "/nonexistent/x.pptx".to_string()];
        assert_eq!(pending_open_path_from_args(args), None);
    }

    #[test]
    fn finds_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("deck.pptx");
        std::fs::write(&file, b"x").unwrap();
        let args = vec!["--flag".to_string(), file.to_string_lossy().to_string()];
        assert_eq!(
            pending_open_path_from_args(args),
            Some(file.to_string_lossy().to_string())
        );
    }
}
