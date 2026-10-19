//! Invite links (`zoggyfin://join#…`). macOS gives the link to the app through the
//! deep-link plugin. The link waits here until the page takes it with
//! `desktop_take_links`; `window.__zoggyfinLink()` tells the page that one is here.
//! The link has a one-time password: never log it.

use std::sync::Mutex;

use tauri::{App, AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
pub struct PendingLinks(Mutex<Vec<String>>);

const MAX_LEN: usize = 8192;

fn keep(handle: &AppHandle, url: String) {
    if url.len() > MAX_LEN || !url.starts_with("zoggyfin://join") {
        return;
    }
    if let Some(state) = handle.try_state::<PendingLinks>() {
        let mut list = state.0.lock().unwrap();
        if !list.contains(&url) {
            list.push(url);
        }
    }
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("window.__zoggyfinLink && window.__zoggyfinLink()");
    }
}

pub fn setup(app: &App) {
    app.manage(PendingLinks::default());
    let handle = app.handle().clone();
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            keep(&handle, url.to_string());
        }
    }
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            keep(&handle, url.to_string());
        }
    });
}

/// The links that came since the last call. The page calls this at start and after
/// `window.__zoggyfinLink()`.
#[tauri::command]
pub fn desktop_take_links(state: tauri::State<'_, PendingLinks>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}
