# Nearby watch- and listen-together: performance with many guests

Date: 2026-10-20. Code state: `main` at `45b8a4b`.
The bench and this report do not change product code.
Section 8 has the numbers after the fixes of section 5 (`main` at `dc90e13`).

## Summary

- The control traffic is small and linear in steady state: about **112 B/s out and 27 B/s in per guest** (1.5 messages per second). 16 guests use 1.8 KB/s. CPU and JSON costs are very small.
- The **media upload** of the host is the real limit. Each streaming guest pulls its own HTTP range stream. There is no cap, no pacing and no priority. When the upload is full, the media also delays the clock pings, so the sync error goes up (from ~40 ms to 200–460 ms in the Wi-Fi model).
- The **members list** goes in full to every guest on each join and on each buffering change. A join storm costs O(N³) bytes: 0.7 MB at 16 guests and 5.4 MB at 32 guests. Each new guest also pauses the whole group until it is ready.
- On the **Mac app**, each send is one serialized Tauri call, and each received frame is one `window.eval`. This path is the weakest under a storm.
- Realistic counts: guests with their own download: **16 on a shared Wi-Fi** (the planned cap is fine), fewer on a hotspot (the client limit). Streaming guests at 8 Mbit/s: **about 6–10 from a phone on 5 GHz Wi-Fi, 3–5 on AWDL, 2–4 on a 2.4 GHz hotspot, 12–16 from a Mac on Ethernet.**

## 1. How the bench works

`scripts/together-bench/` (run: `pnpm bench:together`, or `bash scripts/together-bench/run.sh [--quick]`).

- The host process runs the real `NearbyLink` (`src/together/link.ts`) and the real `HostRoom` (`src/together/room.ts`).
- Each guest runs the real `NearbyLink`, `Follower`, `ClockSync`, `AnchorFollower` and `DriftCorrector`. Each guest has its own clock with a random skew of up to ±1000 s. Four guests share one process.
- `node-link.ts` is a Node version of the native transport. It uses the same wire format: one TCP port, `ZGF1` + 4-byte length frames, and HTTP range in 256 KB chunks with back-pressure.
- `sim-player.ts` is a simulated player. A play starts 15–130 ms late, a seek holds 100 ms, and a rate change holds 20 ms (the spike values). A streaming player reads one open-ended range, starts with 2.5 s of data, stops reading at 50 s ahead and reads again under 30 s (ExoPlayer defaults).
- `swift-host/main.swift` runs the app's own `NearbyCore.swift` and `MediaServer.swift` headless. The bench measures its media path with the same clients.
- The test file is 200 MB of random bytes. The players are simulated, so only the size and the offsets matter. The media bitrate is 8 Mbit/s (the 1080p transcode bitrate, `src/downloads/plan.ts:24`).
- Each run: N guests join at the same moment, the group plays, a 30 s steady window, then pause, seek to 100 s, play, rate 1.5, rate 1.
- The host accepts each join at once. In the app, the host taps "Accept".
- "Sync error" is the true error: the expected position on the true host clock minus the guest's player position. The bench leaves out the 3 s after each jump. "Clock error" is the estimated offset minus the true offset.
- Machine: Apple M4, 10 cores, 16 GB, macOS, Node 25. Loopback, so the network is not a limit unless the uplink model is on.
- The uplink model (`Shaper` in `node-link.ts`) sends all host traffic (media and control) through one FIFO queue at a fixed bit rate. This is a simple model of one Wi-Fi radio.

Raw results: `docs/perf/together-bench-results.json`.

## 2. Numbers per N

### 2.1 Control traffic and sync, steady state (30 s, playing)

| guests | mode | ctrl out B/s | ctrl in B/s | msgs out/s | msgs in/s | host CPU % | host RSS MB | sync p50 ms | sync p95 ms | sync max ms | clock p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | local | 113 | 27 | 1 | 0.5 | 1.4 | 58 | 3.5 | 3.5 | 28 | 0.0 |
| 4 | local | 448 | 107 | 4 | 2 | 1.2 | 42 | 15.8 | 22.3 | 22 | 0.1 |
| 8 | local | 896 | 213 | 8 | 4 | 1.2 | 88 | 18.1 | 35.6 | 36 | 0.1 |
| 16 | local | 1788 | 431 | 16 | 8 | 1.0 | 89 | 13.6 | 36.8 | 61 | 0.1 |
| 32 | local | 3593 | 857 | 32 | 16 | 1.3 | 49 | 28.1 | 38.5 | 63 | 0.1 |
| 1 | stream | 113 | 27 | 1 | 0.5 | 1.2 | 66 | 1.2 | 12.3 | 48 | 0.1 |
| 4 | stream | 450 | 107 | 4 | 2 | 1.4 | 151 | 33.1 | 38.4 | 63 | 0.1 |
| 8 | stream | 898 | 215 | 8 | 4 | 2.2 | 166 | 15.5 | 39.2 | 39 | 0.1 |
| 16 | stream | 1791 | 428 | 16 | 8 | 2.9 | 181 | 4.4 | 28.3 | 43 | 0.1 |
| 32 | stream | 3595 | 859 | 32 | 16 | 6.9 | 191 | 18.3 | 38.1 | 45 | 0.2 |

