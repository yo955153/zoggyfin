//! Updates and the install location (macOS).
//!
//! The web app (`src/platform/updates/`) asks for these steps, and draws the update card:
//!
//! 1. `update_check`: reads `latest.json` (the endpoint is in tauri.conf.json). It returns the
//!    new version and its notes, or `null`. It does not download.
//! 2. `update_download`: downloads the signed `.app.tar.gz` and checks its signature with the
//!    public key in tauri.conf.json. Progress goes to `window.__zoggyfinDesktop.update(event)`.
//! 3. `update_install_and_relaunch`: puts the new bundle in place of the installed bundle, then
//!    quits, and starts the same bundle path again after this process has exited.
//!
//! Rules (from the ZogNotes desktop app, which hit each problem):
//! - The update goes into the bundle that the user installed: the real path of the running
//!   executable, or the original path of an App Translocation path. The updater plugin's own JS
//!   `check()` cannot take that path, so the page calls these commands.
//! - Relaunch: the old process must exit before the new one starts. Tauri's `restart()` runs
//!   `open -n <bundle>` while the old process runs. LaunchServices then has two instances, and
//!   the Dock shows a second icon. Here a detached shell waits for our pid to exit, then runs
//!   `open <bundle>` (no `-n`).
//! - A release build that runs from a disk image, App Translocation or ~/Downloads offers to move
//!   to the Applications folder (with "Don't ask again"). Updates from those places fail or go to
//!   a copy that the user never opens again.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update that `update_check` found, and its bytes after `update_download`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

/// What the page gets from `update_check`.
#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

impl UpdateInfo {
    fn of(update: &Update) -> Self {
        UpdateInfo {
            version: update.version.clone(),
            current: update.current_version.clone(),
            notes: update.body.clone(),
            date: update
                .raw_json
                .get("pub_date")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
        }
    }
}

/// The .app bundle of the running executable (`<bundle>/Contents/MacOS/<exe>`), real path.
pub fn running_bundle() -> Option<PathBuf> {
    let exe = tauri::utils::platform::current_exe().ok()?;
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle =
        macos.file_name()? == "MacOS" && contents.file_name()? == "Contents" && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_path_buf())
}

/// The bundle the user installed: the running bundle, or the original of a translocated one.
pub fn installed_bundle() -> Option<PathBuf> {
    let running = running_bundle()?;
    match translocation::original(&running) {
        Some(original) => Some(std::fs::canonicalize(&original).unwrap_or(original)),
        None => Some(running),
    }
}

fn installed_executable() -> Option<PathBuf> {
    let exe = tauri::utils::platform::current_exe().ok()?;
    Some(installed_bundle()?.join("Contents/MacOS").join(exe.file_name()?))
}

fn send_event(app: &AppHandle, event: serde_json::Value) {
    if let Some(window) = app.get_webview_window("main") {
        let js = format!("window.__zoggyfinDesktop&&window.__zoggyfinDesktop.update({event})");
        let _ = window.eval(js);
    }
}

/// Reads latest.json. Returns the newer version, or None when this version is the newest.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
    if let Some(exe) = installed_executable() {
        builder = builder.executable_path(exe);
    }
    let found = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let mut slot = pending.0.lock().unwrap();
    let Some(update) = found else {
        *slot = Pending::default();
        return Ok(None);
    };
    let info = UpdateInfo::of(&update);
    // Keep the downloaded bytes when the same version is found again.
    let same = slot.update.as_ref().is_some_and(|u| u.version == update.version);
    if !same {
        slot.bytes = None;
    }
    slot.update = Some(update);
    Ok(Some(info))
}

