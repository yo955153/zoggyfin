# Google Play Console: answers for Zoggyfin

The Play API cannot fill these forms. Paste the answers in Play Console, in this order.
Package: `com.zogtech.zoggyfin`. Developer: Zog Tech, Inc. Contact: admin@zog-tech.com.

## 0. Before the forms

1. **Users and permissions:** give the service account (`play-publisher@…`, the same
   account that ZogNotes uses) access to Zoggyfin. Use "Manage app access" on that user,
   or give the account access to all apps. Permissions: "View app information",
   "Release apps to testing tracks", "Manage testing tracks and edit tester lists" and
   "Manage store presence". Do not give "Release to production".
2. **Internal testing → Testers:** make an email list (for example "Zog Tech team") and
   add it to the track. Copy the opt-in link.
3. **App signing:** keep "Google-generated key" (Play App Signing). The upload key is the
   keystore that EAS keeps for this project. After the first upload, copy the
   **App signing key certificate SHA-256** from "App integrity" into the site's
   `/.well-known/assetlinks.json`, so that the `/join` App Links verify.

## 1. Main store listing (Grow → Store presence → Main store listing)

The files are in `store/play/metadata/en-US/`. `store/play/upload.py` uploads all of them.

| Field | Value |
|---|---|
| App name | `title.txt`: Zoggyfin |
| Short description | `short_description.txt` (75 characters) |
| Full description | `full_description.txt` |
| App icon | `images/icon.png` (512 × 512) |
| Feature graphic | `images/featureGraphic.png` (1024 × 500) |
| Phone screenshots | `images/phoneScreenshots/` |
| 7-inch and 10-inch tablet screenshots | `images/sevenInchScreenshots/`, `images/tenInchScreenshots/` |
| Video | none |

Store settings (Store presence → Store settings):

| Field | Value |
|---|---|
| App category | Video Players & Editors |
| Tags | Media player, Video player, Music player (choose the nearest that Play offers) |
| Email | admin@zog-tech.com |
| Website | https://zoggyfin.zog-tech.com |
| Phone | leave empty |
| External marketing | on |

## 2. App content (Policy → App content)

### Privacy policy

https://zoggyfin.zog-tech.com/privacy

### App access

Choose **"All or some functionality is restricted"** and add one set of instructions:

| Field | Value |
|---|---|
| Name | Jellyfin demo server |
| Username | `demo` |
| Password | (empty: leave the password field empty) |
| Any other information | See below |

Any other information (paste):

> Zoggyfin is a client for Jellyfin media servers. It has no account of its own. To test it, use the public Jellyfin demo server:
> 1. Open the app. In "Server address", type https://demo.jellyfin.org/stable and tap Continue.
> 2. Username: demo. Leave the password empty. Tap Sign in.
> 3. Home shows the demo library. Open a movie and tap Play. Open Music to play an album.
> The demo server is public and resets often. Its content belongs to the Jellyfin project, not to us.
> Watch together, nearby: needs a second device with Zoggyfin. Open a downloaded video, tap the player's "Watch together" button, then "Nearby".

If the Play form needs a password value, type `(empty)` in the field and keep the note
"Leave the password empty" in "Any other information".

### Ads

**No, my app does not contain ads.**

### Content rating (IARC questionnaire)

| Question | Answer |
|---|---|
| Email | admin@zog-tech.com |
| Category | **All other app types** ("Utility, productivity, communication or other"). Zoggyfin is a player for the user's own media server. It is not a store and not a commercial streaming service. |
| Violence, fear, sexuality, nudity, language, controlled substances, crude humor | **No** to all. The app ships no media. It plays only what the user's own server holds. |
| Gambling, simulated gambling | No |
| Does the app let users interact or exchange content with other users? | **No.** There is no chat, no profile and no public content. Watch together shares only the playback state (play, pause, position) with people that the user lets join. |
| Does the app share the user's current physical location with other users? | No |
| Does the app let users buy digital goods? | No |
| Is the app a web browser or search engine? | No |
| Is the app primarily a news or educational product? | No |

Expected result: IARC 3+, PEGI 3, ESRB Everyone, USK 0.

If the questionnaire asks about "unrestricted internet access" or "user-generated content",
answer **No**. The app plays only from servers that the user adds. It does not browse the
web, and users cannot publish content to other people.

### Target audience and content

**Recommendation: 18 and over only.**