By type at N = 16: `state` 8/s × 135 B, `pong` 8/s × 89 B out; `ping` 8/s × 54 B in. Nothing else in steady state.
On loopback the sync error stays under the 40 ms "fine" threshold of `drift.ts`. That is the design target.
Host RSS here is the Node process. The native hosts use less (see 2.4).

Long-run media upload is N × bitrate (8 Mbit/s per streaming guest). The steady window shows bursts, because each player fills its 50 s buffer at link speed and then stops.

### 2.2 Join storm (all guests join at once) and media start

| guests | ctrl bytes out during the join | of it `members` | frames out | welcome p50 / max ms | first 2 MB p50 ms (stream) | 2.5 s buffer p50 / max ms (stream) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.1 KB | 0.4 KB | 7 | 8.6 / 8.6 | 3 | 3 / 3 |
| 4 | 15.7 KB | 12.7 KB | 46 | 3.2 / 3.3 | 3 | 4 / 4 |
| 8 | 96 KB | 91 KB | 140 | 4.0 / 4.3 | 4 | 5 / 7 |
| 16 | 700 KB | 688 KB | 472 | 6.4 / 8.0 | 11 | 14 / 19 |
| 30 | 4.47 MB | 4.44 MB | 1515 | 6.7 / 10 | – | – |
| 32 | 5.41 MB | 5.39 MB | 1712 | 7.6 / 10.8 | 35 | 41 / 91 |

On loopback the time to the welcome is short (≤ 23 ms even at 32). The cost is the bytes and the frames: 98–99 % is the `members` message. On Wi-Fi at 40 Mbit/s, 5.4 MB is more than 1 s of airtime. On the Mac app, 1712 frames are 1712 serialized Tauri calls (see 3.4).

### 2.3 Commands (pause, seek 100 s, play, rate 1.5, rate 1)

| guests | mode | ctrl out B/s | sync p95 ms | rate fixes | seek fixes | seek→play ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | local | 146 | 32.9 | 10 | 0 | 53 |
| 8 | local | 1160 | 36.9 | 50 | 0 | 55 |
| 16 | local | 2332 | 32.1 | 168 | 0 | 54 |
| 32 | local | 4621 | 38.9 | 240 | 0 | 53 |
| 16 | stream | 2331 | 34.2 | 190 | 0 | 53 |
| 32 | stream | 4651 | 32.5 | 239 | 0 | 54 |

The follower corrects the start delay with small rate nudges, about 10 per guest per command. No seek fixes were needed.

### 2.4 Media server capacity (each guest downloads 32 MB at once, loopback)

| guests | Node host total Mbit/s | Node CPU % | app Swift server total Mbit/s | Swift CPU % | Swift peak RSS MB |
| --- | --- | --- | --- | --- | --- |
| 1 | 14 594 | 103 | 21 798 | 78 | 10 |
| 4 | 38 627 | 178 | 34 029 | 108 | 20 |
| 8 | 53 541 | 257 | 52 145 | 171 | 68 |
| 16 | 54 920 | 260 | 53 635 | 172 | 220 |
| 32 | 36 811 | 208 | 37 612 | 146 | 366 |

The Swift server is about 3 % CPU per Gbit/s on the M4. At Wi-Fi rates (≤ 0.3 Gbit/s) the CPU cost of the media is about 1 % on a Mac, and a few percent on a phone. The CPU is not the limit.
The streams share fairly (per-guest min and max are close).
The Swift peak RSS grows with the number of open streams: about 11 MB per stream at loopback speed. Network.framework keeps the sent data until the kernel takes it. At Wi-Fi speed the queues stay shorter, but this needs a check on an iPhone (jetsam limit).

### 2.5 Wi-Fi model: streaming guests with a limited host upload

| uplink Mbit/s | guests | need Mbit/s | 2.5 s buffer p50 ms | seek→play ms | stalls (s) | sync p95 ms | clock p95 ms | rtt p50 ms | queue max ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 200 | 4 | 32 | 467 | 52 | 0 | 124 | 24 | 23 | 65 |
| 200 | 8 | 64 | 970 | 105 | 0 | 152 | 49 | 94 | 116 |
| 200 | 16 | 128 | 2217 | 1704 | 0 | 108 | 102 | 196 | 257 |
| 100 | 4 | 32 | 879 | 51 | 0 | 136 | 46 | 91 | 114 |
| 100 | 8 | 64 | 1873 | 1388 | 0 | 131 | 99 | 193 | 220 |
| 100 | 16 | 128 | 3784 | 3818 | 47.8 | 234 | 197 | 381 | 575 |
| 40 | 4 | 32 | 2088 | 1602 | 0 | 150 | 117 | 233 | 277 |
| 40 | 8 | 64 | 4161 | 4314 | 8.1 | 263 | 235 | 457 | 509 |
| 40 | 16 | 128 | 8559 | 9656 | 278 | 468 | 458 | 911 | 1434 |

