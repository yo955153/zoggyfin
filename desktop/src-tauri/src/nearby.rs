//! The nearby transport ("Watch together", "Listen together") on macOS: the
//! Swift code of the iOS module (Network.framework, CoreBluetooth, CoreWLAN),
//! linked as a static library (`swift/build_nearby.rs`) with a C API
//! (`swift/NearbyBridge.swift`).
//!
//! The web app calls `nearby_call(cmd, args)` (`src/together/link-desktop.ts`).
//! Each call gets one answer from Swift. Events go to
//! `window.__zoggyfinDesktop.nearby(event)`. On other systems the command fails.

#[cfg(target_os = "macos")]
mod imp {
    use std::collections::HashMap;
    use std::ffi::{c_char, CStr, CString};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex, Once, OnceLock};
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{AppHandle, Manager};

    extern "C" {
        fn zgf_nearby_init(callback: extern "C" fn(*const c_char));
        fn zgf_nearby_call(json: *const c_char);
    }

    type Reply = Result<Value, String>;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static PENDING: OnceLock<Mutex<HashMap<u64, mpsc::Sender<Reply>>>> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static INIT: Once = Once::new();

    /// The longest wait for an answer (a Bluetooth or Wi-Fi prompt can take long).
    const TIMEOUT: Duration = Duration::from_secs(60);

    fn pending() -> &'static Mutex<HashMap<u64, mpsc::Sender<Reply>>> {
        PENDING.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Gets each answer and each event from Swift (any thread).
    extern "C" fn on_message(text: *const c_char) {
        if text.is_null() {
            return;
        }
        // SAFETY: Swift gives a NUL-terminated UTF-8 string that stays valid during the call.
        let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
        let Ok(msg) = serde_json::from_str::<Value>(&text) else {
            eprintln!("[nearby] bad message: {text}");
            return;
        };
        if let Some(id) = msg.get("reply").and_then(Value::as_u64) {
            let reply = if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(msg.get("value").cloned().unwrap_or(Value::Null))
            } else {
                Err(msg
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("The nearby command failed.")
                    .to_string())
            };
            let tx = pending().lock().ok().and_then(|mut p| p.remove(&id));
            if let Some(tx) = tx {
                let _ = tx.send(reply);
            }
        } else if msg.get("event").is_some() {
            if let Some(window) = APP.get().and_then(|a| a.get_webview_window("main")) {
                let _ = window.eval(format!(
                    "window.__zoggyfinDesktop && window.__zoggyfinDesktop.nearby && window.__zoggyfinDesktop.nearby({msg})"
                ));
            }
        }
    }

    pub async fn call(app: AppHandle, cmd: String, args: Vec<Value>) -> Result<Value, String> {
        let _ = APP.set(app);
        // SAFETY: `on_message` is a plain C function that lives for the whole program.
        INIT.call_once(|| unsafe { zgf_nearby_init(on_message) });
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending().lock().map_err(|e| e.to_string())?.insert(id, tx);
        let request =
            CString::new(json!({ "id": id, "cmd": cmd, "args": args }).to_string()).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            // SAFETY: `request` is a valid C string; Swift copies it before it returns.
            unsafe { zgf_nearby_call(request.as_ptr()) };
            let reply = rx.recv_timeout(TIMEOUT);
            if let Ok(mut p) = pending().lock() {
                p.remove(&id);
            }
            reply.unwrap_or_else(|_| Err(format!("No answer from the nearby transport ({cmd}).")))
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// One nearby command (see `src/together/link-native-types.ts`). Resolves with the answer of Swift.
#[tauri::command]
pub async fn nearby_call(
    app: tauri::AppHandle,
    cmd: String,
    args: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        imp::call(app, cmd, args).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, cmd, args);
        Err("Nearby sessions need macOS in the desktop app.".into())
    }
}
