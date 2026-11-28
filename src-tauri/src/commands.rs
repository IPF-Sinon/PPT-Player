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

/// The part that makes an archive a Word document rather than a deck.
const WORD_MAIN_PART: &str = "word/document.xml";
/// The macro project a .docm carries and a .docx does not.
const WORD_MACRO_PART: &str = "word/vbaProject.bin";

/// Whether an open archive is a Word document.
///
/// The archive's contents decide, not the file name: a presentation and a document
/// are both ZIPs, and a file renamed between the two extensions must still open.
fn is_word_document(vfs: &zip_vfs::ZipVfs) -> bool {
    vfs.has(WORD_MAIN_PART)
}

/// A4 at 96 DPI, which is Word's default page and what a caller that has not read
/// word/document.xml yet should assume.
fn a4_size() -> PageSize {
    PageSize {
        width: 794.0,
        height: 1123.0,
    }
}

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

    /// Whether a deck path was passed on the command line and is still unclaimed.
    ///
    /// Startup reads this to decide whether a launch that asked to stay hidden still
    /// has to show a window: the shell only passes a path because the user asked for
    /// that file, and opening it into a hidden window looks like nothing happened.
    pub fn has_pending_open(&self) -> bool {
        self.pending_open_path
            .lock()
            .map(|slot| slot.is_some())
            .unwrap_or(false)
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

/// Emit a conversion progress event.
///
/// The UI shows a progress bar from these; without them the bar sits at whatever it
/// started with, which reads as a hang on a slow conversion.
fn emit_progress(app: &AppHandle, stage: ConvertStage, ratio: f64, message: &str, deck_id: &str) {
    let _ = app.emit(
        "deck:progress",
        ConvertProgress {
            deck_id: deck_id.to_string(),
            stage,
            ratio,
            message: message.to_string(),
        },
    );
}

/// Open a deck, converting it when the format needs it.
///
/// Async on purpose: a conversion takes tens of seconds, and a synchronous command
/// runs on the main thread, so the window would freeze and stop painting for the whole
/// conversion. The work itself goes to the blocking pool, which is where a
/// long-running child process belongs.
#[tauri::command]
pub async fn open(app: AppHandle, path: String) -> OpenResult {
    emit_progress(&app, ConvertStage::Probe, 0.05, "正在识别文件", "");
    emit_progress(&app, ConvertStage::Convert, 0.15, "正在转换", "");

    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || convert::open_deck(&worker_app, &path))
        .await;

    match result {
        Ok(Ok(info)) => {
            emit_progress(&app, ConvertStage::Done, 1.0, "完成", &info.deck_id);
            OpenResult::ok(info)
        }
        Ok(Err(message)) => {
            emit_progress(&app, ConvertStage::Failed, 0.0, &message, "");
            OpenResult::err("open-failed", message)
        }
        Err(err) => {
            let message = format!("转换任务异常结束：{err}");
            emit_progress(&app, ConvertStage::Failed, 0.0, &message, "");
            OpenResult::err("open-failed", message)
        }
    }
}

