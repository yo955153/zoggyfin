# Zoggyfin for Mac: changes

Each section is the notes of one release. `pnpm desktop:publish` puts the section of the
version into `latest.json` (the update card shows it) and into the GitHub release.
Write one short line per item.

## 0.1.7 (2026-10-20)

- Together: pause no longer plays again by itself half a second later
- Together: the play button and Space follow the group, so a fast tap does what the button shows
- A seek on the Mac is no longer lost (the video went back to the old place)
- Invites work for 7 days; the invite list shows when each one expires

## 0.1.6 (2026-10-20)

- Together: the nearby list shows what a room plays now, and when the host picks something
- No old video frame stays on screen when music starts after a video
- The profile button opens a menu with Together, Downloads, Extensions, Settings and more
- A server room shows no wrong number of people while someone joins or leaves

## 0.1.5 (2026-10-20)

- Together: start a session, then pick anything in the app, and it plays for everyone
- A Together bar shows who is in the session, and the Play buttons read "Play for everyone"

## 0.1.4 (2026-10-20)

- Watch together: a pause, a seek or a speed change no longer starts the group again
- Listen together: next, previous and a jump keep every device on the same track

## 0.1.3 (2026-10-20)

- Together: one hub to join or start a session, and a clear flow from the invite to the room
- Host controls: accept or decline each request, remove or block a guest, and lock the session
- Watch and listen together stay in sync with many guests, and use less upload and memory
- Downloads whose file is gone show again, with an offer to download them again

## 0.1.2 (2026-10-19)

- The install window now shows the Applications folder

## 0.1.1 (2026-10-19)

- The update card has a solid background, so the notes are easy to read over artwork
- An update error shows one Close button
- Updates install in place, and Zoggyfin restarts once with one Dock icon

## 0.1.0 (2026-10-19)

- The first release of Zoggyfin for Mac (Apple silicon, macOS 13 or later)
- Video plays with libmpv: direct play of MKV, HEVC, AV1, DTS, TrueHD, and ASS and PGS subtitles
- Downloads for offline playback, with pause and resume
- Now Playing and the media keys
- Automatic updates: the app shows new versions and installs them when you choose
