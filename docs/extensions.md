# Extensions

An extension adds features for your own setup without a change to the app. For
example, a self-hosted downloader can add a "Download" target for shared links,
buttons on items, Home rows and a page.

An extension is **data only**. The app reads a JSON manifest from your server and
draws the contributions. No code from an extension runs in the app (App Store
guideline 2.5.2): there is no `eval`, and the app downloads no scripts. A panel is
a normal web page in a WebView or an iframe. It can only use the six bridge
methods below.

Extensions work on iPhone, iPad, Android, web and the Mac app.

## Install

1. Settings → Extensions → **Add an extension**.
2. Enter the manifest URL, or only the address of the extension's server (for
   example `http://192.0.2.10:3000`). For a server address, the app tries
   `<address>/zoggyfin-extension.json`, then
   `<address>/.well-known/zoggyfin-extension.json`.
3. The confirm screen shows the name, the server, the permissions and the
   contributions. Tap **Add**. The app fills in the settings by itself.

You can turn an extension off, change its permissions and settings, check for an
update, or remove it on its page in Settings → Extensions. An update that asks
for a new permission shows the confirm screen again.

Other parts of the app use two functions from `src/extensions`:

- `extensionsForInvite()` returns the manifest URLs of the turned-on extensions.
- `installFromInvite(urls)` shows one confirm screen for all the extensions in
  the list that are not installed yet.

## Manifest (schema version 1)

The schema is in `src/extensions/schema.ts` (zod). A manifest that is not valid
is refused, and the error names the first wrong field.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Required. |
| `id` | string | Lower-case letters, digits, `.`, `_`, `-`. One install per id. |
| `name`, `version` | string | Shown on the confirm screen. |
| `description` | string | Optional. |
| `baseUrl` | http(s) URL | Every request goes to this origin and to no other. |
| `permissions` | array | `network` (always added), `itemPath`, `jellyfinToken`. |
| `headers` | object | Optional. Headers for each request. Values are templates. |
| `contributes` | object | `settings`, `itemActions`, `homeSections`, `shareTargets`, `panels`. |

### Permissions

- `network`: the app sends requests to the `baseUrl` origin only. A request,
  a feed image or a panel page on another origin is refused.
- `itemPath`: the app sends the file path of an item (`{{item.path}}`), and
  `when.pathPrefixes` can filter on it.
