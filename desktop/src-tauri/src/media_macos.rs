//! macOS Now Playing and media keys for libmpv video.
//!
//! The web app sends the title, the times and the play state
//! (`now_playing_update`). This module writes them to MPNowPlayingInfoCenter
//! (Control Center, the menu bar, the lock screen) and adds handlers to
//! MPRemoteCommandCenter (the media keys, AirPods, Control Center buttons).
//! The handlers send commands to `window.__zoggyfinDesktop.remote(event)`.
//!
//! The handlers are only there while libmpv plays. Music plays in the web
//! view, and WebKit gives it Now Playing through the Media Session API.

use std::ptr::NonNull;
use std::sync::Mutex;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2_app_kit::NSImage;
use objc2_core_foundation::CGSize;
use objc2_foundation::{NSData, NSMutableDictionary, NSNumber, NSString};
use objc2_media_player::{
    MPChangePlaybackPositionCommandEvent, MPMediaItemArtwork, MPMediaItemPropertyArtist, MPMediaItemPropertyArtwork,
    MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle, MPNowPlayingInfoCenter, MPNowPlayingInfoMediaType,
    MPNowPlayingInfoPropertyElapsedPlaybackTime, MPNowPlayingInfoPropertyMediaType,
    MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingPlaybackState, MPRemoteCommand, MPRemoteCommandCenter,
    MPRemoteCommandEvent, MPRemoteCommandHandlerStatus,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

/// What the web app knows about the playing video.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub playing: bool,
    #[serde(default = "one")]
    pub rate: f64,
}

fn one() -> f64 {
    1.0
}

/// The registered handlers and the loaded artwork. Main thread only.
#[derive(Default)]
struct Inner {
    targets: Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>,
    artwork_url: Option<String>,
    artwork: Option<Retained<MPMediaItemArtwork>>,
    last: Option<NowPlaying>,
}

// SAFETY: `Inner` is only used on the main thread (every access goes through `run_on_main_thread`).
unsafe impl Send for Inner {}

#[derive(Default)]
pub struct MediaState {
    inner: Mutex<Inner>,
}

fn send<R: Runtime>(app: &AppHandle<R>, event: Value) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!(
            "window.__zoggyfinDesktop&&window.__zoggyfinDesktop.remote&&window.__zoggyfinDesktop.remote({event})"
        ));
    }
}

fn add<R: Runtime>(
    inner: &mut Inner,
    command: Retained<MPRemoteCommand>,
    app: &AppHandle<R>,
    make: impl Fn(&MPRemoteCommandEvent) -> Value + 'static,
) {
    let app = app.clone();
    let block = RcBlock::new(move |event: NonNull<MPRemoteCommandEvent>| {
        // SAFETY: MediaPlayer passes a valid event for the call.
        let event = unsafe { event.as_ref() };
        send(&app, make(event));
        MPRemoteCommandHandlerStatus::Success
    });
    // SAFETY: main thread; the block lives as long as the target.
    unsafe {
        command.setEnabled(true);
        let target = command.addTargetWithHandler(&block);
        inner.targets.push((command, target));
    }
}

fn register<R: Runtime>(inner: &mut Inner, app: &AppHandle<R>) {
    if !inner.targets.is_empty() {
        return;
    }
    // SAFETY: main thread.
    unsafe {
        let center = MPRemoteCommandCenter::sharedCommandCenter();
        add(inner, center.playCommand(), app, |_| json!({ "command": "play" }));
        add(inner, center.pauseCommand(), app, |_| json!({ "command": "pause" }));
        add(
            inner,
            center.togglePlayPauseCommand(),
            app,
            |_| json!({ "command": "toggle" }),
        );
        add(inner, center.stopCommand(), app, |_| json!({ "command": "pause" }));
        add(inner, center.nextTrackCommand(), app, |_| json!({ "command": "next" }));
        add(
            inner,
            center.previousTrackCommand(),
            app,
            |_| json!({ "command": "previous" }),
        );
        let skip = [NSNumber::new_f64(10.0)];
        let forward = center.skipForwardCommand();
        forward.setPreferredIntervals(&objc2_foundation::NSArray::from_retained_slice(&skip));
        add(
            inner,
            Retained::into_super(forward),
            app,
            |_| json!({ "command": "skip", "seconds": 10 }),
        );
        let back = center.skipBackwardCommand();
        back.setPreferredIntervals(&objc2_foundation::NSArray::from_retained_slice(&skip));
        add(
            inner,
            Retained::into_super(back),
            app,
            |_| json!({ "command": "skip", "seconds": -10 }),
        );
        add(
            inner,
            Retained::into_super(center.changePlaybackPositionCommand()),
            app,
            |e| {
                // SAFETY: this command sends MPChangePlaybackPositionCommandEvent.
                let e = &*(e as *const MPRemoteCommandEvent as *const MPChangePlaybackPositionCommandEvent);
                json!({ "command": "seek", "position": e.positionTime() })
            },
        );
    }
}