/// Open an OOXML file natively: a presentation, or a Word document.
///
/// Both are ZIP containers served through the same pptx:// scheme, so a .docx
/// needs no second protocol and no conversion. What differs is only what the
/// renderer does with the parts: a deck indexes its slides, a document reads
/// word/document.xml and paginates it itself.
///
/// A legacy binary .doc is a CFB, not a ZIP, so detect() never reports it as
/// OoxmlDocument and this returns None: it still goes through the engine.
#[tauri::command]
pub fn open_native(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Option<NativeOpenResult> {
    let p = std::path::Path::new(&path);
    let format = crate::detect::detect(p);
    if format.kind != DeckKind::OoxmlPresentation && format.kind != DeckKind::OoxmlDocument {
        return None;
    }
    let vfs = zip_vfs::ZipVfs::open(p).ok()?;

    // Which main part the archive holds decides how it is read, not the extension:
    // a ZIP named .docx that carries ppt/presentation.xml is a presentation, and
    // treating it as a document would render nothing at all.
    let (slide_paths, slide_size, has_macros) = if is_word_document(&vfs) {
        // A Word document has no slides. Its page size lives in word/document.xml,
        // which the renderer reads itself, so the value here is only a placeholder
        // for a caller that has not looked yet: A4 at 96 DPI.
        (Vec::new(), a4_size(), vfs.has(WORD_MACRO_PART))
    } else {
        let index = index_parse::build_presentation_index(&vfs)?;
        (
            index.slides.iter().map(|s| s.path.clone()).collect(),
            index.slide_size,
            index.has_macros,
        )
    };

    // The id keys the annotation file, so it has to be the same for the same file
    // across sessions. A random id meant annotations were written under one name and
    // looked up under another, which loses them on the next launch or on a switch to
    // compatible mode and back.
    let meta = std::fs::metadata(p).ok()?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let deck_id = convert::deck_id_for(&convert::SourceKey {
        path: &path,
        bytes: meta.len(),
        mtime_ms,
    });

    let result = NativeOpenResult {
        deck_id: deck_id.clone(),
        slide_paths,
        slide_size,
        has_macros,
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

/// Open a spreadsheet natively: .xls, .xlsx, .xlsb, .ods or a delimited text table.
///
/// Separate from open_native because a spreadsheet is not served over pptx://: there is
/// no part for the renderer to parse, and no page to index. calamine reads the workbook
/// here and the model crosses IPC once, which is why the call carries a window rather
/// than a whole sheet.
///
/// sheet names the tab to return, and is also how the renderer switches tabs without
/// reopening the file. first_row and row_count slice a large sheet: a million-row sheet
/// returned whole would be hundreds of megabytes to draw one screenful.
#[tauri::command]
pub async fn open_spreadsheet(
    path: String,
    sheet: Option<String>,
    first_row: Option<u32>,
    row_count: Option<u32>,
) -> Result<crate::spreadsheet::SpreadsheetModel, String> {
    let request = crate::spreadsheet::SheetRequest {
        sheet,
        first_row: first_row.unwrap_or(0),
        row_count: row_count.unwrap_or(0),
    };
    // calamine is synchronous and can take a moment on a large workbook, so the work
    // runs off the async runtime's thread rather than blocking the IPC responder.
    tauri::async_runtime::spawn_blocking(move || {
        crate::spreadsheet::open_spreadsheet(std::path::Path::new(&path), &request)
    })
    .await
    .map_err(|err| format!("表格解析失败：{err}"))?
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
        .add_filter(
            "教学文档",
            &[
                "pptx", "pptm", "ppsx", "pps", "ppt", "odp", "pdf", "docx", "doc", "xlsx", "xls",
            ],
        )
        .add_filter("演示文稿", &["pptx", "pptm", "ppsx", "ppt", "odp"])
        .add_filter("文档", &["docx", "doc"])
        .add_filter("表格", &["xlsx", "xls"])
        .add_filter("PDF", &["pdf"])
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

/// The engine package this build can download.
#[derive(Debug, Clone)]
pub struct EngineSource {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
}

/// Locate the engine manifest, preferring the copy shipped beside the binary.
///
/// The download details used to be compile-time environment variables, and no build ever
/// set them, so every release told the user there was no download address while one was
/// in fact published. Reading the manifest at runtime is what makes the answer depend on
/// the artifact rather than on how it happened to be compiled.
pub fn engine_manifest(app: &AppHandle) -> Option<serde_json::Value> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources").join("engine.json"));
        candidates.push(dir.join("engine.json"));
    }
    // A development run has no resource directory; the manifest sits above the crate.
    candidates.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/engine.json"),
    );
    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            return Some(value);
        }
    }
    None
}

