//! Custom protocols for deck assets.
//!
//! OWNER: subagent-rust-data
//!
//! deck:// serves a converted PDF and must answer Range requests, because pdf.js
//! streams instead of downloading. pptx:// serves individual OOXML parts to the
//! native renderer. Both are cross-origin from the page, so both must carry CORS
//! headers; the spike proved this the hard way with a bare "Failed to fetch".

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::commands::AppState;

/// Serve a converted deck PDF, honouring Range.
pub fn handle_deck(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if *request.method() == Method::OPTIONS {
        return preflight();
    }

    // The URL shape is /<deckId>/deck.pdf, as commands::deck_url builds it.
    let Some((deck_id, rest)) = split_path(request.uri().path()) else {
        return not_found("missing deck id");
    };
    if !is_safe_id(&deck_id) || rest != "deck.pdf" {
        return not_found("no such deck");
    }

    let path = crate::paths::cache_dir(app).join(&deck_id).join("deck.pdf");
    serve_file_with_range(&path, "application/pdf", request)
}

/// Serve one part of a natively opened PPTX.
pub fn handle_pptx(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if *request.method() == Method::OPTIONS {
        return preflight();
    }

    // The URL shape is /<deckId>/<part...>, as commands::pptx_url builds it.
    let Some((deck_id, part_path)) = split_path(request.uri().path()) else {
        return not_found("missing deck id");
    };
    if part_path.is_empty() {
        return not_found("missing part path");
    }
    // A part path is archive-internal, so any traversal segment means the caller is
    // asking for something outside the deck. Refusing is the whole point of the check.
    if has_traversal(&part_path) {
        return bad_request("part path escapes the archive");
    }
    if !is_safe_id(&deck_id) {
        return not_found("no such deck");
    }

    let bytes = {
        let state = app.state::<AppState>();
        let decks = match state.native_decks.lock() {
            Ok(decks) => decks,
            Err(_) => return internal_error("deck registry is poisoned"),
        };
        let Some(deck) = decks.get(&deck_id) else {
            return not_found("no such deck");
        };
        match deck.vfs.read(&part_path) {
            Ok(bytes) => bytes,
            Err(_) => return not_found("no such part"),
        }
    };

    serve_bytes(&bytes, content_type_for(&part_path))
}

/// Answer a CORS preflight.
///
/// Without this the browser reports a bare "Failed to fetch" and the real request is
/// never sent, which is exactly how the spike lost an afternoon.
fn preflight() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges")
        .body(Vec::new())
        .unwrap_or_default()
}

/// Serve a file, honouring a byte Range when one is asked for.
///
/// This is the logic the spike verified end to end: 206 plus Content-Range for a
/// range, a plain 200 otherwise, and CORS on both so the page can read the response.
fn serve_file_with_range(
    path: &Path,
    content_type: &str,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return not_found("no such file"),
    };

    let total = file.metadata().map(|m| m.len()).unwrap_or(0);

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, total));

    match range {
        Some((start, end)) => {
            let len = end - start + 1;
            if file.seek(SeekFrom::Start(start)).is_err() {
                return internal_error("seek failed");
            }
            // Read exactly the requested window. A single read() may return short, and a
            // body shorter than the Content-Range claims is what makes pdf.js give up.
            let mut buf = Vec::with_capacity(len as usize);
            let mut window = file.take(len);
            let _ = window.read_to_end(&mut buf);
            let read = buf.len();

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, read.to_string())
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges")
                .body(buf)
                .unwrap_or_default()
        }
        None => {
            let mut buf = Vec::new();
            let _ = file.read_to_end(&mut buf);
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, total.to_string())
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges")
                .body(buf)
                .unwrap_or_default()
        }
    }
}

/// Serve an in-memory part. Parts are small, so no range handling is needed.
fn serve_bytes(bytes: &[u8], content_type: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Accept-Ranges")
        .body(bytes.to_vec())
        .unwrap_or_default()
}

fn not_found(message: &str) -> Response<Vec<u8>> {
    plain(StatusCode::NOT_FOUND, message)
}

fn bad_request(message: &str) -> Response<Vec<u8>> {
    plain(StatusCode::BAD_REQUEST, message)
}

fn internal_error(message: &str) -> Response<Vec<u8>> {
    plain(StatusCode::INTERNAL_SERVER_ERROR, message)
}

/// A short plain-text response. The body is deliberately tiny: it is read by a
/// developer or a log, never by the UI.
fn plain(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.as_bytes().to_vec())
        .unwrap_or_default()
}

