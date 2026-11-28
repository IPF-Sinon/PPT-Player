//! The IPC surface, invoked from the renderer.
//!
//! OWNER: lead
//!
//! Every command here maps one to one onto a method the React app already calls on
//! window.api, so the frontend keeps working without being rewritten.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::types::*;
use crate::{convert, engine_download, engine_resolve, index_parse, ink, paths, settings, zip_vfs};

/// Process-wide state.
pub struct AppState {
    /// A deck path passed on the command line, consumed once at startup.
    pub pending_open_path: Mutex<Option<String>>,
    /// Decks opened with the native renderer, so their parts can be served.
    pub native_decks: Mutex<std::collections::HashMap<String, NativeDeck>>,
}

pub struct NativeDeck {
    pub path: String,
    pub vfs: zip_vfs::ZipVfs,
}

impl AppState {
    pub fn new(pending: Option<String>) -> Self {
        Self {
            pending_open_path: Mutex::new(pending),
            native_decks: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

fn err(code: &str, message: impl Into<String>) -> AppErrorPayload {
    AppErrorPayload {
        code: code.to_string(),
        message: message.into(),
        detail: None,
    }
}

// ------------------------------------------------------------------ decks

#[tauri::command]
pub fn probe(path: String) -> ProbeResult {
    let p = std::path::Path::new(&path);
    let Ok(meta) = std::fs::metadata(p) else {
        return ProbeResult::err("missing", "文件不存在");
    };
    let format = crate::detect::detect(p);
    if format.kind == DeckKind::Unsupported {
        return ProbeResult::err(
            "unsupported",
            format.reason.clone().unwrap_or_else(|| "不支持的文件".into()),
        );
    }
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    ProbeResult::ok(ProbeOk {
        format,
        bytes: meta.len(),
        mtime_ms,
    })
}

#[tauri::command]
pub fn open(app: AppHandle, path: String) -> OpenResult {
    // The UI shows a progress bar from these events. Without them the bar sits at
    // whatever it started with, which reads as a hang on a slow conversion.
    let emit = |stage: ConvertStage, ratio: f64, message: &str, deck_id: &str| {
        let _ = app.emit(
            "deck:progress",
            ConvertProgress {
                deck_id: deck_id.to_string(),
                stage,
                ratio,
                message: message.to_string(),
            },
        );
    };

    emit(ConvertStage::Probe, 0.05, "正在识别文件", "");
    emit(ConvertStage::Convert, 0.15, "正在转换", "");

    match convert::open_deck(&app, &path) {
        Ok(info) => {
            emit(ConvertStage::Done, 1.0, "完成", &info.deck_id);
            OpenResult::ok(info)
        }
        Err(message) => {
            emit(ConvertStage::Failed, 0.0, &message, "");
            OpenResult::err("open-failed", message)
        }
    }
}

#[tauri::command]
pub fn open_native(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Option<NativeOpenResult> {
    let p = std::path::Path::new(&path);
    let format = crate::detect::detect(p);
    if format.kind != DeckKind::OoxmlPresentation {
        return None;
    }
    let vfs = zip_vfs::ZipVfs::open(p).ok()?;
    let index = index_parse::build_presentation_index(&vfs)?;
    let deck_id = uuid::Uuid::new_v4().simple().to_string();

    let result = NativeOpenResult {
        deck_id: deck_id.clone(),
        slide_paths: index.slides.iter().map(|s| s.path.clone()).collect(),
        slide_size: index.slide_size.clone(),
        has_macros: index.has_macros,
    };

    if let Ok(mut decks) = state.native_decks.lock() {
        decks.insert(
            deck_id,
            NativeDeck {
                path: path.clone(),
                vfs,
            },
        );
    }
    Some(result)
}

#[tauri::command]
pub fn cancel_open() {
    // Conversion cancellation is handled inside the pipeline; nothing to do here yet.
}

#[tauri::command]
pub fn close_deck(state: State<'_, AppState>, deck_id: String) {
    if let Ok(mut decks) = state.native_decks.lock() {
        decks.remove(&deck_id);
    }
    convert::close_deck(&deck_id);
}

#[tauri::command]
pub fn report_metrics(
    _deck_id: String,
    _page_count: u32,
    _page_sizes: Vec<PageSize>,
) -> Option<DeckInfo> {
    None
}

#[tauri::command]
pub fn pick_file() -> Option<String> {
    let picked = rfd::FileDialog::new()
        .add_filter("演示文稿", &["pptx", "pptm", "ppsx", "ppt", "odp", "pdf"])
        .pick_file()?;
    Some(picked.to_string_lossy().to_string())
}

// ------------------------------------------------------------------ urls

#[tauri::command]
pub fn deck_url(deck_id: String) -> String {
    // Windows serves custom schemes over http on a .localhost host; this is the shape
    // the spike verified end to end.
    format!("http://deck.localhost/{deck_id}/deck.pdf")
}

#[tauri::command]
pub fn pptx_url(deck_id: String, part_path: String) -> String {
    format!("http://pptx.localhost/{deck_id}/{part_path}")
}

// ------------------------------------------------------------------ playback

#[tauri::command]
pub fn enter_playback(app: AppHandle, _deck_id: String, _page_index: u32) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("no window".into());
    };
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    emit_play_state(&app);
    Ok(())
}

#[tauri::command]
pub fn exit_playback(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("no window".into());
    };
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    emit_play_state(&app);
    Ok(())
}

/// Tell the UI whether a show is active.
pub fn emit_play_state(app: &AppHandle) {
    let active = app
        .get_webview_window("main")
        .and_then(|w| w.is_fullscreen().ok())
        .unwrap_or(false);
    let _ = app.emit("play:state", PlayState { active });
}

// ------------------------------------------------------------------ ink

#[tauri::command]
pub fn load_ink(app: AppHandle, deck_id: String) -> Vec<InkPage> {
    ink::load(&app, &deck_id)
}

#[tauri::command]
pub fn save_ink(app: AppHandle, deck_id: String, pages: Vec<InkPage>) -> Result<(), String> {
    ink::save(&app, &deck_id, &pages)
}

// ------------------------------------------------------------------ settings

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    settings::load(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, patch: SettingsPatch) -> AppSettings {
    settings::save(&app, patch)
}

#[tauri::command]
pub fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> BootstrapInfo {
    let pending = state
        .pending_open_path
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    let fullscreen = app
        .get_webview_window("main")
        .and_then(|w| w.is_fullscreen().ok())
        .unwrap_or(false);
    BootstrapInfo {
        settings: settings::load(&app),
        pending_open_path: pending,
        fullscreen,
    }
}

// ------------------------------------------------------------------ engine

#[tauri::command]
pub fn engine_status(app: AppHandle) -> EngineStatus {
    engine_resolve::resolve_engine(&app)
}

#[tauri::command]
pub fn engine_variant() -> EngineVariant {
    // The lite build ships without the engine; the variant is baked in at build time.
    let variant = option_env!("PPT_VARIANT").unwrap_or("lite").to_string();
    EngineVariant {
        variant,
        engine_bytes: 0,
    }
}

#[tauri::command]
pub fn set_lo_path(app: AppHandle, path: String) -> EngineStatus {
    settings::save(
        &app,
        SettingsPatch {
            lo_path_override: Some(path),
            ..Default::default()
        },
    );
    engine_resolve::resolve_engine(&app)
}

#[tauri::command]
pub fn pick_lo_path() -> Option<String> {
    let picked = rfd::FileDialog::new().pick_folder()?;
    Some(picked.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn engine_download(app: AppHandle) -> Result<String, String> {
    let url = option_env!("PPT_ENGINE_URL").unwrap_or_default();
    let sha = option_env!("PPT_ENGINE_SHA256").unwrap_or_default();
    let bytes: u64 = option_env!("PPT_ENGINE_BYTES")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if url.is_empty() {
        return Err("此版本不包含引擎下载地址".into());
    }
    let target = paths::downloaded_engine_dir(&app);
    engine_download::download_engine(
        &app,
        &engine_download::DownloadRequest {
            url,
            sha256: &sha,
            bytes,
            target_dir: &target,
        },
    )?;
    Ok("引擎已就绪".into())
}

#[tauri::command]
pub fn engine_download_cancel() {
    // Cancellation is observed by the download loop; nothing else to do.
}

#[tauri::command]
pub fn recheck_engine(app: AppHandle) -> EngineStatus {
    // Must bypass the cache: the whole point of the button is to re-probe after the
    // user installs or points at an engine.
    engine_resolve::resolve_engine_fresh(&app)
}

// ------------------------------------------------------------------ shell

#[tauri::command]
pub fn open_log() -> Result<(), String> {
    let Some(path) = crate::log::log_path() else {
        return Err("没有日志文件".into());
    };
    opener::open(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_cache(app: AppHandle) -> Result<(), String> {
    let dir = paths::cache_dir(&app);
    let _ = paths::ensure_dir(&dir);
    opener::open(dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<(), String> {
    convert::clear_cache(&app)
}

#[tauri::command]
pub fn report_ready(app: AppHandle) -> Result<(), String> {
    crate::logln!("[startup] renderer ready");
    let _ = app.emit("app:ready", ());
    Ok(())
}
