//! Drive LibreOffice to convert a deck to PDF.
//!
//! OWNER: subagent-rust-engine
//!
//! Two things here are load-bearing and were found the hard way in the Electron build:
//! stdout must be a pipe that is drained (an undrained pipe deadlocks the child), and
//! the process needs its own profile directory, because a shared one makes concurrent
//! conversions block on each other.

use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub struct ConvertOptions {
    pub source: PathBuf,
    pub out_dir: PathBuf,
    /// Convert only the first N pages, for a fast first paint.
    pub first_pages: Option<u32>,
}

/// Convert a deck to PDF, returning the produced file.
pub fn convert_to_pdf(app: &AppHandle, options: &ConvertOptions) -> Result<PathBuf, String> {
    todo!("subagent-rust-engine")
}

/// Kill any LibreOffice process left behind by a cancelled conversion.
pub fn kill_orphans(profile: &Path) {
    todo!("subagent-rust-engine")
}
