//! The nearby transport ("Watch together", "Listen together") on macOS: the
//! Swift code of the iOS module (Network.framework, CoreBluetooth, CoreWLAN),
//! linked as a static library (`swift/build_nearby.rs`) with a C API
//! (`swift/NearbyBridge.swift`).
//!
//! The web app calls `nearby_call(cmd, args)` (`src/together/link-desktop.ts`).
//! Each call gets one answer from Swift. The short commands (send, close, ...)
//! come in batches with no answers: `nearby_post(calls)`. Events go to
//! `window.__zoggyfinDesktop.nearby(event)`: a thread collects the events that
//! wait and runs one `window.eval` for all of them, not one per frame. On
//! other systems the commands fail.

#[cfg(target_os = "macos")]
mod imp {
    use std::collections::HashMap;
    use std::ffi::{c_char, CStr, CString};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex, Once, OnceLock};
    use std::thread;
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{AppHandle, Manager};

    extern "C" {
        fn zgf_nearby_init(callback: extern "C" fn(*const c_char));
        fn zgf_nearby_call(json: *const c_char);
        fn zgf_nearby_post(json: *const c_char);
    }

    /// The most events in one `window.eval`.
    const MAX_BATCH: usize = 256;

    type Reply = Result<Value, String>;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static PENDING: OnceLock<Mutex<HashMap<u64, mpsc::Sender<Reply>>>> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static INIT: Once = Once::new();
    /// The events for the page, in order (see `deliver`).
    static EVENTS: OnceLock<Mutex<mpsc::Sender<String>>> = OnceLock::new();

    /// The longest wait for an answer (a Bluetooth or Wi-Fi prompt can take long).
    const TIMEOUT: Duration = Duration::from_secs(60);
    /// The rewrite of a large download (`makeSeekableMp4`) can take minutes.
    const LONG_TIMEOUT: Duration = Duration::from_secs(1800);

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
            if let Some(tx) = EVENTS.get().and_then(|t| t.lock().ok()) {
                let _ = tx.send(msg.to_string());
            }
        }
    }

    /// Takes the events from `on_message` and gives them to the page. It waits for one
    /// event, then takes all the events that came meanwhile, and runs one `window.eval` for
    /// them. When the page is quick, each event goes alone and at once; under a storm the
    /// events of one eval go together.
    fn deliver(rx: mpsc::Receiver<String>) {
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            while batch.len() < MAX_BATCH {
                match rx.try_recv() {
                    Ok(e) => batch.push(e),
                    Err(_) => break,
                }
            }
            let Some(window) = APP.get().and_then(|a| a.get_webview_window("main")) else {
                continue;
            };
            let _ = window.eval(format!(
                "(function(z){{if(!z||!z.nearby)return;for(const e of [{}])z.nearby(e);}})(window.__zoggyfinDesktop)",
                batch.join(",")
            ));
        }
    }

    fn init(app: AppHandle) {
        let _ = APP.set(app);
        INIT.call_once(|| {
            let (tx, rx) = mpsc::channel();
            let _ = EVENTS.set(Mutex::new(tx));
            let _ = thread::Builder::new()
                .name("zgf-nearby-events".into())
                .spawn(move || deliver(rx));
            // SAFETY: `on_message` is a plain C function that lives for the whole program.
            unsafe { zgf_nearby_init(on_message) };
        });
    }

    /// Runs a batch of short commands in order, with no answers.
    pub fn post(app: AppHandle, calls: Vec<Value>) -> Result<(), String> {
        init(app);
        let request = CString::new(Value::Array(calls).to_string()).map_err(|e| e.to_string())?;
        // SAFETY: `request` is a valid C string; Swift copies it before it returns.
        unsafe { zgf_nearby_post(request.as_ptr()) };
        Ok(())
    }

    pub async fn call(app: AppHandle, cmd: String, args: Vec<Value>) -> Result<Value, String> {
        init(app);
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending().lock().map_err(|e| e.to_string())?.insert(id, tx);
        let request =
            CString::new(json!({ "id": id, "cmd": cmd, "args": args }).to_string()).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            // SAFETY: `request` is a valid C string; Swift copies it before it returns.
            unsafe { zgf_nearby_call(request.as_ptr()) };
            let reply = rx.recv_timeout(if cmd == "makeSeekableMp4" {
                LONG_TIMEOUT
            } else {
                TIMEOUT
            });
            if let Ok(mut p) = pending().lock() {
                p.remove(&id);
            }
            reply.unwrap_or_else(|_| Err(format!("No answer from the nearby transport ({cmd}).")))
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// A batch of short nearby commands (send, close, ...), in order and with no answers.
/// The page sends one batch per JavaScript tick (`src/together/link-desktop.ts`).
#[tauri::command]
pub async fn nearby_post(app: tauri::AppHandle, calls: Vec<serde_json::Value>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        imp::post(app, calls)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, calls);
        Err("Nearby sessions need macOS in the desktop app.".into())
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
