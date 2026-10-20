# Watch together — spike results

Date: 2026-10-19. Phase 5, step 1. Status: done; nearby mode is built on these results.

## Question

1. Can two devices find each other and exchange messages over Multipeer Connectivity?
2. How well does an NTP-style ping/pong measure the clock offset over that link?
3. Can a guest play the host's downloaded file over the peer link, with expo-video?
4. How close do two players stay in sync?

## Setup

- Two iOS 26.5 simulators on one Mac: "iPhone 17" (host, has the video downloaded) and
  "Zoggyfin iPad" (guest, without a copy). A development build with the new native module
  (`ZoggyfinTogetherModule`, see below).
- The test video: a 12 min H.264/AAC mp4, 52.6 MB, from the downloads of the host.
- A development-only link drives both apps (`zoggyfin://together-lab?do=…`, file
  `src/app/together-lab.tsx`), so a run needs no taps.
- Each app writes its player position five times a second to `Documents/together-log.jsonl`
  (`src/together/sync-log.native.ts`). Simulators on one Mac share the host's monotonic clock
  (`ProcessInfo.systemUptime`), so the real sync error is the difference of the two positions
  at the same clock time. A script interpolates the host position at each guest sample.

The spike code is not throwaway: the native module and the sync logic of the spike are the
first version of nearby mode. Only the lab link and the log are measurement aids, and they
run in development builds only.

## Results

### 1. Discovery and messages