("stalls" is the total stall time of all guests in the steady window, after the first buffer.)

What this shows:
- Playback holds while N × bitrate stays under about 80 % of the upload. Above that, guests stall again and again, and each stall pauses the whole group (`room.ts:376`).
- Even with no stalls, the sync error goes from ~40 ms to 110–260 ms. The cause is the clock: the pongs wait in the same queue as the media, so the round trip is not symmetric. The clock error is about half the queue delay.
- A seek with many streamers takes seconds, because every guest asks for 50 s of new data at the same moment.

## 3. Analysis by area

### 3.1 Control traffic per guest

| message | direction | rate | size | file |
| --- | --- | --- | --- | --- |
| ping | guest → host | 8 at join (every 120 ms), then 1 per 2 s, forever | 54 B | `follower.ts:47-49`, `follower.ts:86-87` |
| pong | host → guest | one per ping | 89–99 B | `room.ts:149-151` |
| state (heartbeat) | host → all | 1 per 2 s, plus each change | 135 B | `room.ts:130`, `room.ts:405-416` |
| members | host → all | each hello, buffering change, leave, away | 60 + ~165 B × N | `room.ts:193`, `room.ts:218`, `room.ts:418-421` |
| buffering | guest → host | each player buffering change | ~60 B | `follower.ts:98` |
| welcome | host → one guest | once per join | ~500 B (video) | `room.ts:176-192` |

Steady state per guest: host out ≈ 0.5 × (135 + 90) ≈ 112 B/s, host in ≈ 27 B/s. Total host messages: 1.5 × N per second.

| N | host out B/s | host in B/s | host msgs/s (out + in) |
| --- | --- | --- | --- |
| 1 | 113 | 27 | 1.5 |
| 4 | 448 | 107 | 6 |
| 8 | 896 | 213 | 12 |
| 16 | 1788 | 431 | 24 |

O(N²) patterns:
- **`members` on each event.** The message holds the full list and goes to all N guests. One event costs about 165 × N² bytes. A join is two events (the hello, then the first `buffering`). A storm of N joins costs about 2 × Σ 165 k² ≈ 110 × N³ bytes. Measured: 0.7 MB at 16, 5.4 MB at 32.
- A streaming guest that stalls sends `buffering: true`, then `false`. Each one is a full `members` broadcast and a `state` broadcast (the group pauses and starts again).
- Guest reports are **not** sent on to other guests. Pongs go only to the guest that pinged. `link.ts:127-132` encodes a broadcast once. These are fine.
- Each new member has `buffering: true` (`room.ts:165`) and is not "catching up" (`room.ts:173` sets it only for a member that comes back). So each new join while the group plays **pauses everyone** until that guest has loaded (`room.ts:195`, `room.ts:376-385`). With 16 guests that arrive one by one, the group pauses 16 times.

### 3.2 Media

- Every streaming guest opens its own HTTP range stream to the host's file. Nothing is shared or relayed between guests. Host upload = (streaming guests) × bitrate, on average. The start, each seek and each join add bursts at link speed (the 50 s player buffer).
- A guest with its own download does not stream. `guestSource` (`nearby-media.ts:119-125`) uses the local file first. Only `devForceStream` (the lab) streams anyway.
- The bitrate is the bitrate of the host's file. A transcoded download is 1.5 / 4 / 8 Mbit/s for 480p / 720p / 1080p, and an original can be 20 Mbit/s or more (`plan.ts:24-35`). The host cannot lower it.
- Range sizes: the players choose them (AVPlayer, ExoPlayer and libmpv ask for open-ended or large ranges). The servers send in 256 KB chunks (`MediaServer.swift:48`, Android `BODY_CHUNK` at `ZoggyfinTogetherModule.kt:62`). This is a good size.
- Read-ahead: none on the host. The player's buffer is the read-ahead.
- Cap on streams: **none.** Apple accepts every connection (`NearbyCore.swift:134-155`). Android starts one thread for each connection from an unbounded pool (`ZoggyfinTogetherModule.kt:99`, `:525-571`), and an idle HTTP connection keeps its thread for 300 s (`:65`).
- Back-pressure: yes. Apple reads the next chunk only after `.contentProcessed` (`MediaServer.swift:163-191`). Android uses blocking writes (`:818-833`).
- Whole-file reads: **no path loads the whole file.** Apple reads with `FileHandle.read(upToCount: 256 KB)`. Android reads with `RandomAccessFile` into one 256 KB buffer. The Mac app uses the same Swift code as iOS (`desktop/src-tauri/swift/build_nearby.rs`), so the same holds.
- But on Apple the chunk read is synchronous on the one `zoggyfin.nearby` serial queue (`MediaServer.swift:174`). The same queue handles the control frames. `send` from JavaScript uses `queue.sync` (`NearbyCore.swift:258-263`). So the JS thread waits behind any disk read in progress, and control frames wait behind media work.
- **Transcoded (fragmented MP4) downloads:** Android rewrites them to a plain MP4 after the download (`src/downloads/manager.ts:338-342`). iOS and the Mac do not. A transcoded download on an Apple host stays fragmented MP4 with no index. An Android guest that streams it cannot seek in it (ExoPlayer needs an index for a fragmented MP4). So it cannot start in the middle of the film, and a group seek fails for it. AVPlayer plays it, but a far seek can read a lot of the file.

