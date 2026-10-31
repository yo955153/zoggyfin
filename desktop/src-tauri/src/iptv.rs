//! IPTV lists, guides and API answers for the web app (`src/iptv/transport.ts`).
//! Most providers send no CORS headers, so the page cannot read them itself.
//! Only http and https, with a size cap, and the provider's user agent when it
//! asks for one. The bytes go back as they are (an ArrayBuffer in JS); gzip is
//! inflated by the web app. Errors are short texts with no URL: provider URLs
//! hold the user name and password.

use std::sync::OnceLock;
use std::time::Duration;

use tauri::ipc::Response;

/// The most bytes one request may read, whatever the page asks for.
const HARD_MAX: u64 = 512 * 1024 * 1024;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Zoggyfin Desktop")
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .expect("an HTTP client")
    })
}

/// The URL when it is an http or https address with a host.
pub fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|_| "bad address".to_string())?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("bad address".into());
    }
    Ok(u)
}

/// A user agent that is safe to send: trimmed, printable, at most 256 characters.
pub fn clean_user_agent(ua: Option<String>) -> Option<String> {
    let ua = ua?.trim().to_string();
    if ua.is_empty() || ua.len() > 256 || ua.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(ua)
}

/// reqwest's error text holds the URL: say only what kind of failure it was.
fn network_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timeout".into()
    } else {
        "network".into()
    }
}

#[tauri::command]
pub async fn iptv_fetch(url: String, user_agent: Option<String>, max_bytes: Option<u64>) -> Result<Response, String> {
    let u = check_url(&url)?;
    let cap = max_bytes.unwrap_or(HARD_MAX).min(HARD_MAX);
    let mut req = client().get(u);
    if let Some(ua) = clean_user_agent(user_agent) {
        req = req.header(reqwest::header::USER_AGENT, ua);
    }
    let mut resp = req.send().await.map_err(|e| network_error(&e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    if resp.content_length().is_some_and(|n| n > cap) {
        return Err("too large".into());
    }
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| network_error(&e))? {
        if out.len() as u64 + chunk.len() as u64 > cap {
            return Err("too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(Response::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_addresses() {
        assert!(check_url("http://panel.example.com:8080/player_api.php?username=a").is_ok());
        assert!(check_url(" https://example.com/list.m3u ").is_ok());
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("ftp://example.com/x").is_err());
        assert!(check_url("not a url").is_err());
    }

    #[test]
    fn user_agents_are_cleaned() {
        assert_eq!(clean_user_agent(Some(" Agent/1.0 ".into())), Some("Agent/1.0".into()));
        assert_eq!(clean_user_agent(Some("".into())), None);
        assert_eq!(clean_user_agent(Some("a\r\nX-Evil: 1".into())), None);
        assert_eq!(clean_user_agent(Some("x".repeat(300))), None);
        assert_eq!(clean_user_agent(None), None);
    }
}