Multipeer Connectivity works between two simulators on one Mac (it uses Bonjour on the
Mac's network). The guest found the host's advert in about 1 s. The join request (a Multipeer
invitation with a small JSON context) reached the host, the host accepted, and the session
connected with encryption (`.required`). No fallback to Bonjour + TCP for the messages was
necessary.

### 2. Clock sync

| Measure | Value |
|---|---|
| Round trip (median of the best half of 16 samples) | 0.44–0.66 ms |
| Estimated offset (true offset is 0: one shared clock) | 0.05 ms |

Between simulators the link is local, so these numbers are a lower bound. Real devices over
peer-to-peer Wi-Fi or Bluetooth have round trips of several milliseconds to tens of
milliseconds; the error of the offset is at most half the asymmetry of the path.

### 3. Streaming the host's file

The host runs a small HTTP/1.1 range server (Network.framework, `includePeerToPeer`,
Bonjour service `_zgf-media._tcp`). The guest runs a loopback relay: AVPlayer reads
`http://127.0.0.1:<port>/<token>/media.mp4`, and the relay copies the bytes to the host's
service. Results:

- expo-video plays the stream with no change (progressive mp4, `Range` requests, `206`).
- AVPlayer made 18–25 range requests in a run of about 2.5 min with three seeks, and read
  112–146 MB (it reads ahead and reads again after seeks; the file is 52.6 MB).
- Seeks to a part of the file that was not loaded took about 0.1–0.2 s to play again.

### 4. Playback sync

Scenario: guest presses play, the host seeks to 5:00, the guest sets 1.5×, the host sets 1×,
the guest seeks to 1:40. Values are guest minus host (negative: the guest is behind),
measured from 3 s after each start.

| Version of the drift logic | Median error | 95th percentile | Max |
|---|---|---|---|
| A: thresholds of the spec only (rate nudge above 150 ms) | 28 ms | 132 ms | 132 ms |
| B: + a 50 ms threshold for 8 s after each start or seek, continuous nudges | ≈ 25 ms | ≈ 200 ms | 220 ms |
| C: B with only two nudge steps (3 % and 6 %) | 28 ms | 63 ms | 182 ms (just after a seek) |
| D: C, and a nudge goes on until the drift passes zero by 10 ms; fine threshold 40 ms — guest plays its own download | 15 ms | 23 ms | 93 ms (just after a seek) |
| D — guest streams the host's file | 4 ms | 14 ms | 16 ms |

Findings:

- The error is not drift: the two players run at the same speed (one hardware clock). The
  error is a fixed offset that comes from how long each player takes to start after a play
  or a seek (15–130 ms in these runs). With version A, an offset under 150 ms stays for the
  whole film.
- Each change of `playbackRate` makes AVPlayer lose about 20 ms. Version B changed the rate
  every 500 ms and the guest fell further behind (it lost more than it gained). Version C
  changes the rate only between three values (1×, ±3 %, ±6 %). In version C the change back
  to 1× put back about 20 ms of the error each time, so the error stayed near 50 ms.
  Version D goes on with the nudge until the drift is 10 ms past zero, so the change back
  ends near zero.
- The planned start (the host sends "play at host time T", 300 ms ahead) works: after the
  first play the error was 4 ms in one run and 55 ms in another.

The shipped defaults are version D: rate nudges above 150 ms (above 40 ms for 8 s after a
start or seek), two nudge steps (3 % and 6 %), a nudge that ends 10 ms past zero, a seek
above 1 s, and a 1.5 s pause in decisions after a seek. Each value of the table is one run of
about 2.5 minutes, so the numbers show the size of the error, not a precise statistic.

## What needs real devices (from the maintainer)

- Multipeer with no router (peer-to-peer Wi-Fi and Bluetooth), for example in flight mode with
  Wi-Fi on. The media relay uses `includePeerToPeer`, which uses peer-to-peer Wi-Fi; Bluetooth
  alone cannot carry video.
- Throughput of the stream over peer-to-peer Wi-Fi for a large file (a 1080p film at
  8–15 Mbit/s), and how long the first frame takes.
- Round trip and offset error on real links, and the sync error between an iPhone and an
  iPad whose clocks are not one clock.
- The local network permission prompt (it does not show on a simulator).
- Background: a guest that goes to the background or locks the screen.

## Possible next steps

- Start with `AVPlayer.setRate(_:time:atHostTime:)` in the native module. It starts a player
  at an exact host time and would remove the start offset.
- A "Do not wait" control for the host when a guest buffers for a long time.

## Part 2: the new transport, listen together and drops (2026-10-19)

Setup: an iPhone 17 simulator, an iPad simulator and the Mac app (development build) on one
Mac, all on the Mac's monotonic clock, so their logs compare directly. The links go over
loopback, not over Wi-Fi or AWDL. Error = the guest's position minus the host's position at
the same time, 200 ms samples, 3 s after each start, seek or track change left out. Steps:
play, seek, rate 1.5 and back, next, previous (the lab route `together-lab`).

| Pair | Media | Median | p95 | Notes |
|---|---|---|---|---|
| iPhone host → iPad, stream | video | 8 ms | 13 ms | 664 samples |
| iPhone host → iPad, own copy | video | 2–11 ms | 6–11 ms | three runs |
| iPad host → iPhone, stream | album (2 tracks) | 5 ms | 11 ms | next, previous, rate 1.5 |
| iPad host → Mac app, stream | album | 75 ms | 114 ms | 8 seeks in 3 min |
| iPad host → Mac app, stream | video (libmpv) | 38 ms | 149 ms | no seeks |
| SyncPlay, iPhone ↔ Mac app | album | 6 ms | 77 ms | server group, Date.now clocks |

Drops (three devices: iPhone host, iPad with its own copy, Mac app that streams):

- Host drop: the iPad elected itself 7.6 s after the drop (6 s of retries first). Its
  position did not move (the handover jump was 1–11 ms; the largest 200 ms step was off by
  0.0 ms) and it never paused. The Mac app relinked to the iPad about 1 s later and moved
  its stream to the iPad's file.
- Guest restart: the Mac app was reloaded; "Rejoin" brought it back with no new approval,
  as the same member.

What the measurements changed:

- WebKit audio (the Mac app) loses 170–480 ms on each `playbackRate` change and 380–570 ms
  on each seek. A web audio guest therefore corrects only by seeks, with a seek lead that
  it learns from its own seeks (`SEEK_ONLY_DRIFT` in `drift.ts`).
- libmpv sends `time-pos` at most four times a second, late by a different time each time,
  and the value stops for 400–600 ms at times while the sound plays on. The Mac app's
  position is the highest prediction from the reports of the last 2 s
  (`src/player/position-line.ts`). Before: median 89 ms, p95 417 ms; after: 38 ms, 149 ms.
- After a reload (a new track, a new host's stream) a player is paused, but the together
  port still said "playing", so the follower only seeked. The port now takes the player's
  real state on each attach, and a reload plays at once when the group plays.
- iOS `AVPlayer.play()` sets the rate back to 1, so the audio engine sets the rate again
  after each play.
- expo-audio's web playlist (58.0.x) reports `isLoaded: false` and `isBuffering: true` after
  it moves to the preloaded next track. The audio engine treats a moving time as loaded.
- A member that comes back while the group plays no longer pauses the group while it
  buffers (the new host paused for 650 ms before); it catches up.
- At the end of a film the host's player stopped and the group waited for a dead player.
  In a session the player now stays at the end and the group pauses there.

Not tested here (needs real devices): AWDL with no router, Bluetooth LE, the hotspot join
(`NEHotspotConfiguration`, CoreWLAN, `WifiNetworkSpecifier`), Android (the Kotlin module is
not compiled yet), the Local Network prompt, and two clocks that are not one clock.