### 3.3 Host CPU and battery

- Timers per guest on the host: **none.** The host has one 2 s heartbeat for the room (`room.ts:130`), plus one away timer for each member that is away (`room.ts:243`).
- Timers per guest on the guest: a 2 s ping interval and a 500 ms drift tick (`follower.ts:87-88`).
- JSON cost (measured, encode + decode with validation): ping 0.4 µs, pong 0.6 µs, state 1.1 µs, members 6 µs at 16 and 12.5 µs at 32. At 24 messages per second the host spends well under 1 ms per second on JSON. The host's JS event loop was busy 4–12 % in the bench (mostly the simulated player and the bench itself).
- Crypto per message: **none.** The session is plain JSON on TCP. The only secret is the token in the media URL path. Crypto runs only in the Bluetooth rendezvous (`rendezvous-crypto.ts`). (Security note, not performance: the control socket has no encryption.)
- Battery: the bytes are small, but the packets wake the radio. With 16 guests the host gets 8 pings and sends 16 messages per second. This keeps the Wi-Fi radio out of its power-save state all the time. The host UI also gets a new `members` array on each heartbeat (`nearby.ts:391` runs on each `onChange`, `room.ts:415`), so the sheet can render every 2 s.
- The media upload costs much more battery than the control traffic. On a hotspot host, the radio is an access point and does not sleep at all.

### 3.4 Join storms

- Join latency itself is low (loopback: welcome in ≤ 11 ms at p100 for 30 guests). The host code has no queue or lock in the way.
- The cost is the O(N³) `members` traffic (2.2), and one group pause for each new guest (3.1).
- In the app the host taps "Accept" once per guest. 30 requests at once is 30 toasts and 30 rows (`nearby.ts:398-406`). That is a UI problem before it is a network problem.
- **The Mac app is the weakest host here.** Each `send` is one Tauri `invoke`, and the calls run one after the other (`link-desktop.ts:37-47`, `:159-162`). Each call runs `spawn_blocking` and waits for Swift (`nearby.rs:74-94`). Each received frame becomes one `window.eval` of a new JS string (`nearby.rs:66-69`). A storm of 32 is 1712 serial calls. The pong's `t2` is stamped in JS before the call waits in this queue (`room.ts:150`). So when the queue is long, the pong leaves later than `t2` says, and the guest's clock estimate is wrong by half the wait. A `state` with a planned start can also arrive after the 300 ms lead (`room.ts:110`), so the guests start late and must catch up.

### 3.5 SyncPlay (Jellyfin server)

- Clock: 5 `GetUtcTime` calls at the start, then 1 every 20 s (`syncplay.ts:296-298`). The same NTP math and the same best-half filter (`clock.ts`).
- Ping: `SyncPlayPing` with the measured RTT every 10 s (`syncplay.ts:300`, `:322-331`). The server uses the ping to plan the play time for the group. This matches what the server expects. jellyfin-web syncs faster at the start and slower later; ours is close enough.
- Drift tick: every 500 ms, local only (`syncplay.ts:299`).
- Load on the server per client: about 0.05 + 0.1 requests per second. This is small.
- One problem: every player buffering change is sent at once as `Buffering` or `Ready` (`syncplay.ts:435`). The server then pauses the whole group. A short stall of 100 ms on one device pauses everyone. As far as I know, jellyfin-web waits for about one second of buffering before it reports it. Add the same wait.

### 3.6 Peer-to-peer limits

- All Apple devices use `includePeerToPeer = true` on the listener, the browser and every connection (`NearbyCore.swift:17-24`). So two Apple devices can connect over AWDL with no router.
- Bluetooth LE is **only the rendezvous**. It carries the INFO record (≤ 200 B) and a few messages (≤ 4096 B), so that an Android device can make a hotspot and the other device can join it (`link-native-types.ts:67-91`). The session and the media never go over Bluetooth.
- The Android hotspot uses the plain `startLocalOnlyHotspot` (`ZoggyfinTogetherModule.kt:1220`). The app cannot choose the band or the client limit. The device maker chooses them.

## 4. Transport paths

The numbers below assume 8 Mbit/s media (1080p transcode) and the 80 % rule from 2.5. For a 20 Mbit/s original, divide the streaming count by 2.5.
"Local guests" have their own download: only control traffic (~150 B/s each) goes over the link.

