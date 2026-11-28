//! Find a LibreOffice installation.
//!
//! OWNER: subagent-rust-engine
//!
//! Order matters: a downloaded engine wins over a bundled one, which wins over a
//! system install, because that is the order of how deliberate each choice is.

use tauri::AppHandle;
use crate::types::EngineStatus;

/// Locate the engine, or report that there is none.
pub fn resolve_engine(app: &AppHandle) -> EngineStatus {
    todo!("subagent-rust-engine")
}

/// Run `soffice --version` against a candidate path.
pub fn probe_version(binary: &std::path::Path) -> Option<String> {
    todo!("subagent-rust-engine")
}
