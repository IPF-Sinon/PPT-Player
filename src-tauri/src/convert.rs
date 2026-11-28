//! The conversion pipeline and its cache.
//!
//! OWNER: subagent-rust-engine
//!
//! A converted deck is cached by source path, size, and mtime, so reopening the same
//! file is instant and an edited file is re-converted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::engine_lo::{self, ConvertOptions};
use crate::types::{DeckInfo, DeckKind, EngineId, FormatInfo};

/// A source larger than this is refused, matching the Electron limit.
pub const MAX_SOURCE_BYTES: u64 = 200 * 1024 * 1024;
/// A cached PDF smaller than this is not a usable conversion.
const MIN_PDF_BYTES: u64 = 1024;
/// How much of the PDF is scanned when counting pages.
const PDF_SCAN_LIMIT: u64 = 64 * 1024 * 1024;

/// One opened deck, kept so the protocol handler can serve its PDF.
pub struct DeckRecord {
    pub info: DeckInfo,
    pub pdf_path: PathBuf,
}

fn decks() -> &'static Mutex<HashMap<String, DeckRecord>> {
    static DECKS: OnceLock<Mutex<HashMap<String, DeckRecord>>> = OnceLock::new();
    DECKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Lower-case hex of a digest.
fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Identity of a source file on disk.
///
/// The mtime is rounded to whole milliseconds because that is the resolution the
/// filesystems actually report; comparing raw floats would give a deck a new id
/// after a round trip through JSON.
pub struct SourceKey<'a> {
    pub path: &'a str,
    pub bytes: u64,
    pub mtime_ms: f64,
}

/// A stable id for a source file.
///
/// Ink files are stored under this id, so it must not change between sessions for an
/// unchanged file: the path, the size, and the mtime are hashed together, and the
/// first twelve hex digits are kept, exactly like the Electron build.
pub fn deck_id_for(source: &SourceKey<'_>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.path.as_bytes());
    hasher.update(b"|");
    hasher.update(source.bytes.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update((source.mtime_ms.round() as i64).to_string().as_bytes());
    hex_lower(&hasher.finalize())[..12].to_string()
}

/// Where a deck's converted artefacts live.
///
/// The layout is cache_root/<deckId>/deck.pdf plus a meta.json sidecar, which is what
/// the deck protocol and the cache size report both read.
pub fn cache_dir_for(cache_root: &Path, deck_id: &str) -> PathBuf {
    cache_root.join(deck_id)
}

/// Path of the converted PDF for a deck.
pub fn pdf_path_for(cache_root: &Path, deck_id: &str) -> PathBuf {
    cache_dir_for(cache_root, deck_id).join("deck.pdf")
}

/// Path of the sidecar metadata for a deck.
pub fn meta_path_for(cache_root: &Path, deck_id: &str) -> PathBuf {
    cache_dir_for(cache_root, deck_id).join("meta.json")
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Whether a cached conversion can be reused as-is.
fn cache_hit(cache_root: &Path, deck_id: &str) -> Option<PathBuf> {
    let pdf = pdf_path_for(cache_root, deck_id);
    let meta = meta_path_for(cache_root, deck_id);
    if !meta.is_file() || file_size(&pdf) < MIN_PDF_BYTES {
        return None;
    }
    // The sidecar has to describe this deck; a stale one would show the wrong count.
    let text = std::fs::read_to_string(&meta).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    if parsed.get("deckId").and_then(|v| v.as_str()) != Some(deck_id) {
        return None;
    }
    Some(pdf)
}

/// Read the format of a file without loading it.
fn probe(path: &Path) -> Result<(FormatInfo, u64, f64), String> {
    let meta = std::fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => format!("文件不存在：{}", path.display()),
        std::io::ErrorKind::PermissionDenied => format!("没有读取权限：{}", path.display()),
        _ => format!("无法读取文件：{err}"),
    })?;
    if !meta.is_file() {
        return Err(format!("不是一个文件：{}", path.display()));
    }
    if meta.len() == 0 {
        return Err("文件是空的".to_string());
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err("文件超过 200 MB，无法打开".to_string());
    }

    let format = crate::detect::detect(path);
    if format.kind == DeckKind::Unsupported {
        return Err(format.reason.clone().unwrap_or_else(|| "无法识别的文件格式".to_string()));
    }

    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as f64)
        .unwrap_or(0.0);
    Ok((format, meta.len(), mtime_ms))
}