| path | host media budget (realistic) | streaming guests at 8 Mbit/s | streaming at 20 Mbit/s | local guests | latency and clock |
| --- | --- | --- | --- | --- | --- |
| 1a. Apple, shared infra Wi-Fi, phone or iPad host (5 GHz) | 80–150 Mbit/s | 6–10 | 2–4 | 16 | rtt 3–10 ms when idle; grows with load |
| 1a. Apple, shared Wi-Fi, Mac host on Ethernet | 200–400 Mbit/s (AP downlink only) | 12–16 | 6–12 | 16 | best path |
| 1a. Apple, shared Wi-Fi, Mac host on Wi-Fi | 100–200 Mbit/s | 8–12 | 3–6 | 16 | as phone |
| 1b. Apple over AWDL, no Wi-Fi network | 30–80 Mbit/s | 3–5 | 1–2 | about 8 (not tested) | jumps of tens of ms at channel switches |
| 2. Same infra Wi-Fi, Android in the group | as 1a | as 1a | as 1a | 16 | as 1a; discovery less reliable |
| 3a. Android LocalOnlyHotspot, 2.4 GHz | 25–50 Mbit/s | 2–4 | 1 | the client limit (often 5–10) | rtt 5–30 ms |
| 3b. Android LocalOnlyHotspot, 5 GHz | 80–150 Mbit/s | 6–8, then the client limit | 2–4 | the client limit | as 1a |
| 4. Bluetooth LE | none: rendezvous only | 0 | 0 | 0 | – |

Notes per path:

1. **Apple to Apple on infra Wi-Fi.** A phone on 5 GHz uploads about 100–300 Mbit/s in good conditions. But each byte goes over the air twice: host to access point, then access point to guest, on the same channel. So the useful budget for the host's file is about half of the link rate. A Mac on Ethernet does not use the air for its upload, so only the access point's downlink counts.
2. **Apple to Apple over AWDL.** AWDL hops between its own channel and the infra channel (when the device also stays on a Wi-Fi network). It sends only in its time windows. So its throughput is lower and its latency jumps more. Each extra peer adds unicast streams on the same shared airtime, and AWDL must keep all peers in sync. It gets worse with each streaming peer. Apple does not publish a peer limit; AirDrop and Sidecar use few peers. We did not test more than 2 devices. Plan for at most 3–5 streaming guests. The clock filter (`clock.ts:72-82`, best half of 16 samples by rtt) handles the latency jumps if some quiet samples remain. Under media load there are none (2.5).
3. **Infra Wi-Fi with Android.** The throughput is about the same as Apple on Wi-Fi. NsdManager discovery is less reliable (resolve one at a time, multicast filters on some routers). The join code or the QR code is the fallback. Android also starts 2 threads for each control socket and 1 for each HTTP connection (`ZoggyfinTogetherModule.kt:99`, `:642`, `:728`). At 16 guests this is ~50 threads, which is acceptable.
4. **Android LocalOnlyHotspot.** The phone is the access point. All guest traffic goes through its one radio, and the radio splits its airtime among the clients. A good point: the host's media goes over the air only once (host to guest). A bad point: the band is usually 2.4 GHz with 20 MHz channels (25–50 Mbit/s real), and 5 GHz only on newer devices. Android limits the number of hotspot clients (often 5–10, set by the device maker). The host also uses more battery and gets hotter, because the radio cannot sleep.
5. **Bluetooth LE** never carries media or the session.

**Which path to prefer when several work:**
1. Shared infra Wi-Fi with a Mac host on Ethernet.
2. Shared infra Wi-Fi (any host). Pick the host with a wired link or the best Wi-Fi.
3. AWDL, for an all-Apple group with no Wi-Fi network.
4. The Android hotspot, only when nothing else works (a group with Android and no Wi-Fi network).
In all cases, a guest that can reach the Jellyfin server should stream from the server, not from the host (fix 1d below).

**Proposed warnings for the host:**
- On a hotspot: "Guests on your hotspot should download the video first. Streaming from your phone works for 2–3 guests at most."
- When (streaming guests × file bitrate) > 80 % of the path budget: "More than N guests stream from you. Playback may stutter." Use N = 8 on Wi-Fi, 4 on AWDL, 3 on a 2.4 GHz hotspot for an 8 Mbit/s file.
- When the file bitrate is high (an original over 15 Mbit/s): "This file is large. Guests should download it, or the group should use a lower quality download."
- When the hotspot refuses a client: "Your hotspot is full (N devices)." The guest sees "The host's hotspot is full."
- On a phone host with many streamers: "Hosting uses more battery. Connect the charger."

## 5. Bottlenecks, ranked by impact

### 1. The host upload has no budget (all streaming paths)

