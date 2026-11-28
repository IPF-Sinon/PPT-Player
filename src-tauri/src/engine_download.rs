//! Fetch the engine on demand for the lite build.
//!
//! OWNER: subagent-rust-engine
//!
//! The download is verified before it is unpacked: an interrupted or tampered archive
//! must never be extracted over a working install.

use std::path::Path;
use tauri::AppHandle;

pub struct DownloadRequest<'a> {
    pub url: &'a str,
    pub sha256: &'a str,
    pub bytes: u64,
    pub target_dir: &'a Path,
}

/// Download, verify, and unpack the engine.
pub fn download_engine(app: &AppHandle, request: &DownloadRequest<'_>) -> Result<(), String> {
    todo!("subagent-rust-engine")
}

/// Whether a usable engine is already unpacked here.
pub fn has_downloaded_engine(dir: &Path) -> bool {
    todo!("subagent-rust-engine")
}
