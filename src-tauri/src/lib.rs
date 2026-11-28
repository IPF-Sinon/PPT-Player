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
//! - spreadsheet  native .xls / .xlsx / .csv parsing, with no engine
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
pub mod spreadsheet;
pub mod types;
pub mod zip_vfs;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// Whether the tray icon exists.
///
/// Closing the window only hides it when there is a tray to bring it back from. Without
/// this guard a failed tray build would leave the app running with no window and no way
/// to reach it: the process would have to be killed from Task Manager.
static TRAY_READY: AtomicBool = AtomicBool::new(false);

/// Command-line switch that means "preload, do not show a window".
///
/// The login autostart entry is registered with it, so booting the machine puts a warm
/// webview in the tray and a later double-click only has to reveal it.
const SILENT_FLAG: &str = "--silent";

/// Labels the tray menu items are addressed by. Kept as constants so the handler and
/// the builder cannot drift apart on a typo.
const TRAY_SHOW: &str = "tray-show";
const TRAY_AUTOSTART: &str = "tray-autostart";
const TRAY_QUIT: &str = "tray-quit";

/// Start the app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else: a release build aborts on panic and has no console, so a
    // crash during startup would otherwise leave no trace at all.
    log::install_panic_hook();
    if let Some(dir) = dirs::data_dir() {
        log::set_file(dir.join("com.ipf.sinon.pptplayer").join("config").join("ppt-player.log"));
    }

    let argv: Vec<String> = std::env::args().skip(1).collect();
    // Read before anything consumes argv: a silent launch is the autostart entry, and
    // it must not put a window in front of whatever the user is doing at login.
    let silent = is_silent_launch(&argv);
    let pending = paths::pending_open_path_from_args(argv);

    tauri::Builder::default()
        // A second launch must focus the existing window and hand it the file, which
        // is what Electron's second-instance event did. Without this the app either
        // opens twice or silently drops the file.
        //
        // This is also the whole point of the preload: the process that ran at login
        // already paid for WebView2 startup, so the launch the user makes is this
        // callback plus a window that was built in the background.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            reveal_main_window(app);
            // The second launch's arguments, minus the program itself: the file it
            // names is what the user actually asked for.
            if let Some(file) = paths::pending_open_path_from_args(without_own_exe(argv)) {
                let _ = app.emit("app:open-external", file);
            }
        }))
        // Registered without arguments: the login entry carries "--silent", which the
        // plugin appends to the executable path it writes.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![SILENT_FLAG]),
        ))
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
            commands::open_spreadsheet,
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
            commands::get_autostart,
            commands::set_autostart,
        ])
        .setup(move |app| {
            log::init(app.handle());

            // The window is declared in tauri.conf.json, so it already exists here.
            // Building a second one with the same label made setup fail with
            // WebviewLabelAlreadyExists, and because release builds abort on panic and
            // hide the console, that surfaced as the app silently never appearing.
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "the main window declared in tauri.conf.json is missing")?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                // Closing the window hides it instead of ending the process. A tray
                // preload that dies on the first close would have to pay WebView2
                // startup again for the next class, which is the cost this whole
                // feature exists to avoid; 完全退出 in the tray menu is the real exit.
                //
                // Only when the tray is actually there: hiding with no tray would leave
                // a running process nobody can reach.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if TRAY_READY.load(Ordering::Relaxed) {
                        api.prevent_close();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                // Leaving fullscreen by any route must put the UI back into preview,
                // otherwise the chrome stays hidden over a normal window.
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) => {
                    commands::emit_play_state(&handle);
                }
                _ => {}
            });

            // The tray is the only way back to a hidden window, so it is built on every
            // launch, not just a silent one, and before the window is hidden: hiding
            // first would leave the process unreachable if the tray then failed.
            build_tray(app.handle());

            // A launch that names a file has to end up visible whatever the flag said:
            // the shell only passes a path because the user asked for that file, and
            // opening it into a window nobody can see looks like nothing happened. A
            // launch with no tray to sit in has to be visible for the same reason.
            let show_window = !silent
                || !TRAY_READY.load(Ordering::Relaxed)
                || app.state::<commands::AppState>().has_pending_open();

            // The window is shown from setup rather than left to the runtime: a silent
            // launch has to come up with nothing on screen, and there is no supported
            // way to stop a declared window from being created, only to keep it out of
            // sight.
            if show_window {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                let _ = window.hide();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the app");
}

/// Whether a switch is present on a command line.
///
/// Exact match, not a prefix: a launch must not be treated as silent because some other
/// switch happens to start with the same text.
fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

/// Whether this process was started by the login entry rather than by the user.
///
/// Split out from run() so the rule is testable: getting it backwards means either a
/// window in the user's face at every login, or a preload that never appears when the
/// user does ask for it.
fn is_silent_launch(args: &[String]) -> bool {
    has_flag(args, SILENT_FLAG)
}

/// Drop the program itself from a command line.
///
/// The single-instance plugin hands over the raw arguments of the second launch, and
/// whether the program path is among them is a detail of the plugin rather than of this
/// app. The executable is an existing file, so pending_open_path_from_args would
/// otherwise return it as the deck to open; removing it is a no-op when it is absent.
fn without_own_exe(args: Vec<String>) -> Vec<String> {
    let exe = std::env::current_exe().ok();
    args.into_iter()
        .filter(|arg| match &exe {
            Some(exe) => std::path::Path::new(arg) != exe.as_path(),
            None => true,
        })
        .collect()
}

