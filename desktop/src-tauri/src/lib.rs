//! Zoggyfin desktop: the Expo web build in a Tauri window. Video plays
//! through libmpv (`mpv`), drawn under the transparent web view; the web app
//! draws the player controls. Menus send commands to the web app.

#[cfg(debug_assertions)]
mod debug;
mod menu;
mod mpv;

use tauri::{Manager, RunEvent, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// Runs a command in the web app (`src/platform/desktop.ts`).
pub(crate) fn send_to_web<R: tauri::Runtime>(window: &WebviewWindow<R>, command: &str) {
    let js = format!(
        "window.__zoggyfinDesktop&&window.__zoggyfinDesktop.menu({})",
        serde_json::json!(command)
    );
    let _ = window.eval(js);
}

#[tauri::command]
fn desktop_toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
fn desktop_is_fullscreen(window: WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(mpv::MpvState::default())
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            desktop_toggle_fullscreen,
            desktop_is_fullscreen,
            mpv::mpv_command,
            mpv::mpv_set_property,
            mpv::mpv_get_property,
            mpv::mpv_set_video_visible,
            #[cfg(debug_assertions)]
            debug::debug_log,
        ])
        .setup(|app| {
            let handle = app.handle();
            // Without libmpv the app still runs; video falls back to the web player.
            let with_mpv = match mpv::start(handle) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("[mpv] {e}");
                    false
                }
            };
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("the main window config")
                .clone();
            let window = WebviewWindowBuilder::from_config(handle, &config)?
                .initialization_script(format!("window.__ZOGGYFIN_MPV__ = {with_mpv};"))
                .build()?;
            if with_mpv {
                if let Err(e) = mpv::attach(handle, &window) {
                    eprintln!("[mpv] {e}");
                }
            }
            #[cfg(debug_assertions)]
            debug::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                mpv::scale_changed(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("build the Tauri app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            mpv::shutdown(handle);
        }
    });
}