/// Count pages in a PDF without a full parser.
///
/// Walks the file for page objects, which LibreOffice always writes as plain
/// objects. When that finds nothing the page tree count is used, and finally zero,
/// so the renderer can report the real number.
pub fn count_pdf_pages(pdf_path: &Path) -> u32 {
    use std::io::Read;

    let Ok(file) = std::fs::File::open(pdf_path) else {
        return 0;
    };
    let mut text = Vec::new();
    if file.take(PDF_SCAN_LIMIT).read_to_end(&mut text).is_err() {
        return 0;
    }
    let text = String::from_utf8_lossy(&text);

    let pages = count_page_objects(&text);
    if pages > 0 {
        return pages;
    }
    count_from_page_tree(&text).unwrap_or(0)
}

/// Count "/Type /Page" occurrences, which excludes "/Pages".
fn count_page_objects(text: &str) -> u32 {
    const NEEDLE: &str = "/Type";
    let mut count = 0u32;
    let mut rest = text;
    while let Some(index) = rest.find(NEEDLE) {
        rest = &rest[index + NEEDLE.len()..];
        let trimmed = rest.trim_start();
        let Some(after_slash) = trimmed.strip_prefix('/') else {
            continue;
        };
        if !after_slash.starts_with("Page") {
            continue;
        }
        // "/Pages" is the tree node, not a page; anything else must not count either.
        let next = after_slash[4..].chars().next();
        if matches!(next, Some(ch) if ch.is_alphanumeric() || ch == '_') {
            continue;
        }
        count += 1;
    }
    count
}

/// Fall back to the /Count entry of the page tree root.
fn count_from_page_tree(text: &str) -> Option<u32> {
    let mut search = text;
    while let Some(index) = search.find("/Count") {
        search = &search[index + "/Count".len()..];
        let digits: String = search
            .trim_start()
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();
        if let Ok(value) = digits.parse::<u32>() {
            if value > 0 {
                return Some(value);
            }
        }
    }
    None
}

/// Everything about the source file that a DeckInfo reports.
struct DeckSource<'a> {
    deck_id: &'a str,
    path: &'a str,
    bytes: u64,
    mtime_ms: f64,
    format: FormatInfo,
    engine: EngineId,
    engine_path: &'a str,
}

fn build_info(source: DeckSource<'_>, pdf: &Path, convert_ms: f64, cached: bool) -> DeckInfo {
    DeckInfo {
        deck_id: source.deck_id.to_string(),
        source_path: source.path.to_string(),
        source_bytes: source.bytes,
        source_mtime_ms: source.mtime_ms,
        format: source.format,
        page_count: count_pdf_pages(pdf),
        page_sizes: Vec::new(),
        engine: source.engine,
        engine_path: source.engine_path.to_string(),
        convert_ms,
        cached,
        mixed_aspect: false,
        warnings: Vec::new(),
    }
}

/// Write the sidecar that marks a cache entry as complete.
///
/// It is written only once deck.pdf is known good, so a half-finished conversion can
/// never look like a hit.
fn write_meta(cache_root: &Path, info: &DeckInfo) -> Result<(), String> {
    let path = meta_path_for(cache_root, &info.deck_id);
    let value = serde_json::json!({
        "deckId": info.deck_id,
        "sourcePath": info.source_path,
        "sourceBytes": info.source_bytes,
        "sourceMtimeMs": info.source_mtime_ms,
        "engine": info.engine,
        "enginePath": info.engine_path,
        "pageCount": info.page_count,
        "convertMs": info.convert_ms,
        "createdAt": now_millis(),
        "status": "ready",
    });
    let text = serde_json::to_string_pretty(&value).map_err(|err| err.to_string())?;
    std::fs::write(&path, text).map_err(|err| format!("无法写入缓存元数据：{err}"))
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|delta| delta.as_millis())
        .unwrap_or(0)
}