Why:
- Zoggyfin connects to a Jellyfin server that the user (or the user's household) runs.
  Setting up a media server is an adult task, and the server can hold films and music of
  every rating. The app does not filter that content (the server's parental controls do).
- With 13–17 selected, Play adds the "teen" checks. With under 13 selected, the Families
  policy applies (approved ad SDKs, teacher-approved rules, a stricter review). The app
  gains nothing from those audiences in the store.
- 18+ does not hide the app from younger users. The content rating (3+) still controls
  who can install it. A parent can use it for a household server.

Answers:

| Question | Answer |
|---|---|
| Target age groups | **18 and over** only |
| Could the app unintentionally appeal to children? | **No.** No characters, no games, no child-oriented art. |
| Store listing shown to children (appeal) | not asked when only 18+ is chosen |

If the maintainer wants teenagers too: choose **16–17 and 18+**. Do not choose under 13.

### News app

**No.**

### Health apps

**No** (none of the health features).

### Government apps

**No.**

### Financial features

**"My app doesn't provide any financial features."**

### COVID-19 contact tracing and status

**Not a publicly available COVID-19 contact tracing or status app.**

### Data safety

Overview:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not asked when the answer above is No. |
| Do you provide a way for users to request that their data is deleted? | Not asked when the answer above is No. |

Why "No" is correct:
- Zoggyfin has no account, no backend, no analytics, no crash reporting and no ads.
  Zog Tech receives no data from the app. No third party receives data from the app.
- The server address, the username and the access token stay on the device (Android
  Keystore through expo-secure-store and app storage). The app sends them only to the
  Jellyfin server that the user adds. That server belongs to the user, so Google does not
  count this as collection by the developer.
- Playback progress, favourites and playlists go to the user's own server.
- Watch together, nearby: devices talk directly over the local network, the hotspot or
  Bluetooth LE. The rendezvous is encrypted (ChaCha20-Poly1305). No server of ours is used.
- Location: the app reads the Wi-Fi name on the device to choose the home address of the
  server. The location never leaves the device.
- Network traffic to the user's server is encrypted when the server uses https. The app
  also allows http addresses, because many home servers use http on the local network.
  So the app does not claim "all data encrypted in transit"; it does not need to, because
  it collects no data.

Security practices (the form does not show them after "No"; for the privacy policy only):
the user can delete all data on the device with Settings → Servers → Remove server, or by
removing the app.

### Advertising ID

**Advertising ID:** "No, my app does not use advertising ID." The release manifest does
not contain `com.google.android.gms.permission.AD_ID`.

### Permissions declarations

The release AAB (versionCode 2) asks for these permissions. Only the ones marked
"declare" need a Play Console form.

| Permission | Why | Play form |
|---|---|---|
| INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, CHANGE_NETWORK_STATE, CHANGE_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE | Connect to the server; find servers and nearby devices on the local network (NSD, multicast); make and join the local-only hotspot for watch together | none |
| ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION | Read the Wi-Fi name for the Wi-Fi rule (Android 8.1 and later need location for the Wi-Fi name); the local-only hotspot on Android 8–12; the Bluetooth LE scan on Android 11 and lower. Foreground only, asked when the user turns on the feature | Data safety only (not collected, see above). No background location. |
| NEARBY_WIFI_DEVICES (neverForLocation) | Local-only hotspot on Android 13 and later | none |
| BLUETOOTH_SCAN (neverForLocation), BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT; BLUETOOTH, BLUETOOTH_ADMIN (Android 11 and lower) | Nearby devices find each other over Bluetooth LE for watch together, also with no Wi-Fi | none |
| FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK | Music, audiobooks and video sound continue in the background with the media notification | **declare** (see below) |
| FOREGROUND_SERVICE_DATA_SYNC, RUN_USER_INITIATED_JOBS, DOWNLOAD_WITHOUT_NOTIFICATION | Downloads continue when the app is in the background | **declare** (see below) |
| WAKE_LOCK, VIBRATE, MODIFY_AUDIO_SETTINGS | Keep playback alive; haptics; audio routing | none |

Not in the app: POST_NOTIFICATIONS, REQUEST_INSTALL_PACKAGES, QUERY_ALL_PACKAGES,
ACCESS_BACKGROUND_LOCATION, CAMERA, RECORD_AUDIO, READ_MEDIA_*, SYSTEM_ALERT_WINDOW.

#### Foreground service declaration (Android 14 and later)

Play Console → App content → Foreground service permissions. Select these types:

**1. Media playback** (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`)

- Task: "Media playback: playing audio or video in the background"
- Description (paste):
  > Zoggyfin is a player for the user's own Jellyfin media server. When the user plays music, an audiobook or a video and leaves the app or locks the screen, playback continues. A media notification with play, pause, next and previous is shown while it plays. The service stops when the user pauses or stops playback.
- User impact if the task is deferred or stopped: "Music or an audiobook stops when the user leaves the app or locks the screen."
- Video link: see "Video" below.

**2. Data sync** (`FOREGROUND_SERVICE_DATA_SYNC`)

- Task: "Network transfer: upload or download" (user-initiated download)
- Description (paste):
  > The user taps Download on a movie, episode, album or playlist to play it later with no connection. The file downloads from the user's own Jellyfin server. The download continues when the user leaves the app, and the Downloads tab shows its progress. It stops when the download completes, or when the user pauses or cancels it.
- User impact if deferred: "A large download stops when the user leaves the app, and the user cannot watch offline later (for example on a flight)."
- Video link: see "Video" below.

**Video (the maintainer must record it).** Record one short screen video (30–60 s) on an
Android 14 or later phone with the release build, and upload it as an unlisted YouTube
video or a Google Drive link that anyone can open. Show:

1. Sign in to https://demo.jellyfin.org/stable (user demo).
2. Open an album, tap Play, press Home: the music continues and the media notification
   shows. Open the notification shade and pause and play.
3. Open a movie, tap Download, press Home: the download continues (open the app again and
   show the progress in the Downloads tab).

Use the same link for both types.

## 3. After the forms

- Internal testing → Create new release (or open the draft that `upload.py` made) →
  release notes from `changelogs/2.txt` → Review release → **Start rollout to Internal
  testing**.
- Do not create a production release. Production needs the maintainer's explicit
  "roll it out".