Where: `nearby-media.ts:119-125` (every guest without a copy streams), `NearbyCore.swift:134-155` and `ZoggyfinTogetherModule.kt:525-571` (no cap), the players' 50 s read-ahead.
Impact: stalls for everyone above ~80 % of the upload (2.5). Each stall pauses the group. Starts and seeks take seconds.
Fixes:
- a. A stream budget per path. Count the streaming guests in the room. Above the budget, warn the host (section 4) and tell new guests to download first.
- b. Pace each stream on the host. After the first 10 s of data, send at most 1.5 × the file bitrate per stream (a token bucket in the HTTP pump). This stops one new guest or one seek from starving the others.
- c. Ask the players for less read-ahead when they stream from the host: `AVPlayerItem.preferredForwardBufferDuration` ≈ 15 s, an ExoPlayer `LoadControl` with a 15–20 s max buffer.
- d. Send `serverId` and `mediaSourceId` (they are in `SharedItem` already). A guest that has a session on that server streams the item from the Jellyfin server and only syncs with the host. This takes the media off the host's radio.
- e. Cap the HTTP connections: for example 2 per guest and 16 in total. Close idle HTTP connections after 30 s, not 300 s (`ZoggyfinTogetherModule.kt:65`).

### 2. The clock breaks when the upload is busy

Where: the pong shares the queue with the media (`room.ts:149-151`). The filter keeps 16 samples (`clock.ts:54`) and takes the best half by rtt (`clock.ts:74`).
Impact: clock p95 error 100–460 ms when the upload is busy (2.5). The sync error follows it. This is the main reason the sync error goes over 150 ms.
Fixes:
- a. Give control sockets a higher Wi-Fi priority (WMM). Apple: `NWParameters.serviceClass = .responsiveData` (or `.interactiveVoice`) on control sockets, `.background` on HTTP. Android: `Socket.setTrafficClass(0xB8)` on control sockets.
- b. Keep a longer window (64 samples) and use only the samples within a few ms of the lowest rtt seen. A sample with a high rtt then never moves the offset.
- c. After the clock converges (spread < 5 ms, 16 samples), ping every 10 s, not every 2 s (`follower.ts:49`). Ping fast again after a relink or when the rtt jumps.
- d. Stamp `t2` in the native layer when the pong frame leaves (or build the pong in native code). This fixes the Mac queue error too (fix 4).

### 3. `members` in full on each event, and a pause for each new guest

Where: `room.ts:193`, `room.ts:218`, `room.ts:418-421`, `room.ts:165`, `room.ts:173`, `room.ts:195`.
Impact: 0.7 MB at 16 and 5.4 MB at 32 for one join storm (98 % of the join traffic). On the Mac, this is 472 or 1712 serial calls. Each join while the group plays pauses everyone.
Fixes:
- a. Send diffs: `member` (add or change one) and `memberGone` (id). Send the full list only in the welcome.
- b. Coalesce: send at most one members update per 250 ms.
- c. Do not put `buffering` in the members broadcast. The guests need only "waiting" (in `state`). The host UI can read it from the room.
- d. A new guest that joins while the group plays should catch up (as a guest that comes back does, `room.ts:172-173`), and not pause the group. Pause only for a guest that the host has marked "wait for me", or at most for a short time.
- e. With the 16-guest cap and diffs, a storm costs about 16 × 16 × 200 B ≈ 50 KB.

### 4. The Mac app's send and event path

Where: `link-desktop.ts:37-47` and `:159-162` (one serialized `invoke` per send), `nearby.rs:74-94` (`spawn_blocking` and a reply for each call), `nearby.rs:66-69` (one `window.eval` per event).
Impact: a broadcast to N guests is N round trips in series. A storm is ~1700 calls. The pong `t2` is wrong by the time it waits (fix 2d). A planned start can arrive late. This was not measured (the bench cannot run Tauri headless). Each call likely costs well under 1 ms, so it is fine in steady state (24 calls per second at 16) but not in a storm.
Fixes:
- a. Add `sendMany(socketIds, text)`: one call per broadcast. `NearbyLink.send` (`link.ts:127-132`) already has the list.
- b. Do not wait for a reply for `send` (fire and forget), or batch the sends of one JS tick into one call.
- c. Deliver events through a Tauri event channel, and batch the frames of one tick into one call.

### 5. Native server details

Where: `NearbyCore.swift:37` and `:258-263` (one serial queue, and `queue.sync` from the JS thread), `MediaServer.swift:174` (synchronous file read on that queue), `ZoggyfinTogetherModule.kt:642` and `:661-685` (one writer thread per control socket with an unbounded queue).
Impact: on Apple the JS thread can wait behind a disk read, and control frames wait behind media work. The Swift peak RSS grew by ~11 MB per stream at loopback speed (366 MB at 32 streams); this needs a check on an iPhone. On Android a slow guest grows its write queue with no limit.
Fixes:
- a. Run the HTTP connections on their own queue (one per connection, or one shared queue), not on the control queue.
- b. Make `send` asynchronous (`queue.async`). The JS side does not use the return value much (`link.ts:130`).
- c. Bound the Android writer queue. Close a guest whose queue holds more than, say, 1 MB.
- d. Measure the iOS memory with 8–16 streams on a device. Limit the data in flight per connection if it grows.

### 6. Transcoded fragmented MP4 on Apple hosts

Where: `src/downloads/manager.ts:338-342` (only Android rewrites the file).
Impact: an Android guest that streams such a file from an Apple host cannot start in the middle or seek.
Fix: make the file seekable on Apple too after the download (the same `makeSeekableMp4` step, or AVFoundation export), or mark the item "not seekable" and do not offer the stream to Android guests.