fn register(deck_id: &str, info: &DeckInfo, pdf_path: &Path) {
    if let Ok(mut map) = decks().lock() {
        map.insert(
            deck_id.to_string(),
            DeckRecord {
                info: info.clone(),
                pdf_path: pdf_path.to_path_buf(),
            },
        );
    }
}

/// Open a deck, converting it when the format needs it.
pub fn open_deck(app: &AppHandle, path: &str) -> Result<DeckInfo, String> {
    let source = Path::new(path);
    let (format, bytes, mtime_ms) = probe(source)?;

    if format.kind == DeckKind::EncryptedOoxml {
        return Err("加密的演示文稿需要本机安装 PowerPoint 才能打开".to_string());
    }

    // A PDF is served as it is, and a native OOXML deck is indexed by the renderer
    // without ever reaching this function, so only legacy formats need the engine.
    let is_pdf = format.kind == DeckKind::Pdf;
    let engine = if is_pdf {
        None
    } else {
        Some(crate::engine_resolve::resolve_engine(app))
    };
    if let Some(status) = engine.as_ref().filter(|status| !status.available) {
        let detail = if status.detail.is_empty() {
            String::new()
        } else {
            format!("（{}）", status.detail)
        };
        return Err(format!("转换引擎不可用{detail}"));
    }

    let deck_id = deck_id_for(&SourceKey {
        path,
        bytes,
        mtime_ms,
    });
    let cache_root = crate::paths::cache_dir(app);
    crate::paths::ensure_dir(&cache_root).map_err(|err| format!("无法创建缓存目录：{err}"))?;
    let cache_dir = cache_dir_for(&cache_root, &deck_id);
    let pdf_path = pdf_path_for(&cache_root, &deck_id);

    let engine_id = if is_pdf {
        EngineId::None
    } else {
        EngineId::Libreoffice
    };
    let engine_path = match &engine {
        Some(status) => status.path.clone(),
        None => "pdf".to_string(),
    };

    // A cache hit must never re-convert: that is the whole point of the sidecar.
    if let Some(cached) = cache_hit(&cache_root, &deck_id) {
        let info = build_info(
            DeckSource {
                deck_id: &deck_id,
                path,
                bytes,
                mtime_ms,
                format,
                engine: engine_id,
                engine_path: &engine_path,
            },
            &cached,
            0.0,
            true,
        );
        register(&deck_id, &info, &cached);
        crate::logln!("[open] cache hit {deck_id} for {path}");
        return Ok(info);
    }

    crate::paths::ensure_dir(&cache_dir).map_err(|err| format!("无法创建缓存目录：{err}"))?;

    let mut convert_ms = 0.0;
    if is_pdf {
        // Copying rather than linking keeps one layout for every format, which is what
        // the deck protocol and the cache size report both assume.
        std::fs::copy(source, &pdf_path).map_err(|err| format!("无法读取 PDF：{err}"))?;
    } else {
        let started = std::time::Instant::now();
        crate::logln!("[open] converting {path}");
        let produced = match engine_lo::convert_to_pdf(
            app,
            &ConvertOptions {
                source: source.to_path_buf(),
                out_dir: cache_dir.clone(),
                first_pages: None,
            },
        ) {
            Ok(produced) => produced,
            Err(message) => {
                // Never leave a partial conversion behind for a later open to reuse.
                let _ = std::fs::remove_dir_all(&cache_dir);
                return Err(message);
            }
        };
        convert_ms = started.elapsed().as_millis() as f64;

        // LibreOffice names its output after the source, so it is moved to deck.pdf.
        if produced != pdf_path {
            let _ = std::fs::remove_file(&pdf_path);
            std::fs::rename(&produced, &pdf_path)
                .map_err(|err| format!("无法保存转换结果：{err}"))?;
        }
    }

    if file_size(&pdf_path) < MIN_PDF_BYTES {
        // Leave nothing behind that a later open could mistake for a finished deck.
        let _ = std::fs::remove_dir_all(&cache_dir);
        return Err(if is_pdf {
            "PDF 文件无效或已损坏".to_string()
        } else {
            "转换失败：没有生成有效的 PDF".to_string()
        });
    }

    let info = build_info(
        DeckSource {
            deck_id: &deck_id,
            path,
            bytes,
            mtime_ms,
            format,
            engine: engine_id,
            engine_path: &engine_path,
        },
        &pdf_path,
        convert_ms,
        false,
    );
    write_meta(&cache_root, &info)?;
    register(&deck_id, &info, &pdf_path);
    crate::logln!(
        "[open] converted {path} in {:.0} ms, {} pages",
        convert_ms,
        info.page_count
    );
    Ok(info)
}

