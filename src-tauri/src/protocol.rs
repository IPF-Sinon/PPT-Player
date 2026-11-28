//! Custom protocols for deck assets.
//!
//! OWNER: subagent-rust-data
//!
//! deck:// serves a converted PDF and must answer Range requests, because pdf.js
//! streams instead of downloading. pptx:// serves individual OOXML parts to the
//! native renderer. Both are cross-origin from the page, so both must carry CORS
//! headers; the spike proved this the hard way with a bare "Failed to fetch".

use tauri::http::{Request, Response};
use tauri::AppHandle;

/// Serve a converted deck's PDF, honouring Range.
pub fn handle_deck(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    todo!("subagent-rust-data")
}

/// Serve one part of a natively opened PPTX.
pub fn handle_pptx(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    todo!("subagent-rust-data")
}
