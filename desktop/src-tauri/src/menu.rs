//! The standard Mac menus: App, Edit, View, Window and Help.
//! Space (play/pause) stays in the page: no menu item takes it.

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

const REPO_URL: &str = "https://github.com/zog-tech/zoggyfin";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);
    let about = AboutMetadata {
        name: Some("Zoggyfin".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("An open-source client for Jellyfin media servers.".into()),
        license: Some("MPL-2.0".into()),
        website: Some(REPO_URL.into()),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        "Zoggyfin",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Zoggyfin"), Some(about))?,
            &MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?,
            &sep()?,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "search", "Search", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "home", "Home", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "library", "Library", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "music", "Music", true, Some("CmdOrCtrl+3"))?,
            &sep()?,
            &MenuItem::with_id(app, "back", "Back", true, Some("CmdOrCtrl+["))?,
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&MenuItem::with_id(
            app,
            "help",
            "Zoggyfin on GitHub",
            true,
            None::<&str>,
        )?],
    )?;

    Menu::with_items(app, &[&app_menu, &edit, &view, &window, &help])
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match id {
        "help" => {
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open").arg(REPO_URL).spawn();
        }
        "reload" => {
            let _ = window.eval("window.location.reload()");
        }
        "settings" | "check-updates" | "search" | "home" | "library" | "music" | "back" => {
            let _ = window.set_focus();
            crate::send_to_web(&window, id);
        }
        _ => {}
    }
}
