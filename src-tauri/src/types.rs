//! Types shared by every module and mirrored to the renderer over IPC.
//!
//! These match src/shared/types.ts field for field, because the React code is not
//! being rewritten: it still expects the same shapes it got from Electron.

use serde::{Deserialize, Serialize};

/// What the file actually is, decided by content rather than by extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeckKind {
    OoxmlPresentation,
    Odp,
    LegacyPpt,
    EncryptedOoxml,
    /// Word documents, converted through Writer.
    OoxmlDocument,
    LegacyDoc,
    /// Spreadsheets, converted through Calc.
    OoxmlSheet,
    LegacySheet,
    Pdf,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerKind {
    Zip,
    Cfb,
    Pdf,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineId {
    Com,
    Libreoffice,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub kind: DeckKind,
    pub container: ContainerKind,
    /// Lower-case extension without the dot, as found on disk.
    pub declared_ext: String,
    /// True when the content disagrees with the declared extension.
    pub ext_mismatch: bool,
    pub encrypted: bool,
    /// Short human readable label, e.g. "PPTX" or "PPT".
    pub label: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckInfo {
    pub deck_id: String,
    pub source_path: String,
    pub source_bytes: u64,
    pub source_mtime_ms: f64,
    pub format: FormatInfo,
    pub page_count: u32,
    pub page_sizes: Vec<PageSize>,
    pub engine: EngineId,
    pub engine_path: String,
    pub convert_ms: f64,
    pub cached: bool,
    pub mixed_aspect: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConvertStage {
    Probe,
    Convert,
    Parse,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertProgress {
    pub deck_id: String,
    pub stage: ConvertStage,
    /// 0..1, best effort.
    pub ratio: f64,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineOrigin {
    Bundled,
    Installed,
    Path,
    Custom,
    Com,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub available: bool,
    pub id: EngineId,
    pub path: String,
    pub version: String,
    pub origin: EngineOrigin,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStage {
    Downloading,
    Verifying,
    Extracting,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDownloadProgress {
    pub stage: DownloadStage,
    pub received_bytes: u64,
    pub total_bytes: u64,
    /// 0..1, or -1 when the server did not report a length.
    pub ratio: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub lo_path_override: String,
    pub cache_budget_mb: u32,
    pub recent_files: Vec<String>,
    pub enable_transitions: bool,
    pub nav_button_position: NavPosition,
    pub keep_toolbar_in_ink_mode: bool,
    pub ink_on_exit: InkOnExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NavPosition {
    Bottom,
    Side,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InkOnExit {
    Ask,
    Keep,
    Discard,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            lo_path_override: String::new(),
            cache_budget_mb: 2048,
            recent_files: Vec::new(),
            enable_transitions: true,
            nav_button_position: NavPosition::Bottom,
            keep_toolbar_in_ink_mode: true,
            ink_on_exit: InkOnExit::Ask,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapInfo {
    pub settings: AppSettings,
    pub pending_open_path: Option<String>,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    pub tool: String,
    pub color: String,
    pub width: f64,
    /// Flat [x0, y0, x1, y1, ...] in slide-normalised coordinates.
    pub points: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkPage {
    pub page_index: u32,
    pub strokes: Vec<InkStroke>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOk {
    pub format: FormatInfo,
    pub bytes: u64,
    pub mtime_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum ProbeResult {
    Ok {
        ok: bool,
        #[serde(flatten)]
        data: ProbeOk,
    },
    Err {
        ok: bool,
        error: AppErrorPayload,
    },
}

impl ProbeResult {
    pub fn ok(info: ProbeOk) -> Self {
        ProbeResult::Ok { ok: true, data: info }
    }
    pub fn err(code: &str, message: impl Into<String>) -> Self {
        ProbeResult::Err {
            ok: false,
            error: AppErrorPayload {
                code: code.to_string(),
                message: message.into(),
                detail: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOk {
    pub info: DeckInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum OpenResult {
    Ok {
        ok: bool,
        info: DeckInfo,
    },
    Err {
        ok: bool,
        error: AppErrorPayload,
    },
}

impl OpenResult {
    pub fn ok(info: DeckInfo) -> Self {
        OpenResult::Ok { ok: true, info }
    }
    pub fn err(code: &str, message: impl Into<String>) -> Self {
        OpenResult::Err {
            ok: false,
            error: AppErrorPayload {
                code: code.to_string(),
                message: message.into(),
                detail: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOpenResult {
    pub deck_id: String,
    pub slide_paths: Vec<String>,
    pub slide_size: PageSize,
    pub has_macros: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayState {
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineVariant {
    pub variant: String,
    pub engine_bytes: u64,
}

/// The settings patch the renderer sends. Every field is optional, so a partial
/// update cannot reset values the UI did not touch.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub lo_path_override: Option<String>,
    pub cache_budget_mb: Option<u32>,
    pub recent_files: Option<Vec<String>>,
    pub enable_transitions: Option<bool>,
    pub nav_button_position: Option<NavPosition>,
    pub keep_toolbar_in_ink_mode: Option<bool>,
    pub ink_on_exit: Option<InkOnExit>,
}