fn unregister(inner: &mut Inner) {
    for (command, target) in inner.targets.drain(..) {
        // SAFETY: main thread; the target came from addTargetWithHandler on this command.
        unsafe {
            command.removeTarget(Some(&target));
            command.setEnabled(false);
        }
    }
}

fn artwork_from(bytes: &[u8]) -> Option<Retained<MPMediaItemArtwork>> {
    let data = NSData::with_bytes(bytes);
    let image = NSImage::initWithData(NSImage::alloc(), &data)?;
    let size = image.size();
    let held = image.clone();
    let block = RcBlock::new(move |_size: CGSize| -> NonNull<NSImage> { NonNull::from(&*held) });
    // SAFETY: the block returns an image that the block itself keeps alive.
    Some(unsafe { MPMediaItemArtwork::initWithBoundsSize_requestHandler(MPMediaItemArtwork::alloc(), size, &block) })
}

fn publish(inner: &Inner, np: &NowPlaying) {
    // SAFETY: main thread; the keys are MediaPlayer constants.
    unsafe {
        let info: Retained<NSMutableDictionary<NSString, AnyObject>> = NSMutableDictionary::new();
        let put = |k: &NSString, v: &AnyObject| info.insert(k, v);
        put(MPMediaItemPropertyTitle, &NSString::from_str(&np.title));
        if let Some(s) = np.subtitle.as_deref().filter(|s| !s.is_empty()) {
            put(MPMediaItemPropertyArtist, &NSString::from_str(s));
        }
        if np.duration > 0.0 {
            put(MPMediaItemPropertyPlaybackDuration, &NSNumber::new_f64(np.duration));
        }
        put(
            MPNowPlayingInfoPropertyElapsedPlaybackTime,
            &NSNumber::new_f64(np.position.max(0.0)),
        );
        put(
            MPNowPlayingInfoPropertyPlaybackRate,
            &NSNumber::new_f64(if np.playing { np.rate } else { 0.0 }),
        );
        put(
            MPNowPlayingInfoPropertyMediaType,
            &NSNumber::new_usize(MPNowPlayingInfoMediaType::Video.0),
        );
        if let Some(a) = &inner.artwork {
            put(MPMediaItemPropertyArtwork, a);
        }
        let center = MPNowPlayingInfoCenter::defaultCenter();
        center.setNowPlayingInfo(Some(&info));
        center.setPlaybackState(if np.playing {
            MPNowPlayingPlaybackState::Playing
        } else {
            MPNowPlayingPlaybackState::Paused
        });
    }
}

/// Main thread: shows the video in Now Playing and takes the media keys.
fn update<R: Runtime>(app: &AppHandle<R>, np: NowPlaying) {
    let state = app.state::<MediaState>();
    let mut inner = state.inner.lock().unwrap();
    register(&mut inner, app);
    if inner.artwork_url != np.artwork_url {
        inner.artwork_url = np.artwork_url.clone();
        inner.artwork = None;
        if let Some(url) = np.artwork_url.clone() {
            fetch_artwork(app, url);
        }
    }
    publish(&inner, &np);
    inner.last = Some(np);
}

fn fetch_artwork<R: Runtime>(app: &AppHandle<R>, url: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(resp) = reqwest::get(&url).await else { return };
        if !resp.status().is_success() {
            return;
        }
        let Ok(bytes) = resp.bytes().await else { return };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<MediaState>();
            let mut inner = state.inner.lock().unwrap();
            if inner.artwork_url.as_deref() != Some(url.as_str()) {
                return;
            }
            inner.artwork = artwork_from(&bytes);
            if let Some(np) = inner.last.clone() {
                publish(&inner, &np);
            }
        });
    });
}

/// Main thread: playback ended; give Now Playing and the media keys back.
fn clear<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<MediaState>();
    let mut inner = state.inner.lock().unwrap();
    unregister(&mut inner);
    inner.artwork = None;
    inner.artwork_url = None;
    inner.last = None;
    // SAFETY: main thread.
    unsafe {
        let center = MPNowPlayingInfoCenter::defaultCenter();
        center.setNowPlayingInfo(None);
        center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
    }
}

#[tauri::command]
pub fn now_playing_update<R: Runtime>(app: AppHandle<R>, info: NowPlaying) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || update(&handle, info))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn now_playing_clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || clear(&handle))
        .map_err(|e| e.to_string())
}
