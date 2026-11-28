//! The conversion pipeline and its cache.
//!
//! OWNER: subagent-rust-engine
//!
//! A converted deck is cached by source path, size, and mtime, so reopening the same
//! file is instant and an edited file is re-converted.

use std::path::PathBuf;
use tauri::AppHandle;
use crate::types::{DeckInfo, EngineStatus};

/// Open a deck, converting it when the format needs it.
pub fn open_deck(app: &AppHandle, path: &str) -> Result<DeckInfo, String> {
    todo!("subagent-rust-engine")
}

/// Drop a deck's cached artefacts.
pub fn close_deck(deck_id: &str) {
    todo!("subagent-rust-engine")
}

/// Cache size in bytes, for the settings screen.
pub fn cache_bytes(app: &AppHandle) -> u64 {
    todo!("subagent-rust-engine")
}

/// Empty the cache.
pub fn clear_cache(app: &AppHandle) -> Result<(), String> {
    todo!("subagent-rust-engine")
}