/// Read a download source out of a manifest value.
///
/// Split from the file lookup so the parsing rules can be tested without an app handle.
pub fn engine_source_from(manifest: &serde_json::Value) -> Result<EngineSource, String> {
    let field = |name: &str| -> String {
        manifest
            .get(name)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let url = field("engineZipUrl");
    if url.is_empty() {
        return Err("此版本不包含引擎下载地址".into());
    }
    Ok(EngineSource {
        url,
        sha256: field("engineZipSha256"),
        bytes: manifest
            .get("engineZipBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    })
}

/// The download source for the engine, or the reason there is none.
pub fn engine_source(app: &AppHandle) -> Result<EngineSource, String> {
    let manifest = engine_manifest(app)
        .ok_or_else(|| "此版本不包含引擎清单，无法下载兼容引擎".to_string())?;
    engine_source_from(&manifest)
}

#[tauri::command]
pub async fn engine_download(app: AppHandle) -> Result<String, String> {
    let source = engine_source(&app)?;
    let target = paths::downloaded_engine_dir(&app);
    engine_download::download_engine(
        &app,
        &engine_download::DownloadRequest {
            url: &source.url,
            sha256: &source.sha256,
            bytes: source.bytes,
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

// ------------------------------------------------------------------ startup

/// Whether the app is registered to start with the system.
///
/// The registration is the source of truth, not the settings file: the user can turn
/// the entry off in Task Manager, and a checkbox that then still reads "on" would be
/// lying about the machine it is running on.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    autostart_enabled(&app)
}

/// Register or unregister the login entry, returning the state that is now in effect.
///
/// Returning the observed state rather than the requested one means a refused write
/// (a locked-down machine, a policy block) shows up in the UI as a checkbox that did
/// not move, instead of one that claims a preload that will never happen.
///
/// The same value is mirrored into settings, because settings is what the settings UI
/// reads back at startup: the registration alone would leave that checkbox showing
/// whatever was last saved, which is a different answer after the user edits the entry
/// in Task Manager.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    set_autostart_state(&app, enabled)
}

/// Write the registration, mirror the result into settings, and report what took.
///
/// Shared by the command and the tray checkbox so the two cannot disagree: whichever
/// one flips the switch, the settings file the UI reads at startup ends up carrying the
/// state that is actually registered.
pub fn set_autostart_state(app: &AppHandle, enabled: bool) -> bool {
    if let Err(err) = apply_autostart(app, enabled) {
        crate::logln!("[autostart] could not set {enabled}: {err}");
    }
    let actual = autostart_enabled(app);
    settings::save(
        app,
        SettingsPatch {
            autostart: Some(actual),
            ..Default::default()
        },
    );
    crate::logln!("[autostart] requested {enabled}, now {actual}");
    actual
}

/// Read the autostart registration. An unavailable plugin reads as "off".
pub fn autostart_enabled(app: &AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Write the autostart registration.
///
/// The error is returned rather than swallowed so both callers can decide: the command
/// logs it and reports the real state, the tray logs it and re-syncs its tick.
pub fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}


#[cfg(test)]
mod native_open_tests {
    use super::*;
    use crate::zip_vfs::test_zip::{build, Fixture};

    fn open(entries: &[Fixture]) -> (tempfile::TempDir, zip_vfs::ZipVfs) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file");
        std::fs::write(&path, build(entries)).unwrap();
        (dir, zip_vfs::ZipVfs::open(&path).unwrap())
    }

    #[test]
    fn an_archive_with_word_document_xml_is_a_document() {
        let (_d, vfs) = open(&[Fixture::stored("word/document.xml", b"<w:document/>")]);
        assert!(is_word_document(&vfs));
    }

    #[test]
    fn a_presentation_archive_is_not_a_document() {
        let (_d, vfs) = open(&[Fixture::stored("ppt/presentation.xml", b"<p:presentation/>")]);
        assert!(!is_word_document(&vfs));
    }

    #[test]
    fn the_decision_follows_the_contents_not_the_extension() {
        // Both formats are ZIPs and a file can be renamed; what it holds decides.
        let (_d, vfs) = open(&[
            Fixture::stored("word/document.xml", b"<w:document/>"),
            Fixture::stored("ppt/presentation.xml", b"<p:presentation/>"),
        ]);
        assert!(is_word_document(&vfs));
    }

    #[test]
    fn a_document_is_reported_at_a4_until_the_renderer_reads_its_page_size() {
        let size = a4_size();
        // A4 is 210x297mm, which is 794x1123 px at 96 DPI.
        assert!((size.width - 794.0).abs() < 1.0);
        assert!((size.height - 1123.0).abs() < 1.0);
    }
}

#[cfg(test)]
mod engine_source_tests {
    use super::*;

    #[test]
    fn a_manifest_without_a_url_says_so() {
        // This is the message the user sees; an empty field must not look like a bug.
        let manifest = serde_json::json!({ "engineZipUrl": "", "engineZipSha256": "" });
        let err = engine_source_from(&manifest).unwrap_err();
        assert!(err.contains("不包含引擎下载地址"));
    }

    #[test]
    fn a_full_manifest_yields_the_download_details() {
        let manifest = serde_json::json!({
            "engineZipUrl": "https://example.invalid/engine.zip",
            "engineZipSha256": "abc123",
            "engineZipBytes": 155499416
        });
        let source = engine_source_from(&manifest).unwrap();
        assert_eq!(source.url, "https://example.invalid/engine.zip");
        assert_eq!(source.sha256, "abc123");
        assert_eq!(source.bytes, 155499416);
    }

    #[test]
    fn a_missing_size_is_zero_not_a_panic() {
        let manifest = serde_json::json!({ "engineZipUrl": "https://example.invalid/e.zip" });
        let source = engine_source_from(&manifest).unwrap();
        assert_eq!(source.bytes, 0);
        assert!(source.sha256.is_empty());
    }
}