/// Bring the main window back, whether it was hidden, minimised, or never shown.
///
/// Both callers are outside the UI: the single-instance callback and the tray. A
/// window that was hidden at a silent launch is not minimised, so unminimize alone
/// leaves it invisible, which is why show() and focus are unconditional here.
pub fn reveal_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::write("[window] no main window to reveal");
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Build the tray icon and its menu.
///
/// Nothing here is allowed to fail the launch: a missing tray is a degraded app, not a
/// dead one, and the CI smoke test would otherwise read a tray problem as a startup
/// panic. Every failure path is logged and swallowed.
fn build_tray(app: &AppHandle) {
    // The checkbox is moved into the handler rather than looked up by id at click
    // time: the menu is owned by the runtime, and the item handle is the only thing
    // that can be re-ticked without a lookup that may return nothing.
    let (menu, autostart_tick) = match tray_menu(app) {
        Ok(parts) => parts,
        Err(err) => {
            log::write(&format!("[tray] menu unavailable: {err}"));
            return;
        }
    };

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        // The menu is the interface; a left click would otherwise show it too and the
        // second click would look like nothing happened.
        .show_menu_on_left_click(false)
        // event.id is MenuId(pub String), so .0 is the id string itself. Reading the
        // field avoids depending on which AsRef impls MenuId happens to carry.
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id.0.as_str(), &autostart_tick)
        })
        // A left click is the second way back to a hidden window; the menu itself is
        // on the right button (show_menu_on_left_click is off above).
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                reveal_main_window(tray.app_handle());
            }
        });

    // The icon is the app's own, taken from the bundle rather than from a second file
    // that could drift. Without it the tray entry is an invisible hit target.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    match builder.build(app) {
        Ok(_) => TRAY_READY.store(true, Ordering::Relaxed),
        Err(err) => log::write(&format!("[tray] could not build the tray icon: {err}")),
    }
}

/// The tray menu: show the window, toggle autostart, quit.
///
/// The checkbox is returned alongside the menu so its handler can redraw it.
fn tray_menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, CheckMenuItem<Wry>)> {
    let show = MenuItem::with_id(app, TRAY_SHOW, "显示主窗口", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        TRAY_AUTOSTART,
        "开机自启动",
        true,
        commands::autostart_enabled(app),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "完全退出", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;

    // Built by appending rather than through Menu::with_items: that takes one item type
    // for the whole slice, and these are three (MenuItem, CheckMenuItem,
    // PredefinedMenuItem). append takes &dyn IsMenuItem, so the coercion is explicit.
    let menu = Menu::new(app)?;
    menu.append(&show)?;
    menu.append(&sep_a)?;
    menu.append(&autostart)?;
    menu.append(&sep_b)?;
    menu.append(&quit)?;
    Ok((menu, autostart))
}

/// What a tray menu item does.
///
/// The checkbox is never trusted for the new value: the registration is re-read after
/// the write, so a refused write leaves the tick showing the state that is actually in
/// effect rather than the one that was asked for.
fn handle_menu_event(app: &AppHandle, id: &str, autostart_item: &CheckMenuItem<Wry>) {
    match id {
        TRAY_SHOW => reveal_main_window(app),
        TRAY_AUTOSTART => {
            // A menu click does not toggle a check item on its own, so the new value is
            // the opposite of the state on disk rather than of whatever the tick shows.
            let wanted = !commands::autostart_enabled(app);
            let actual = commands::set_autostart_state(app, wanted);
            let _ = autostart_item.set_checked(actual);
        }
        // Not window.close(): that would be caught by the hide-on-close handler and the
        // app would never exit.
        TRAY_QUIT => app.exit(0),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_login_entry_is_the_only_silent_launch() {
        // The plugin appends this switch to the login entry it writes, so a launch
        // without it is the user asking to see the app and must not be hidden.
        assert!(is_silent_launch(&args(&["--silent"])));
        assert!(!is_silent_launch(&args(&[])));
        assert!(!is_silent_launch(&args(&["C:\\decks\\a.pptx"])));
        // Substring matching would hide the window on any switch that merely starts
        // with the same text, which is the kind of bug that only shows up at login.
        assert!(!is_silent_launch(&args(&["--silent-start"])));
    }

    #[test]
    fn a_deck_named_like_the_switch_is_still_a_deck() {
        // The path is compared whole, so a file whose name matches the switch is a
        // path like any other rather than a launch mode.
        assert!(!is_silent_launch(&args(&["C:\\decks\\--silent"])));
    }

    #[test]
    fn the_second_launch_does_not_offer_its_own_exe_as_a_deck() {
        // The plugin's argv may or may not start with the program path; if it does and
        // it is left in, the app opens its own executable as if it were a presentation.
        let exe = std::env::current_exe().unwrap().to_string_lossy().to_string();
        let cleaned = without_own_exe(args(&[exe.as_str(), "C:\\decks\\a.pptx"]));
        assert_eq!(cleaned, args(&["C:\\decks\\a.pptx"]));
        // A command line without it is untouched.
        assert_eq!(
            without_own_exe(args(&["C:\\decks\\a.pptx"])),
            args(&["C:\\decks\\a.pptx"])
        );
    }
}
