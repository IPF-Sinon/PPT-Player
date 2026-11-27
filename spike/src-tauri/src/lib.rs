//! Minimal Tauri spike answering three questions about replacing the Electron shell.
//!
//! 1. How long from process start to the first painted frame, and how big is the
//!    installer, compared with the Electron lite build?
//! 2. Does a WebView2 window render what the player depends on: a native PPTX slide,
//!    a translucent blurred toolbar, and canvas ink?
//! 3. Can a custom protocol answer HTTP Range requests with 206 so pdf.js streams?
//!
//! Nothing here is meant to ship. It exists to produce measurements.

use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use std::time::Instant;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, WebviewUrl, WebviewWindowBuilder};

/// When the process started. The first thing that happens, so the number is honest.
static START: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(serde::Serialize, serde::Deserialize)]
struct SpikeReport {
    /// Bytes the frontend actually received through the range request.
    range_bytes: usize,
    /// Whether a 206 with a Content-Range header came back.
    range_ok: bool,
    /// Version string of the webview runtime, so results are attributable.
    webview: String,
    /// What each probe URL returned, so a failure can be diagnosed rather than guessed.
    notes: String,
}

/// Called by the page once it has painted. This is the end of the measurement.
#[tauri::command]
fn report_painted(report: SpikeReport) -> Result<u128, String> {
    let elapsed = START
        .lock()
        .ok()
        .and_then(|s| *s)
        .map(|s| s.elapsed().as_millis())
        .unwrap_or(0);
    eprintln!(
        "[spike] painted_ms={} range_ok={} range_bytes={} webview={}",
        elapsed, report.range_ok, report.range_bytes, report.webview
    );
    eprintln!("[spike] notes: {}", report.notes);
    Ok(elapsed)
}

/// Serve a file with Range support, which is what pdf.js needs in order to stream.
///
/// This is the piece worth measuring: if 206 with a correct Content-Range does not
/// work here, the compatible engine cannot stream and the migration is dead.
fn serve_with_range(path: &std::path::Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(err) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("open failed: {err}").into_bytes())
                .unwrap_or_default()
        }
    };

    let total = file.metadata().map(|m| m.len()).unwrap_or(0);

    // Parse "bytes=start-end"; a missing header means send the whole file.
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let mut parts = v.split('-');
            let start: u64 = parts.next()?.trim().parse().ok()?;
            let end = parts
                .next()
                .and_then(|e| e.trim().parse::<u64>().ok())
                .unwrap_or(total.saturating_sub(1))
                .min(total.saturating_sub(1));
            if start > end {
                None
            } else {
                Some((start, end))
            }
        });

    match range {
        Some((start, end)) => {
            let len = end - start + 1;
            if file.seek(SeekFrom::Start(start)).is_err() {
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Vec::new())
                    .unwrap_or_default();
            }
            let mut buf = vec![0u8; len as usize];
            let read = file.read(&mut buf).unwrap_or(0);
            buf.truncate(read);

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, "application/pdf")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, read.to_string())
                .body(buf)
                .unwrap_or_default()
        }
        None => {
            let mut buf = Vec::with_capacity(total as usize);
            let _ = file.read_to_end(&mut buf);
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/pdf")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, total.to_string())
                .body(buf)
                .unwrap_or_default()
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Ok(mut slot) = START.lock() {
        *slot = Some(Instant::now());
    }

    // The PDF the CI harness stages, copied somewhere the protocol can reach.
    let source_pdf = std::env::var("SPIKE_PDF").unwrap_or_default();

    tauri::Builder::default()
        // The deck protocol: this is the Range probe. The synchronous form is used
        // because it has a stable signature and the file is local, so there is
        // nothing to wait for.
        .register_uri_scheme_protocol("deck", |ctx: UriSchemeContext<'_, _>, request| {
            let path = ctx
                .app_handle()
                .path()
                .app_data_dir()
                .map(|d| d.join("deck.pdf"))
                .unwrap_or_default();
            serve_with_range(&path, &request)
        })
        .invoke_handler(tauri::generate_handler![report_painted])
        .setup(move |app| {
            // The window is created here so the whole startup path stays in view.
            if app.get_webview_window("main").is_none() {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("PPTPlayer Spike")
                    .inner_size(1100.0, 760.0)
                    .build()?;
            }

            if !source_pdf.is_empty() {
                match app.path().app_data_dir() {
                    Ok(dir) => {
                        let _ = std::fs::create_dir_all(&dir);
                        let dest = dir.join("deck.pdf");
                        match std::fs::copy(&source_pdf, &dest) {
                            Ok(bytes) => eprintln!("[spike] staged {} bytes -> {}", bytes, dest.display()),
                            Err(err) => eprintln!("[spike] staging failed: {err}"),
                        }
                    }
                    Err(err) => eprintln!("[spike] no app data dir: {err}"),
                }
            } else {
                eprintln!("[spike] SPIKE_PDF not set; range probe will 404");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}