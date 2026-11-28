//! Persisted preferences.
//!
//! OWNER: lead
//!
//! Settings are a plain JSON file. A hand-edited file must never break the app, so
//! parsing falls back per field rather than failing the whole load.

use std::path::PathBuf;
use tauri::AppHandle;

use crate::types::{AppSettings, SettingsPatch};

fn settings_path(app: &AppHandle) -> PathBuf {
    crate::paths::config_dir(app).join("settings.json")
}

/// Read settings, falling back to defaults field by field.
pub fn load(app: &AppHandle) -> AppSettings {
    let path = settings_path(app);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return AppSettings::default();
    };
    parse_settings(&value)
}

/// Apply a partial update and persist it.
pub fn save(app: &AppHandle, patch: SettingsPatch) -> AppSettings {
    let mut current = load(app);
    apply_patch(&mut current, patch);
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        let _ = crate::paths::ensure_dir(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(&current) {
        let _ = std::fs::write(&path, text);
    }
    current
}

/// Merge a patch into settings.
pub fn apply_patch(current: &mut AppSettings, patch: SettingsPatch) {
    if let Some(v) = patch.lo_path_override {
        current.lo_path_override = v;
    }
    if let Some(v) = patch.cache_budget_mb {
        current.cache_budget_mb = v;
    }
    if let Some(v) = patch.recent_files {
        current.recent_files = v;
    }
    if let Some(v) = patch.enable_transitions {
        current.enable_transitions = v;
    }
    if let Some(v) = patch.nav_button_position {
        current.nav_button_position = v;
    }
    if let Some(v) = patch.keep_toolbar_in_ink_mode {
        current.keep_toolbar_in_ink_mode = v;
    }
    if let Some(v) = patch.ink_on_exit {
        current.ink_on_exit = v;
    }
    if let Some(v) = patch.bindings {
        current.bindings = v;
    }
    if let Some(v) = patch.autostart {
        current.autostart = v;
    }
}

/// Read settings from arbitrary JSON, keeping a default for anything unusable.
pub fn parse_settings(value: &serde_json::Value) -> AppSettings {
    let mut out = AppSettings::default();
    if let Some(v) = value.get("loPathOverride").and_then(|v| v.as_str()) {
        out.lo_path_override = v.to_string();
    }
    if let Some(v) = value.get("cacheBudgetMb").and_then(|v| v.as_u64()) {
        out.cache_budget_mb = v as u32;
    }
    if let Some(v) = value.get("recentFiles").and_then(|v| v.as_array()) {
        out.recent_files = v
            .iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect();
    }
    if let Some(v) = value.get("enableTransitions").and_then(|v| v.as_bool()) {
        out.enable_transitions = v;
    }
    if let Some(v) = value.get("keepToolbarInInkMode").and_then(|v| v.as_bool()) {
        out.keep_toolbar_in_ink_mode = v;
    }
    if let Some(v) = value.get("navButtonPosition").and_then(|v| v.as_str()) {
        out.nav_button_position = match v {
            "side" => crate::types::NavPosition::Side,
            _ => crate::types::NavPosition::Bottom,
        };
    }
    if let Some(v) = value.get("inkOnExit").and_then(|v| v.as_str()) {
        out.ink_on_exit = match v {
            "keep" => crate::types::InkOnExit::Keep,
            "discard" => crate::types::InkOnExit::Discard,
            _ => crate::types::InkOnExit::Ask,
        };
    }
    if let Some(v) = value.get("autostart").and_then(|v| v.as_bool()) {
        out.autostart = v;
    }
    if let Some(bindings) = value.get("bindings") {
        out.bindings = parse_bindings(bindings);
    }
    out
}

/// Read the per-category bindings, keeping a default for any unusable entry.
fn parse_bindings(value: &serde_json::Value) -> crate::types::Bindings {
    let mut out = crate::types::Bindings::default();
    for (key, slot) in [
        ("ppt", &mut out.ppt),
        ("pdf", &mut out.pdf),
        ("docx", &mut out.docx),
        ("xls", &mut out.xls),
    ] {
        let Some(entry) = value.get(key) else { continue };
        if let Some(v) = entry.get("viewMode").and_then(|v| v.as_str()) {
            *slot = crate::types::CategoryBinding {
                view_mode: if v == "single-column" {
                    crate::types::ViewMode::SingleColumn
                } else {
                    crate::types::ViewMode::Slide
                },
                ..*slot
            };
        }
        if let Some(v) = entry.get("toolbarStyle").and_then(|v| v.as_str()) {
            *slot = crate::types::CategoryBinding {
                toolbar_style: if v == "fab" {
                    crate::types::ToolbarStyle::Fab
                } else {
                    crate::types::ToolbarStyle::Bar
                },
                ..*slot
            };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_json_is_empty() {
        let settings = parse_settings(&serde_json::json!({}));
        assert_eq!(settings.cache_budget_mb, 2048);
        assert!(settings.enable_transitions);
    }

    #[test]
    fn a_hand_edited_value_falls_back_per_field() {
        // One bad field must not discard the good ones beside it.
        let settings = parse_settings(&serde_json::json!({
            "cacheBudgetMb": "not a number",
            "navButtonPosition": "side"
        }));
        assert_eq!(settings.cache_budget_mb, 2048);
        assert_eq!(settings.nav_button_position, crate::types::NavPosition::Side);
    }

    #[test]
    fn unknown_enum_values_fall_back() {
        let settings = parse_settings(&serde_json::json!({ "inkOnExit": "maybe" }));
        assert_eq!(settings.ink_on_exit, crate::types::InkOnExit::Ask);
    }

    #[test]
    fn patch_only_touches_the_fields_it_carries() {
        let mut settings = AppSettings::default();
        settings.cache_budget_mb = 512;
        apply_patch(
            &mut settings,
            SettingsPatch {
                ink_on_exit: Some(crate::types::InkOnExit::Keep),
                ..Default::default()
            },
        );
        assert_eq!(settings.cache_budget_mb, 512);
        assert_eq!(settings.ink_on_exit, crate::types::InkOnExit::Keep);
    }

    #[test]
    fn a_presentation_keeps_the_slide_view_and_a_document_does_not() {
        // The defaults are a product decision: a deck is presented, a document is read.
        let bindings = crate::types::Bindings::default();
        let ppt = bindings.for_category(crate::types::DocumentCategory::Ppt);
        assert_eq!(ppt.view_mode, crate::types::ViewMode::Slide);
        assert_eq!(ppt.toolbar_style, crate::types::ToolbarStyle::Bar);

        for category in [
            crate::types::DocumentCategory::Pdf,
            crate::types::DocumentCategory::Docx,
            crate::types::DocumentCategory::Xls,
        ] {
            let binding = bindings.for_category(category);
            assert_eq!(binding.view_mode, crate::types::ViewMode::SingleColumn);
            assert_eq!(binding.toolbar_style, crate::types::ToolbarStyle::Fab);
        }
    }

    #[test]
    fn one_broken_binding_does_not_reset_the_others() {
        let settings = parse_settings(&serde_json::json!({
            "bindings": {
                "ppt": { "viewMode": "single-column", "toolbarStyle": "fab" },
                "docx": { "viewMode": "nonsense" }
            }
        }));
        // The explicit values are honoured...
        assert_eq!(settings.bindings.ppt.view_mode, crate::types::ViewMode::SingleColumn);
        assert_eq!(settings.bindings.ppt.toolbar_style, crate::types::ToolbarStyle::Fab);
        // ...an unusable one falls back, and the untouched categories keep defaults.
        assert_eq!(settings.bindings.docx.view_mode, crate::types::ViewMode::Slide);
        assert_eq!(settings.bindings.pdf.view_mode, crate::types::ViewMode::SingleColumn);
    }

    #[test]
    fn autostart_defaults_to_off() {
        // Starting with the OS is a decision the user makes, not one the app makes.
        assert!(!crate::types::AppSettings::default().autostart);
        assert!(!parse_settings(&serde_json::json!({})).autostart);
        assert!(parse_settings(&serde_json::json!({ "autostart": true })).autostart);
    }
}
