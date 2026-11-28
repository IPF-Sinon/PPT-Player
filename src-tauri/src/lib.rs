//! Tauri 2 shell for the player.
//!
//! The renderer is the existing React app, unchanged in behaviour. This crate replaces
//! the Electron main process: it serves deck assets over custom protocols, indexes
//! OOXML for the native renderer, drives LibreOffice for everything else, and owns
//! settings and annotations on disk.
//!
//! Module ownership is deliberately one file per concern so the pieces can be worked
//! on without touching each other:
//!
//! - types        shared shapes mirrored to the renderer
//! - detect       what a file is, by content
//! - zip_vfs      random access into a ZIP without extracting it
//! - protocol     deck:// and pptx:// with Range support
//! - index_parse  OOXML presentation index
//! - engine_*     locating, probing, downloading, and running LibreOffice
//! - convert      the conversion pipeline and its cache
//! - settings     persisted preferences
//! - ink          per-deck annotations
//! - commands     the IPC surface

pub mod commands;
pub mod convert;
pub mod detect;
pub mod engine_download;
pub mod engine_lo;
pub mod engine_resolve;
pub mod index_parse;
pub mod ink;
pub mod log;
pub mod paths;
pub mod protocol;
pub mod settings;
pub mod types;
pub mod zip_vfs;

use tauri::Manager;

/// Start the app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = paths::pending_open_path_from_args(std::env::args().skip(1).collect());

    tauri::Builder::default()
        .plugin(tauri::plugin::Builder::new("ppt").build())
        .manage(commands::AppState::new(pending))
        .register_uri_scheme_protocol("deck", |ctx, request| {
            protocol::handle_deck(ctx.app_handle(), &request)
        })
        .register_uri_scheme_protocol("pptx", |ctx, request| {
            protocol::handle_pptx(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe,
            commands::open,
            commands::open_native,
            commands::cancel_open,
            commands::close_deck,
            commands::report_metrics,
            commands::pick_file,
            commands::deck_url,
            commands::pptx_url,
            commands::enter_playback,
            commands::exit_playback,
            commands::load_ink,
            commands::save_ink,
            commands::get_settings,
            commands::set_settings,
            commands::bootstrap,
            commands::engine_status,
            commands::engine_variant,
            commands::set_lo_path,
            commands::pick_lo_path,
            commands::engine_download,
            commands::engine_download_cancel,
            commands::recheck_engine,
            commands::open_log,
            commands::reveal_cache,
            commands::clear_cache,
            commands::report_ready,
        ])
        .setup(|app| {
            log::init(app.handle());
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("PPT 放映器")
            .inner_size(1280.0, 820.0)
            .min_inner_size(960.0, 640.0)
            .background_color(tauri::window::Color(243, 244, 246, 255))
            .build()?;

            // Leaving fullscreen by any route must put the UI back into preview.
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    commands::emit_play_state(&handle);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the app");
}