/// Where a registered deck's PDF is, for the deck protocol handler.
pub fn deck_pdf_path(deck_id: &str) -> Option<PathBuf> {
    let map = decks().lock().ok()?;
    map.get(deck_id).map(|record| record.pdf_path.clone())
}

/// Drop a deck's cached artefacts.
pub fn close_deck(deck_id: &str) {
    if let Ok(mut map) = decks().lock() {
        map.remove(deck_id);
    }
}

/// Total size of a directory tree, following no links.
fn tree_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => total += tree_bytes(&path),
            Ok(_) => total += file_size(&path),
            Err(_) => {}
        }
    }
    total
}

/// Cache size in bytes, for the settings screen.
pub fn cache_bytes(app: &AppHandle) -> u64 {
    tree_bytes(&crate::paths::cache_dir(app))
}

/// Empty the cache.
pub fn clear_cache(app: &AppHandle) -> Result<(), String> {
    let root = crate::paths::cache_dir(app);
    if !root.is_dir() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&root).map_err(|err| format!("无法读取缓存目录：{err}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        removed.map_err(|err| format!("无法清空缓存：{err}"))?;
    }
    // The PDFs those records pointed at are gone, so the records are too.
    if let Ok(mut map) = decks().lock() {
        map.clear();
    }
    crate::logln!("[cache] cleared");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(path: &str, bytes: u64, mtime_ms: f64) -> SourceKey<'_> {
        SourceKey {
            path,
            bytes,
            mtime_ms,
        }
    }

    #[test]
    fn the_same_source_keeps_the_same_id() {
        // Ink is filed under this id, so it must survive a restart unchanged.
        let first = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1_700_000_000_123.0));
        let second = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1_700_000_000_123.0));
        assert_eq!(first, second);
        assert_eq!(first.len(), 12);
    }

    #[test]
    fn a_touched_file_gets_a_new_id() {
        let before = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1_700_000_000_000.0));
        let after = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1_700_000_001_000.0));
        assert_ne!(before, after);
    }

    #[test]
    fn an_edited_file_gets_a_new_id() {
        let before = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1_700_000_000_000.0));
        let after = deck_id_for(&key("C:\\decks\\a.ppt", 2048, 1_700_000_000_000.0));
        assert_ne!(before, after);
    }

    #[test]
    fn a_different_file_gets_a_different_id() {
        let first = deck_id_for(&key("C:\\decks\\a.ppt", 1024, 1.0));
        let second = deck_id_for(&key("C:\\decks\\b.ppt", 1024, 1.0));
        assert_ne!(first, second);
    }

    #[test]
    fn a_sub_millisecond_mtime_does_not_change_the_id() {
        // The mtime travels through JSON as a float, so it is compared rounded.
        let first = deck_id_for(&key("C:\\a.ppt", 10, 1_700_000_000_000.0));
        let second = deck_id_for(&key("C:\\a.ppt", 10, 1_700_000_000_000.4));
        assert_eq!(first, second);
    }

    #[test]
    fn the_cache_layout_is_deck_id_then_deck_pdf() {
        let root = Path::new("C:\\cache");
        assert_eq!(
            cache_dir_for(root, "abc123"),
            Path::new("C:\\cache").join("abc123")
        );
        assert_eq!(
            pdf_path_for(root, "abc123"),
            Path::new("C:\\cache").join("abc123").join("deck.pdf")
        );
        assert_eq!(
            meta_path_for(root, "abc123"),
            Path::new("C:\\cache").join("abc123").join("meta.json")
        );
    }

    #[test]
    fn pages_are_counted_from_plain_page_objects() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("deck.pdf");
        std::fs::write(
            &pdf,
            b"%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Pages /Count 2 >> endobj\n3 0 obj << /Type /Page >> endobj\n",
        )
        .unwrap();
        assert_eq!(count_pdf_pages(&pdf), 2);
    }

    #[test]
    fn the_page_tree_count_is_used_when_no_page_object_is_found() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("deck.pdf");
        std::fs::write(&pdf, b"%PDF-1.7\n5 0 obj << /Type /Pages /Count 7 >> endobj\n").unwrap();
        assert_eq!(count_pdf_pages(&pdf), 7);
    }

    #[test]
    fn an_unreadable_pdf_counts_zero_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(count_pdf_pages(&dir.path().join("missing.pdf")), 0);
        let empty = dir.path().join("empty.pdf");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(count_pdf_pages(&empty), 0);
    }

    #[test]
    fn a_cache_entry_needs_both_the_pdf_and_the_sidecar() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path();
        let deck_id = "abc123";
        let dir = cache_dir_for(root_path, deck_id);
        std::fs::create_dir_all(&dir).unwrap();

        // A PDF alone is not a hit: the sidecar is what proves it is complete.
        std::fs::write(pdf_path_for(root_path, deck_id), vec![b'x'; 2048]).unwrap();
        assert!(cache_hit(root_path, deck_id).is_none());

        std::fs::write(
            meta_path_for(root_path, deck_id),
            serde_json::json!({ "deckId": deck_id }).to_string(),
        )
        .unwrap();
        assert!(cache_hit(root_path, deck_id).is_some());
    }

    #[test]
    fn a_truncated_cache_entry_is_not_reused() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path();
        let deck_id = "abc123";
        std::fs::create_dir_all(cache_dir_for(root_path, deck_id)).unwrap();
        std::fs::write(pdf_path_for(root_path, deck_id), b"%PDF-1.7").unwrap();
        std::fs::write(
            meta_path_for(root_path, deck_id),
            serde_json::json!({ "deckId": deck_id }).to_string(),
        )
        .unwrap();
        assert!(cache_hit(root_path, deck_id).is_none());
    }

    #[test]
    fn a_sidecar_for_another_deck_is_not_a_hit() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path();
        let deck_id = "abc123";
        std::fs::create_dir_all(cache_dir_for(root_path, deck_id)).unwrap();
        std::fs::write(pdf_path_for(root_path, deck_id), vec![b'x'; 2048]).unwrap();
        std::fs::write(
            meta_path_for(root_path, deck_id),
            serde_json::json!({ "deckId": "something-else" }).to_string(),
        )
        .unwrap();
        assert!(cache_hit(root_path, deck_id).is_none());
    }

    #[test]
    fn the_cache_size_walks_nested_entries() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("abc").join("inner");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("deck.pdf"), vec![0u8; 1000]).unwrap();
        std::fs::write(root.path().join("abc").join("meta.json"), vec![0u8; 24]).unwrap();
        assert_eq!(tree_bytes(root.path()), 1024);
        assert_eq!(tree_bytes(&root.path().join("nope")), 0);
    }

    #[test]
    fn an_unsupported_file_is_refused_before_any_engine_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, b"just text").unwrap();
        assert!(probe(&file).is_err());
    }

    #[test]
    fn an_empty_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("empty.ppt");
        std::fs::write(&file, b"").unwrap();
        assert!(probe(&file).is_err());
    }
}
