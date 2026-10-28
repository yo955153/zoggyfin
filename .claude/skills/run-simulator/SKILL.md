---
name: run-simulator
description: Build and run Zoggyfin on an iOS simulator, an Android emulator, a TV emulator, the web or the Mac app, sign in to the public Jellyfin demo server, and capture screenshots or a video of a gesture. Use when you must see a change in the running app, reproduce a UI bug, or check a gesture or animation frame by frame.
---

# Run the app on a simulator

## 1. Build and start

Work from the repository root. Run `pnpm install` first if `node_modules` is old.

| Target | Command |
|---|---|
| iOS simulator | `pnpm ios` (`expo run:ios`): builds the dev client, installs it, starts Metro |
| Android emulator | `pnpm expo run:android` |
| Dev client already installed | `pnpm start` (Metro only), then open the app |
| Web | `pnpm expo start --web` |
| TV layout, quick | Web with `?tv=1` in the URL (arrow keys move the focus, Escape goes back; `?tv=0` turns it off) |
| Android TV emulator | `EXPO_TV=1 pnpm expo prebuild --clean`, then `pnpm expo run:android` with a TV emulator. Run `pnpm expo prebuild --clean` without `EXPO_TV` to go back to the phone build |
| Mac app | `pnpm expo start --web --port 8082` in one terminal, `pnpm desktop:dev` in another (needs `brew install mpv` and Rust) |

A native build is needed again after a change in `modules/`, `patches/`, native dependencies or `app.json` native config. For JS changes, Metro reloads the app.

**Do not start Metro with `CI=1`.** With `CI=1`, Metro turns off reloads and Fast Refresh, and your changes never reach the app. If the app shows old code, stop Metro and start it again with plain `pnpm start`.

## 2. Sign in

Use the public Jellyfin demo server. Never use a private server for screenshots or logs.

- Server: `https://demo.jellyfin.org/stable`
- User: `demo`
- Password: empty

Type into a focused text field only. **On the iOS simulator, a typed `d` outside a text field opens the dev menu** (hardware keyboard). Tap the field first, or paste the text.

Useful development settings (Settings, Development): "Simulate no server" (offline mode) and "Admin fixture data" (the admin panel with made-up data; web: `?adminFixtures=1`).

## 3. Drive the iOS simulator

```sh
xcrun simctl list devices booted            # the booted simulator
xcrun simctl io booted screenshot shot.png  # a screenshot
xcrun simctl openurl booted "zoggyfin://"   # open the app scheme
xcrun simctl ui booted appearance dark      # dark theme (or light)
```

Check every screen change in both appearances.

## 4. Record a gesture and look at the frames

Use this for swipes, pull to refresh, sheet drags and transitions, where a single screenshot misses the problem.

```sh
xcrun simctl io booted recordVideo --codec=h264 --force gesture.mp4
# do the gesture in the simulator, then press Ctrl+C in this terminal to stop
mkdir -p frames
ffmpeg -i gesture.mp4 -vf fps=10 frames/%03d.png
```

- Raise `fps` (for example 30) for a short, fast gesture.
- Read the frames in order and look for blinks, jumps, a missing spinner or a wrong final state.
- Crop to an area with `-vf "fps=10,crop=w:h:x:y"` when the change is small.
- Put the video and the frames in a scratch folder, not in the repository. Do not commit them.

Android: `adb exec-out screencap -p > shot.png` and `adb shell screenrecord /sdcard/g.mp4` (then `adb pull /sdcard/g.mp4`).

## 5. Logs

- Metro shows `console.log` and `console.warn` from JS.
- iOS native logs: `xcrun simctl spawn booted log stream --predicate 'process == "Zoggyfin"'`.
- Android: `adb logcat`.
- Never paste tokens, invite links or one-time passwords from logs into issues or commits.