### 7. Steady control traffic and battery (low impact)

Where: `follower.ts:49` (ping every 2 s forever), `room.ts:130` (heartbeat every 2 s), `nearby.ts:391` (the UI state on each heartbeat).
Impact: small bytes (1.8 KB/s at 16), but 24 packets per second keep the host radio awake.
Fixes: fix 2c (ping every 10 s after convergence). Send the heartbeat every 5 s when nothing changed; the guests extrapolate from the anchor. Call `setTogether` only when the member list changes.

### 8. SyncPlay buffering reports (low to medium impact)

Where: `syncplay.ts:435`.
Fix: report `Buffering` only after the player has buffered for about 1 s. Report `Ready` at once.

## 6. Realistic guest counts

| host | guests with their own download | streaming guests (8 Mbit/s file) |
| --- | --- | --- |
| Phone or iPad on 5 GHz Wi-Fi | 16 (after fix 3; up to ~8 is fine now) | 6–10 now; 8 with the warnings |
| Phone, AWDL only | about 8 (not tested above 2) | 3–5 |
| Android hotspot host | the client limit (5–10) | 2–4 on 2.4 GHz, 6–8 on 5 GHz |
| Mac on Wi-Fi | 16 (after fixes 3 and 4) | 8–12 |
| Mac on Ethernet | 16 | 12–16 |

The 16-guest cap is right for guests with a copy. It is too high for streaming guests on any phone path. The cap for streaming guests should follow the path budget (fix 1a).

## 7. What the bench does not cover

- Real radios. Loopback hides the Wi-Fi limits; section 2.5 is a model with one FIFO queue. Real Wi-Fi has more loss and retries, and the access point adds its own queue.
- Real players. The simulated player uses the spike's delays.
- The Mac Tauri path (invoke and `window.eval`). It needs the app; it is analysed from the code.
- Android and iOS native servers on the devices. The Swift server was run on macOS; the Kotlin server was analysed from the code.
- Audio sessions. A `queue` message is up to 300 entries and goes to all guests on each change (`room.ts:349-354`, `protocol.ts:57`); this is the same O(N) × size pattern as `members`, but rarer.

## 8. After the fixes

Run again on 2026-10-20 with the code at `dc90e13` (fixes 1 to 8 of section 5).
Same machine, same file, same steps. Raw results: `docs/perf/together-bench-results-after.json`.

The bench model changed with the code, so that it runs what the apps now do:

- `node-link.ts` sends control frames from a voice queue first (the voice service class of fix 2; Wi-Fi WMM gives voice the radio first). Media goes out in 64 KB air frames, so one control frame waits for at most one media frame.
- Each host stream is paced (fix 1c): a 10 s burst, then 1.5 × the bitrate.
- The simulated player reads 15 s ahead and reads again under 10 s (fix 1c). Before, it was 50 s and 30 s.
- `BENCH_LEGACY=1` turns off the voice queue and the pacing. `BENCH_PACE=0` turns off only the pacing. The media capacity test (8.4) runs with no pacing.
- On the host side of Apple, the voice class is set on each frame (`NWProtocolIP.Metadata`). Its effect on a TCP connection is not proven. The guest side sets it on the connection.

### 8.1 Control traffic and sync, steady state

| guests | mode | ctrl out B/s before → after | ctrl in B/s before → after | sync p95 ms before → after | clock p95 ms before → after |
| --- | --- | --- | --- | --- | --- |
| 1 | local | 113 → 83 | 27 → 9 | 3.5 → 16 | 0.0 → 0.1 |
| 8 | local | 896 → 661 | 213 → 72 | 35.6 → 39.6 | 0.1 → 0.2 |
| 16 | local | 1788 → 1324 | 431 → 143 | 36.8 → 34.2 | 0.1 → 0.1 |
| 32 | local | 3593 → 2636 | 857 → 287 | 38.5 → 37.9 | 0.1 → 0.2 |
| 16 | stream | 1791 → 1323 | 428 → 143 | 28.3 → 38.3 | 0.1 → 0.1 |
| 32 | stream | 3595 → 2647 | 859 → 286 | 38.1 → 38.8 | 0.2 → 0.2 |

After the clock converges, a guest pings every 10 s, not every 2 s (fix 2). Control in goes down by two thirds, control out by a quarter.
On loopback the sync error stays under the 40 ms "fine" threshold, as before. The single guest at N = 1 is one sample (16 ms); it is not a trend.

### 8.2 Join storm

| guests | ctrl bytes out before → after | of it members before → after | frames before → after |
| --- | --- | --- | --- |
| 4 | 15.7 KB → 5.9 KB | 12.7 KB → 1.9 KB | 46 → 24 |
| 8 | 96 KB → 16.7 KB | 91 KB → 7.0 KB | 140 → 48 |
| 16 | 700 KB → 53 KB | 688 KB → 27 KB | 472 → 96 |
| 30 | 4.47 MB → 164 KB | 4.44 MB → 94 KB | 1515 → 180 |
| 32 | 5.41 MB → 185 KB | 5.39 MB → 107 KB | 1712 → 192 |

