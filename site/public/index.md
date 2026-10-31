# Zoggyfin: a client for Jellyfin

Zoggyfin is a fast, calm app for your own Jellyfin server. It plays movies, shows, music and audiobooks, with artwork on every tile. It runs on iPhone, iPad, Mac (Apple silicon) and Fire TV, Google TV and Android TV. Android phones and tablets are coming soon.

Zoggyfin is free. It has no account, no ads and no tracking. You need a Jellyfin server, version 10.11 or later, and a user account on it. The iPhone and iPad app is in beta on TestFlight. The Mac app is signed and notarized by Apple.

Page: https://zoggyfin.zog-tech.com/ . Install steps: [download.md](https://zoggyfin.zog-tech.com/download.md). Help: [support.md](https://zoggyfin.zog-tech.com/support.md).

## Features

### Library
- Artwork on every tile. When the server has no image for an item, Zoggyfin draws one from its title.
- Home rows for Continue watching, Next up and Recently added.
- Music by albums, artists, playlists, songs and genres.
- Search that groups results into movies, shows, episodes, music and people.

### Video
- Direct play when the device can open the file, so the server converts only what it must.
- On Mac, the libmpv engine plays MKV, HEVC, AV1, DTS and TrueHD with no conversion.
- Picture in Picture, AirPlay, subtitles, Skip Intro, chapters, quality control and background audio.

### Music and audio
- A music player with synced lyrics, a queue you can reorder, background audio and lock-screen controls.
- A long-form player for audiobooks, lectures and podcasts: playback speed, skip 15 or 30 seconds and a sleep timer. Each item resumes where you stopped.

### Downloads
- Download a movie, an episode, a season, an album or a playlist. Each download shows progress, size and the space left.
- Downloads play with no connection. The app sends your progress to the server later.

### Together
- Tap Together on Home to join or start a session. Play, pause and seek stay in step for everyone.
- People near you: one device hosts and the others join over the same Wi-Fi or Bluetooth, with no internet. You accept each person.
- Anyone on your server: uses Jellyfin SyncPlay, so people on other Jellyfin apps can join too.

### Your servers
- Add as many servers as you like. Give a server a home address and an internet, Tailscale or VPN address. The app uses the first one that answers.
- Invites: an admin adds a person and sends one link or QR code. The person taps it, Zoggyfin signs them in and they set their own password.
- Admin panel for server admins: users, devices, active sessions, libraries, scheduled tasks and logs.
- Sign in with Quick Connect instead of a password.
- Progress syncs through your server, so you can pause on one device and resume on another.

### Extensions
- An extension adds features for your own setup. The app reads a JSON manifest from your server. No extension code runs in the app. A confirm screen shows each permission before you add it.

## Questions

**Do I need a Jellyfin server?** Yes. Zoggyfin plays the media on a Jellyfin server that you or someone you trust runs. You need Jellyfin 10.11 or later. To try the app first, use the public demo server https://demo.jellyfin.org/stable with user name `demo` and no password.

**What does it cost?** Nothing. There are no ads, no subscriptions and no in-app purchases.

**Does Zoggyfin collect any data?** No. The app talks only to the servers you add. See [privacy.md](https://zoggyfin.zog-tech.com/privacy.md).

**Will my files play without conversion?** Most will. On Mac, libmpv also plays MKV, HEVC, AV1, DTS and TrueHD directly.

**Can I use it away from home?** Yes. Give your server a home address and an internet, Tailscale or VPN address. Downloads play with no connection at all.

**When does Android come?** Soon. Android phones and tablets are in testing. The download page links to it when it is ready.

**Is it open source?** The code is public at https://github.com/zog-tech/zoggyfin under the MPL-2.0.

**Is it made by the Jellyfin project?** No. It is made by Zog Tech, Inc. and is not affiliated with the Jellyfin project.

Contact: admin@zog-tech.com
