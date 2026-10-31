# Changelog

All notable changes to Zoggyfin are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The Mac app has its own version and its own notes in [desktop/CHANGELOG.md](desktop/CHANGELOG.md).
The version of the mobile and web app is in `app.json`.

## [Unreleased]

Zoggyfin is in early development. The list below follows the history of the repository, from the
first commit to today. All of it was built in the first weeks of the project.

### Added

- **Foundation.** An Expo SDK 58 project on `react-native-tvos`, the Jellyfin API layer, sign-in with
  a password or Quick Connect, the tab shell, Home, library grids, item pages, search and generated art
  for items with no picture.
- **Design system.** The Ember accent on graphite, a light and a dark theme, one icon set per platform
  and rules for Arabic text. See `docs/design`.
- **Video player.** Direct play or HLS from a device profile, a full-screen player with trickplay,
  chapters, audio and subtitle tracks, Skip Intro and Skip Credits, a next-episode countdown, Picture in
  Picture, AirPlay, lock-screen controls and a mini player.
- **Music player.** Background audio, a queue with drag to reorder, synced lyrics, Instant Mix, a
  long-form mode with a sleep timer for audiobooks, and the Music tab with Albums, Artists, Playlists,
  Songs and Genres.
- **Downloads.** A background download engine, a state machine with retry, the Downloads tab, offline
  mode with an outbox for playback progress, and playlists.
- **Servers and accounts.** Many servers, many users per server, several addresses per server with
  automatic choice, and an account switcher.
- **Server discovery.** The first screen finds Jellyfin servers on the local network.
- **Watch and listen together.** Nearby sessions with no internet and no server (Bonjour, a join code,
  drops and rejoin), and Jellyfin SyncPlay groups. Clock sync keeps devices within a few milliseconds.
  A session is a room: start it, then pick anything with the normal app, and it plays for everyone.
  A room bar shows on every screen while the session runs.
- **Invites.** An administrator adds a person and shares one link or QR code. The invite page on the
  website opens the app or the store.
- **Admin panel.** Dashboard, now playing, users, libraries, tasks, activity, devices, logs, restart
  and shut down. Each library has a "Watch for new files" switch (the server's real-time monitoring).
- **Extensions.** Install a JSON manifest from a server. Extensions add item actions, Home rows,
  shared-link targets and panels. No extension code runs in the app.
- **Mac app.** A Tauri 2 app with libmpv video, downloads, Now Playing and media keys, signed and
  notarized releases and automatic updates. See `desktop/CHANGELOG.md`.
- **Android.** The native module with decoders and Picture in Picture, ExoPlayer playback, the tab bar,
  seek in video downloads, nearby sessions over Wi-Fi and a hotspot, and the Google Play listing.
  Android is not released yet.
- **Website.** The landing page, the download page, the privacy policy, the support page and the invite
  page at zoggyfin.zog-tech.com, deployed to Cloudflare Pages.
- **Releases.** EAS build profiles, EAS Update for over-the-air updates and TestFlight builds.
- **Stream info.** The player shows the resolution and bitrate that play under the title. The Playback
  sheet puts them next to the original file, so a viewer can tell whether a higher quality would help.
- **Screen size.** A player menu with Fit, Fill (crop) and Stretch.
- **Motion.** Favourite and Played turn on at once on the item page, with a small pop and a light
  haptic. Download rings move smoothly between steps. A finished download's icon arrives with a small
  bounce. Item, library and genre pages fade their content in after a loading skeleton.
- **Home discovery.** "Because you watched" rows from the server's movie recommendations, a "Short on
  time" row of unwatched movies of 100 minutes or less, and a genre of the day that changes at midnight.

### Changed

- The invite flow, the nearby transport and the rendezvous crypto use one design on every platform:
  ChaCha20-Poly1305, with CryptoKit on Apple platforms.
- A saved server stays one entry when its address or its Id changes.

### Fixed

- TV: Down on the last Home row no longer scrolls the rows out of view.
- TV: Settings, and other pages with no preferred focus, take the focus when they open. Before, the
  focus stayed on the page they covered and the remote could not reach them.
- Android: a transcode that started mid-file (resume, a quality change) could stop with a playback
  error ("Top bit not zero"). ExoPlayer now gets MPEG-TS HLS segments.
- TV: Home in the side menu leaves Settings. A tab pressed again goes back to its first page.
- TV: Right in the open side menu gives the focus back to the content.
- TV: The Home billboard no longer cuts off the top and bottom of the backdrop.
- TV: In library grids the row with the focus scrolls to the middle. Before, it sat on the bottom
  edge with its title cut off, and Down on the last row scrolled into empty space.
- TV: No Picture in Picture button. Google TV refused it, so the button did nothing.

## Mac app releases

| Version | Date | Notes |
|---|---|---|
| 0.1.2 | 2026-10-19 | The install window shows the Applications folder |
| 0.1.1 | 2026-10-19 | A solid update card, one Close button on errors, in-place updates with one Dock icon |
| 0.1.0 | 2026-10-19 | The first release of the Mac app |

[Unreleased]: https://github.com/zog-tech/zoggyfin/compare/v0.1.2...HEAD