/// Parse a Range header into an inclusive byte interval.
///
/// Only the single-interval form is supported, because pdf.js only ever asks for
/// one. A suffix range (bytes=-500) and a multi-range request are both reported as
/// unsupported, which makes the caller fall back to the whole file rather than
/// answering something the client did not ask for.
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if total == 0 {
        return None;
    }

    let mut parts = spec.split('-');
    let start_raw = parts.next()?.trim();
    let end_raw = parts.next()?.trim();
    // A third part means a multi-range request such as "bytes=0-1,4-5".
    if parts.next().is_some() {
        return None;
    }
    // A suffix range has no start, and is not supported.
    if start_raw.is_empty() {
        return None;
    }

    let start: u64 = start_raw.parse().ok()?;
    let last = total - 1;
    let end = if end_raw.is_empty() {
        last
    } else {
        end_raw.parse::<u64>().ok()?.min(last)
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

/// Split a request path into its deck id and the rest, percent-decoded.
fn split_path(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let mut parts = trimmed.splitn(2, '/');
    let deck_id = decode_percent(parts.next()?);
    let rest = parts.next().map(decode_percent).unwrap_or_default();
    Some((deck_id, rest))
}

/// A deck id is a hex uuid; anything with a separator or a dot is not one.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Whether a decoded part path tries to leave the archive.
fn has_traversal(path: &str) -> bool {
    path.contains("..")
}

/// Decode %XX escapes. An escape that is not valid hex is kept literally, because
/// the only paths that arrive here are internal part names.
fn decode_percent(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0usize;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() {
            let high = (bytes[at + 1] as char).to_digit(16);
            let low = (bytes[at + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                out.push((high * 16 + low) as u8);
                at += 3;
                continue;
            }
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The type a part is served as.
///
/// A slide references images, audio and video, and the webview decides whether it can
/// decode a part from this header alone. Serving everything as text/plain meant every
/// embedded picture and every sound failed to load.
fn content_type_for(part_path: &str) -> &'static str {
    let lower = part_path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "xml" | "rels" => "application/xml",
        "png" => "image/png",
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "emf" => "image/emf",
        "wmf" => "image/wmf",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_closed_range() {
        assert_eq!(parse_range("bytes=0-1023", 4096), Some((0, 1023)));
    }

    #[test]
    fn an_open_range_runs_to_the_end() {
        assert_eq!(parse_range("bytes=100-", 4096), Some((100, 4095)));
    }

    #[test]
    fn a_suffix_range_is_unsupported() {
        // pdf.js never asks for one, and guessing at the semantics would answer a
        // question the client did not ask.
        assert_eq!(parse_range("bytes=-500", 4096), None);
    }

    #[test]
    fn malformed_ranges_are_unsupported() {
        assert_eq!(parse_range("", 4096), None);
        assert_eq!(parse_range("bytes=", 4096), None);
        assert_eq!(parse_range("bytes=abc-def", 4096), None);
        assert_eq!(parse_range("items=0-10", 4096), None);
        assert_eq!(parse_range("bytes=0-1,4-5", 4096), None);
        assert_eq!(parse_range("bytes=10", 4096), None);
    }

    #[test]
    fn an_inverted_range_is_unsupported() {
        assert_eq!(parse_range("bytes=200-100", 4096), None);
    }

    #[test]
    fn an_end_past_the_file_is_clamped() {
        assert_eq!(parse_range("bytes=4000-9999", 4096), Some((4000, 4095)));
    }

    #[test]
    fn an_empty_file_has_no_range() {
        assert_eq!(parse_range("bytes=0-10", 0), None);
    }

    #[test]
    fn splits_a_deck_path() {
        let (id, rest) = split_path("/abc123/deck.pdf").unwrap();
        assert_eq!(id, "abc123");
        assert_eq!(rest, "deck.pdf");
    }

    #[test]
    fn splits_a_nested_part_path() {
        let (id, rest) = split_path("/abc123/ppt/slides/slide1.xml").unwrap();
        assert_eq!(id, "abc123");
        assert_eq!(rest, "ppt/slides/slide1.xml");
    }

    #[test]
    fn decodes_percent_escapes_in_a_part_path() {
        let (_, rest) = split_path("/abc123/ppt/media/image%201.png").unwrap();
        assert_eq!(rest, "ppt/media/image 1.png");
    }

    #[test]
    fn rejects_a_path_with_no_deck_id() {
        assert!(split_path("/").is_none());
        assert!(split_path("").is_none());
    }

    #[test]
    fn traversal_in_a_part_path_is_detected() {
        assert!(has_traversal("../../etc/passwd"));
        assert!(has_traversal("ppt/../../x.xml"));
        assert!(!has_traversal("ppt/slides/slide1.xml"));
    }

    #[test]
    fn a_deck_id_must_look_like_one() {
        assert!(is_safe_id("9f8a1c2d3e4f"));
        assert!(is_safe_id("9F8A-1C2D"));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("../escape"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id("a.b"));
    }

    #[test]
    fn ooxml_parts_are_served_as_xml() {
        assert_eq!(content_type_for("ppt/slides/slide1.xml"), "application/xml");
        assert_eq!(content_type_for("ppt/_rels/presentation.xml.rels"), "application/xml");
        assert_eq!(content_type_for("ppt/media/image1.png"), "text/plain");
    }
}