(Local mode. The welcome now carries the members, then `memberDelta` messages go out at most each 250 ms. In stream mode the bench takes its count at 53 ms, before the first delta, so those rows are left out here.)

The members cost of a storm is now about O(N²), not O(N³): 30 guests cost 94 KB, not 4.4 MB. The welcome time stays under 13 ms at 32 guests. A new guest no longer pauses the group (fix 3).

### 8.3 Commands

| guests | mode | sync p95 ms before → after | seek→play ms before → after |
| --- | --- | --- | --- |
| 16 | local | 32.1 → 31.5 | 54 → 54 |
| 32 | local | 38.9 → 32.9 | 53 → 54 |
| 16 | stream | 34.2 → 27.9 | 53 → 54 |
| 32 | stream | 32.5 → 25.8 | 54 → 54 |

No change in the command path, as expected.

### 8.4 The app's Swift media server (each guest downloads 32 MB at once, loopback)

| guests | total Mbit/s before → after | CPU % before → after | peak RSS MB before → after |
| --- | --- | --- | --- |
| 1 | 21 798 → 22 641 | 78 → 85 | 10 → 10 |
| 4 | 34 029 → 35 060 | 108 → 109 | 20 → 14 |
| 8 | 52 145 → 52 378 | 171 → 168 | 68 → 17 |
| 16 | 53 635 → 65 620 | 172 → 215 | 220 → 24 |
| 32 | 37 612 → 67 762 | 146 → 215 | 366 → 35 |

The memory growth of about 11 MB per stream is gone (fix 5). Its cause was the file reads: each `FileHandle.read` made an autoreleased buffer, and the serial queue did not drain the pool until the queue went idle. The reads now run in an `autoreleasepool`, on a queue for each connection, and the control frames have their own queue.
A second check with 32 MB per client: the old code peaked at 527 MB with 16 streams and 1040 MB with 32 streams. The new code peaks at 22 MB and 35 MB.

### 8.5 Wi-Fi model: streaming guests with a limited host upload

| uplink Mbit/s | guests | sync p95 ms before → after | clock p95 ms before → after | rtt p50 ms before → after | seek→play ms before → after | stalled s before → after |
| --- | --- | --- | --- | --- | --- | --- |
| 200 | 4 | 124 → 37.6 | 24 → 1.9 | 23 → 3.3 | 52 → 52 | 0 → 0 |
| 200 | 8 | 152 → 30.6 | 49 → 1.0 | 94 → 1.4 | 105 → 54 | 0 → 0 |
| 200 | 16 | 108 → 35.4 | 102 → 0.8 | 196 → 0.8 | 1704 → 1095 | 0 → 0 |
| 100 | 4 | 136 → 22.0 | 46 → 0.8 | 91 → 0.5 | 51 → 52 | 0 → 0 |
| 100 | 8 | 131 → 10.3 | 99 → 1.0 | 193 → 1.4 | 1388 → 1092 | 0 → 0 |
| 100 | 16 | 234 → 38.4 | 197 → 1.5 | 381 → 2.2 | 3818 → 3214 | 47.8 → 13.7 |
| 40 | 4 | 150 → 28.5 | 117 → 2.9 | 233 → 3.8 | 1602 → 1504 | 0 → 0 |
| 40 | 8 | 263 → 39.0 | 235 → 2.6 | 457 → 0.8 | 4314 → 3953 | 8.1 → 20.9 |
| 40 | 16 | 468 → 64.3 | 458 → 2.6 | 911 → 3.5 | 9656 → 8981 | 278 → 58.6 |

What this shows:

- The clock holds under load. Before, the clock error was about half the media queue delay (up to 458 ms). Now it stays under 3 ms in every row, and the sync error stays near or under 40 ms. The voice queue, the round-trip filter and the slower pings do this together.
- Below the budget (N × bitrate under 80 % of the upload), playback has no stalls, as before. The seek takes up to 0.6 s less, because each player asks for 15 s, not 50 s.
- Above the budget, guests still stall. The 40 Mbit/s rows with 8 and 16 guests need 64 and 128 Mbit/s. No pacing can make this fit. With 8 guests the total stall time went up (8.1 s to 20.9 s), because each player now keeps a shorter buffer. With 16 guests it went down (278 s to 59 s). For these cases the host now sees the warning of fix 1b, and guests on the item's server stream from the server (fix 1a).

### 8.6 What the bench cannot show

- Fix 4 (the Mac app bridge) needs the Tauri app. The unit test checks one bridge call per tick; the bench does not run the app.
- Fix 6 (seekable MP4 on Apple) and fix 7 (block by device key) are functions, not load. Their unit tests and a manual check of the rewritten file cover them.
- Fix 8 was checked with `dns-sd -B`: a code-only session does not show.
- The Android server (fix 5, the write-queue limit) was not run in the bench.