/// Downloads the update that `update_check` found and checks its signature. Sends
/// `{type:'progress', done, total}` events (total is 0 when the server sends no length).
#[tauri::command]
pub async fn update_download(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = {
        let slot = pending.0.lock().unwrap();
        if slot.bytes.is_some() {
            return Ok(());
        }
        slot.update
            .clone()
            .ok_or("No update was found. Check for updates again.")?
    };
    let mut done: u64 = 0;
    let mut last = Instant::now() - Duration::from_secs(1);
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                // At most 10 events a second.
                if last.elapsed() >= Duration::from_millis(100) {
                    last = Instant::now();
                    send_event(
                        &progress_app,
                        serde_json::json!({ "type": "progress", "done": done, "total": total.unwrap_or(0) }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    send_event(
        &app,
        serde_json::json!({ "type": "progress", "done": size, "total": size }),
    );
    let mut slot = pending.0.lock().unwrap();
    if slot.update.as_ref().is_some_and(|u| u.version == update.version) {
        slot.bytes = Some(bytes);
    }
    Ok(())
}

/// Installs the downloaded update into the installed bundle, then quits and starts it again.
/// Async, so it runs off the main thread: an install that needs an administrator password
/// shows its prompt on the main thread and waits for it.
#[tauri::command]
pub async fn update_install_and_relaunch(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let (update, bytes) = {
        let mut slot = pending.0.lock().unwrap();
        match (slot.update.clone(), slot.bytes.take()) {
            (Some(update), Some(bytes)) => (update, bytes),
            _ => return Err("The update is not downloaded.".into()),
        }
    };
    update.install(&bytes).map_err(|e| e.to_string())?;
    let bundle = installed_bundle().ok_or("Cannot find the app on disk.")?;
    relaunch_after_exit(&bundle, None).map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Starts `bundle` through LaunchServices after this process has exited (at most 30 s later),
/// then ejects `detach` (the disk image the app came from) if given. The shell is in its own
/// process group with no stdio, so it outlives this process.
pub fn relaunch_after_exit(bundle: &Path, detach: Option<&Path>) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    let script = r#"i=0
while kill -0 "$1" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done
/usr/bin/open "$2"
if [ -n "$3" ]; then sleep 1; /usr/bin/hdiutil detach "$3" -quiet || true; fi"#;
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("zoggyfin-relaunch")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .arg(detach.map(Path::as_os_str).unwrap_or_default())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(|_| ())
}

mod translocation {
    use core_foundation::base::TCFType;
    use core_foundation::error::CFErrorRef;
    use core_foundation::url::{CFURLRef, CFURL};
    use std::path::{Path, PathBuf};

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecTranslocateIsTranslocatedURL(path: CFURLRef, is_translocated: *mut bool, error: *mut CFErrorRef) -> u8;
        fn SecTranslocateCreateOriginalPathForURL(translocated_path: CFURLRef, error: *mut CFErrorRef) -> CFURLRef;
    }

    /// The path the system translocated `path` from, or None when it is not translocated.
    pub fn original(path: &Path) -> Option<PathBuf> {
        let url = CFURL::from_path(path, true)?;
        let mut translocated = false;
        // SAFETY: Security framework calls with a valid CFURL; the result follows the create rule.
        unsafe {
            let ok =
                SecTranslocateIsTranslocatedURL(url.as_concrete_TypeRef(), &mut translocated, std::ptr::null_mut());
            if ok == 0 || !translocated {
                return None;
            }
            let original = SecTranslocateCreateOriginalPathForURL(url.as_concrete_TypeRef(), std::ptr::null_mut());
            if original.is_null() {
                return None;
            }
            CFURL::wrap_under_create_rule(original).to_path()
        }
    }

    #[cfg_attr(debug_assertions, allow(dead_code))] // release builds only
    pub fn is_translocated(path: &Path) -> bool {
        original(path).is_some()
    }
}

// --------------------------------------------------------------------- Move to Applications?

/// Release builds only: when the app runs from a temporary place (a mounted disk image, App
/// Translocation, ~/Downloads), offer to move it to the Applications folder and start it from
/// there. A place the user chose (the Desktop, any other folder) stays as it is. Returns true
/// when the app relaunches from the new place: the caller exits at once.
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn offer_move_to_applications(app: &AppHandle) -> bool {
    let Some(running) = running_bundle() else {
        return false;
    };
    let translocated = translocation::is_translocated(&running);
    let location = installed_bundle().unwrap_or_else(|| running.clone());
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let in_downloads = home.as_ref().is_some_and(|h| location.starts_with(h.join("Downloads")));
    let image_volume = disk_image_volume(&location);
    if !(translocated || in_downloads || image_volume.is_some()) {
        return false;
    }
    let flag = app
        .path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("no-move-to-applications"));
    if flag.as_ref().is_some_and(|f| f.exists()) {
        return false;
    }

    match dialog::ask_move() {
        dialog::Answer::Move => {}
        dialog::Answer::Stay { dont_ask } => {
            if dont_ask {
                if let Some(flag) = flag {
                    if let Some(dir) = flag.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(flag, b"");
                }
            }
            return false;
        }
    }

    match move_to_applications(&running, &location, in_downloads) {
        Ok(destination) => {
            if relaunch_after_exit(&destination, image_volume.as_deref()).is_ok() {
                return true;
            }
            dialog::error("Zoggyfin is in the Applications folder now. Open it from there.");
            false
        }
        Err(message) => {
            dialog::error(&format!("Zoggyfin could not be moved: {message}"));
            false
        }
    }
}

/// The mount point when `path` is on a mounted disk image (/Volumes/<name>).
#[cfg_attr(debug_assertions, allow(dead_code))]
fn disk_image_volume(path: &Path) -> Option<PathBuf> {
    let rest = path.strip_prefix("/Volumes").ok()?;
    let volume = Path::new("/Volumes").join(rest.components().next()?);
    let info = Command::new("/usr/bin/hdiutil").arg("info").output().ok()?;
    let text = String::from_utf8_lossy(&info.stdout);
    let mount = volume.to_string_lossy();
    // Lines are "/dev/diskNsM <tab> <type> <tab> <mount point>".
    text.lines()
        .any(|line| line.split('\t').next_back().map(str::trim) == Some(mount.as_ref()))
        .then_some(volume)
}

/// Copies the app into /Applications (or ~/Applications when /Applications is not writable),
/// moves an older copy there to the Trash, and moves a copy in ~/Downloads to the Trash.
#[cfg_attr(debug_assertions, allow(dead_code))]
fn move_to_applications(running: &Path, location: &Path, trash_source: bool) -> Result<PathBuf, String> {
    let name = location.file_name().ok_or("no file name")?;
    let system = PathBuf::from("/Applications");
    let folder = if writable(&system) {
        system
    } else {
        let home = std::env::var_os("HOME").ok_or("no home folder")?;
        let user = PathBuf::from(home).join("Applications");
        std::fs::create_dir_all(&user).map_err(|e| e.to_string())?;
        user
    };
    let destination = folder.join(name);
    if destination.exists() {
        trash(&destination).map_err(|e| format!("cannot replace {}: {e}", destination.display()))?;
    }
    // ditto keeps the signature, the extended attributes and the symlinks in the bundle.
    let status = Command::new("/usr/bin/ditto")
        .arg(running)
        .arg(&destination)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("copy to {} failed", folder.display()));
    }
    // Gatekeeper checked the download when it opened. The copy must not be translocated again.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(&destination)
        .status();
    if trash_source {
        let _ = trash(location);
    }
    Ok(destination)
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".zoggyfin-write-test-{}", std::process::id()));
    let ok = std::fs::create_dir(&probe).is_ok();
    let _ = std::fs::remove_dir(&probe);
    ok
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let path = NSString::from_str(&path.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

#[cfg_attr(debug_assertions, allow(dead_code))]
mod dialog {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSApplication};
    use objc2_foundation::NSString;

    pub enum Answer {
        Move,
        Stay { dont_ask: bool },
    }

    fn front(mtm: MainThreadMarker) {
        #[allow(deprecated)]
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }

    pub fn ask_move() -> Answer {
        let Some(mtm) = MainThreadMarker::new() else {
            return Answer::Stay { dont_ask: false };
        };
        front(mtm);
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str("Move Zoggyfin to Applications?"));
        alert.setInformativeText(&NSString::from_str(
            "Zoggyfin runs from a temporary location. In the Applications folder it gets updates \
             and opens from Launchpad and Spotlight.",
        ));
        alert.addButtonWithTitle(&NSString::from_str("Move to Applications"));
        alert.addButtonWithTitle(&NSString::from_str("Do Not Move"));
        alert.setShowsSuppressionButton(true);
        if let Some(button) = alert.suppressionButton() {
            button.setTitle(&NSString::from_str("Do not ask again"));
        }
        let response = alert.runModal();
        if response == NSAlertFirstButtonReturn {
            return Answer::Move;
        }
        let dont_ask = alert.suppressionButton().is_some_and(|b| b.state() != 0);
        Answer::Stay { dont_ask }
    }

    pub fn error(message: &str) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        front(mtm);
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(message));
        alert.addButtonWithTitle(&NSString::from_str("OK"));
        alert.runModal();
    }
}
