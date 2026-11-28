//! Annotations, stored per deck.
//!
//! OWNER: lead
//!
//! Strokes are keyed by deck so a reopened file still shows what was drawn on it. A
//! corrupt file is treated as empty rather than fatal: losing annotations is bad,
//! refusing to open the deck is worse.

use std::path::PathBuf;
use tauri::AppHandle;

use crate::types::InkPage;

fn ink_path(app: &AppHandle, deck_id: &str) -> PathBuf {
    crate::paths::config_dir(app)
        .join("ink")
        .join(format!("{deck_id}.json"))
}

/// Load a deck's annotations.
pub fn load(app: &AppHandle, deck_id: &str) -> Vec<InkPage> {
    let path = ink_path(app, deck_id);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<InkPage>>(&text).unwrap_or_default()
}

/// Persist a deck's annotations.
pub fn save(app: &AppHandle, deck_id: &str, pages: &[InkPage]) -> Result<(), String> {
    let path = ink_path(app, deck_id);
    if let Some(dir) = path.parent() {
        crate::paths::ensure_dir(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(pages).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Drop a deck's annotations.
pub fn clear(app: &AppHandle, deck_id: &str) {
    let _ = std::fs::remove_file(ink_path(app, deck_id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::InkStroke;

    #[test]
    fn strokes_survive_a_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ink.json");
        let pages = vec![InkPage {
            page_index: 0,
            strokes: vec![InkStroke {
                tool: "pen".into(),
                color: "#ef4444".into(),
                width: 2.0,
                points: vec![0.1, 0.2, 0.3, 0.4],
            }],
        }];
        std::fs::write(&path, serde_json::to_string(&pages).unwrap()).unwrap();
        let back: Vec<InkPage> =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].strokes[0].points.len(), 4);
    }

    #[test]
    fn corrupt_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"not json").unwrap();
        let parsed: Vec<InkPage> =
            serde_json::from_str::<Vec<InkPage>>(&std::fs::read_to_string(&path).unwrap())
                .unwrap_or_default();
        assert!(parsed.is_empty());
    }
}