- `jellyfinToken`: the app sends the user's Jellyfin token and server with each
  request:
  - `Authorization: MediaBrowser Token="<token>"`
  - `X-Emby-Token: <token>`
  - `X-Jellyfin-Server-Url`, `X-Jellyfin-Server-Id`, `X-Jellyfin-User-Id`

  The confirm screen shows this permission in red ("<name> can act as you on
  your Jellyfin server"), with its own switch. The user can turn it off there or
  later. The extension must check the token against its own Jellyfin server, for
  example with `GET /Users/Me`, and refuse tokens of other servers.

### Templates

Strings in `path`, `query`, `body`, `headers`, `confirm` and a panel `url` can
contain `{{scope.key}}`. A template only reads a value; there are no
expressions. An unknown name gives an empty string. Values in a `path` are URL
encoded. In a `body`, a string that is exactly one token of a toggle setting
keeps its `true`/`false` type.

| Scope | Keys |
| --- | --- |
| `item` | `id`, `name`, `type`, `mediaType`, `libraryName`, `serverId`, `path` (only with `itemPath`) |
| `input` | the keys of the action's `inputs` |
| `settings` | the keys of `contributes.settings` |
| `share` | `url` |
| `jellyfin` | `serverUrl`, `serverId`, `userId`, `userName`, `isAdmin` |

### `settings`

Simple fields, kept on the device per extension. Secret text goes to the
keychain (secure store on web). The user never has to type a value: each field
gets one by itself.

```json
{ "key": "user", "type": "text", "label": "User", "source": "jellyfin.userName" }
{ "key": "loud", "type": "toggle", "label": "Loud", "default": true }
{ "key": "folder", "type": "choice", "label": "Folder", "optionsSource": "/api/folders", "matchLibrary": true }
{ "key": "apiKey", "type": "text", "label": "API key", "secret": true }
```

- `source`: `jellyfin.serverUrl`, `jellyfin.serverId`, `jellyfin.userId`,
  `jellyfin.userName` or `jellyfin.isAdmin` (toggle). The value follows the
  signed-in account.
- `optionsSource`: an endpoint for the choices. The app loads it at install and
  when the settings page opens.
- `matchLibrary`: choose the first option whose value or label is the name of a
  Jellyfin library.
- The value in use is: what the user set, else the filled-in value, else the
  `source` value, else `default`, else the first option.

### `itemActions`

A button in an item's action sheet.

```json
{
  "id": "convert",
  "title": "Convert to MP3",
  "icon": "music.note",
  "destructive": false,
  "when": { "types": ["Movie", "Video"], "mediaTypes": ["Video"], "libraries": ["YouTube"], "pathPrefixes": ["/media/videos/"] },
  "confirm": { "title": "Convert {{item.name}}?", "message": "…", "action": "Convert" },
  "inputs": [
    { "key": "name", "type": "text", "title": "New name", "default": "{{item.name}}" },
    { "key": "folder", "type": "choice", "title": "Folder", "source": "/api/folders" }
  ],
  "request": { "method": "POST", "path": "/api/convert", "query": {}, "body": { "path": "{{item.path}}" } }
}
```

- `when`: every given field must match. `libraries` compares without case.
  `pathPrefixes` needs `itemPath`. The app loads the library name and the path
  only when an enabled action uses them.
- `inputs` are asked one after the other, then `confirm`. Cancel stops the
  action.
- `icon` is an icon name of the app (see `src/components/icon-names.ts`).
  Another name shows a default icon.

### Choice lists

An input `source` or a setting `optionsSource` answers with one of these:

```json
{ "options": [{ "value": "videos", "label": "Videos" }] }
[{ "value": "videos", "label": "Videos" }]
["videos", "music"]
```

### Responses

An action or a share target answers with JSON. All fields are optional:

```json
{
  "toast": "Download started",
  "task": { "id": "42", "title": "Downloading Clip", "statusUrl": "/api/tasks/42", "intervalSeconds": 2 },
  "refresh": "none | item | library"
}
```

- No `toast` and no `task`: the app shows "<action>: sent to <name>".
- An error status (not 2xx) shows the `error` text of the body:
  `{ "error": "Already downloaded" }`.
- `refresh: "library"` makes the app load its data again now, after 8 s and
  after 25 s, while the server scans. The extension asks Jellyfin to scan.

A **task** is shown in a "Tasks" row at the top of Home. The app polls
`statusUrl` with GET:

```json
{ "state": "queued | running | done | failed", "progress": 0.45, "title": "…", "message": "…", "toast": "Saved", "refresh": "library" }
```

`progress` is 0 to 1. On `done`, the app shows `toast` (or "<title>: done") and
applies `refresh`. After 4 failed polls in a row, or after 3 hours, the app stops
and shows an error. Running tasks are saved, so the app follows them again after
a restart.

### `homeSections`

A Home row from a JSON feed.

```json
{ "id": "recent", "title": "Recently downloaded", "feed": "/api/feed/recent", "refreshSeconds": 60, "shape": "thumb" }
```

The feed:

```json
{
  "items": [
    { "itemId": "<jellyfin item id>", "subtitle": "videos" },
    { "id": "a", "title": "Clip", "subtitle": "45%", "image": "/thumbs/a.jpg", "progress": 0.45, "panel": "main" },
    { "id": "b", "title": "Docs", "link": "https://example.org" }
  ]
}
```

- An entry with `itemId` shows as a normal tile of that Jellyfin item. If the
  user cannot see that item, an entry with a `title` shows as a card.
- A card opens a `panel` of the extension, or a `link` (http or https) in the
  browser.
- `image` must be on the extension's origin.
- A feed that fails shows a small note ("<name> is not available now"). An empty
  feed hides the row. A row never blocks Home.

### `shareTargets`

Links shared to the app go to the targets whose `hosts` match. Empty `hosts`:
any http(s) link. `youtube.com` also matches `www.youtube.com`.

```json
{
  "id": "download",
  "title": "Download with My Downloader",
  "hosts": ["youtube.com", "youtu.be"],
  "inputs": [{ "key": "format", "type": "choice", "title": "Format", "options": [{ "value": "video", "label": "Video" }] }],
  "request": { "method": "POST", "path": "/api/downloads", "body": { "url": "{{share.url}}", "type": "{{input.format}}" } }
}
```

How a link gets to the app:

| Platform | Path |
| --- | --- |
| All | Settings → Send link to… (paste a link) |
| iPhone, iPad | `zoggyfin://share?url=<link>`. Make a Shortcut: "Receive URLs from Share Sheet", then "Open URLs" with `zoggyfin://share?url=` + the URL-encoded input. It shows in the share sheet. |
| Android | The share sheet: an intent filter for `text/plain` (needs a native build). |
| Web, Mac app | `/share?url=<link>` or paste. |

### `panels`

A full page from the extension, opened from Settings → Extensions, from the
extension's page, or from a feed card.

```json
{ "id": "main", "title": "My Downloader", "url": "/panel" }
```

iPhone, iPad and Android show it in a WebView; web and the Mac app show it in a
sandboxed iframe. The page talks to the app with `postMessage`:

```js
const pending = new Map();
let seq = 0;
window.addEventListener('message', (e) => {
  const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  if (!d || d.zoggyfin !== 1 || !pending.has(d.id)) return;
  const p = pending.get(d.id);
  pending.delete(d.id);
  d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
});
function zoggyfin(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const msg = { zoggyfin: 1, id, method, params };
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else window.parent.postMessage(msg, '*');
  });
}
```

| Method | Params | Result |
| --- | --- | --- |
| `getContext` | – | `{ extension, settings, jellyfin, theme, platform }`. `jellyfin.token` is there only with `jellyfinToken`. |
| `play` | `{ itemId }` | Plays the item. |
| `openItem` | `{ itemId }` | Closes the panel and opens the item. |
| `refreshLibrary` | – | Loads the app's data again. |
| `toast` | `{ text }` | Shows a toast. |
| `close` | – | Closes the panel. |

The app answers only messages from the extension's origin, and sends answers
only to that origin.

### CORS

Web and the Mac app send requests from a browser, so the extension must allow
CORS for the app's origins: the web address of your Zoggyfin, `tauri://localhost`
and `http://tauri.localhost` (the Mac app), and `http://localhost:<port>` for
development. Allow the headers `Content-Type`, `Authorization`, `X-Emby-Token`,
`X-Jellyfin-Server-Url`, `X-Jellyfin-Server-Id` and `X-Jellyfin-User-Id`. The
iPhone, iPad and Android apps send no `Origin`.

A panel must allow framing by those origins (no `X-Frame-Options: DENY`, and no
`frame-ancestors` that leaves them out).

### Time limits

Actions have 15 s. Feeds, choice lists and task polls have 8 s. A slow or broken
extension shows an error toast or a small note; it never blocks a screen.

## Sample: Hello

`examples/extensions/hello/` has a static manifest, a panel page and a small fake
endpoint (Node 18 or later, no packages):

```sh
node examples/extensions/hello/server.mjs
```

Then add `http://localhost:8787` in Settings → Extensions. Hello adds:

- "Say hello" on movies, episodes, videos and music: a choice list from the
  server, a confirm, a toast and a task that counts for 10 s.
- A "Hello cards" Home row with a progress card, a panel card and a link card.
- "Send to Hello" for any shared link.
- A "Hello" panel with buttons for the bridge methods.

On a phone, start the server with `BASE_URL=http://<your computer's LAN
address>:8787` and add that address.
