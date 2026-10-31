---
name: ship-update
description: Decide whether a Zoggyfin change ships as an over-the-air (OTA) update or needs a new native build, and check that an OTA update is safe for the binaries that will get it. Use when asked to ship, release, publish an update or build the app, or when a change touches native code, patches, dependencies or app.json. Shipping itself is for the maintainer only.
---

# Ship: OTA update or native build

Only the maintainer publishes updates and builds. An agent may prepare the decision and the checks. Do not run `eas update`, `eas build` or `eas submit` unless the maintainer asks.

## 1. Find the last native build

Get the commit of the last native build for the platform. With EAS access:

```sh
eas build:list --platform ios --limit 1 --json --non-interactive   # read "gitCommitHash"
```

Without access, ask the maintainer for the commit or the build tag.

## 2. List what changed since then

```sh
git diff --name-only <build-commit>..HEAD
```

## 3. Does it need a native build?

A native build is needed if the diff touches any of:

- `modules/**` (Swift, Kotlin, podspec, `expo-module.config.json`)
- `patches/**` with native code, or `patchedDependencies` in `pnpm-workspace.yaml`
- Native dependencies in `package.json` (`expo-*`, `react-native-*`, `@kesha-antonov/*`, Nitro modules), added, removed or upgraded
- `app.json`: `ios`, `android`, `plugins`, permissions, entitlements, `infoPlist`, icons, splash, `scheme`
- The Expo SDK or `react-native-tvos` version

Quick filter:

```sh
git diff --name-only <build-commit>..HEAD | grep -E '^(modules/|patches/|app\.json|package\.json|pnpm-workspace\.yaml|eas\.json)'
```

For `package.json`, look at the diff: a JS-only dependency (for example `zod`) does not need a native build.

Everything else in `src/` and bundled assets can ship as an OTA update.

## 4. Check the OTA is safe

`runtimeVersion` uses the `appVersion` policy (`app.json`). Every binary with the same `version` gets the update, including binaries built before a native change.

- **Do not change `version` in `app.json`** to "make room" for an update. A new `version` cuts every installed binary off from new updates. Only the maintainer decides a version change, together with a new native build.
- New JS must run on the oldest binary with this `version`. Search the diff for new native imports:

  ```sh
  git diff <build-commit>..HEAD -- src | grep -E "^\+.*(from 'expo-|from 'react-native-|requireNativeModule\(|requireNativeView\()"
  ```

  A local or new native module must load with `requireOptionalNativeModule` and work (or hide the feature) when it is `null`. Examples: `src/native/zoggyfin-native.native.ts`, `src/together/nearby-native.native.ts`, `src/servers/discovery/backend.native.ts`.
- Keep JS workarounds for native bugs while old binaries are in use. Example: `src/player/engine.native.tsx` passes `artist` and `artwork` to expo-video; `patches/expo-video@58.0.13.patch` fixes only new builds.
- The `tv` EAS profile has its own `tv` channel. An update to `production` does not reach TV builds: publish to `tv` with `--platform android` as well, and check the TV layout (web `?tv=1` at least). TV APKs built before this change are on `production`.

## 5. Before shipping

Run the `verify-change` skill. All of `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass.

For a native build with a patch of an Expo module (for example `expo-video`), check that the patch is in the binary. Expo precompiles most `expo-*` iOS modules, and a precompiled module ignores the patch. The module must be in `expo.autolinking.ios.buildFromSource` in `package.json`. Then:

```sh
pnpm expo prebuild --clean --platform ios   # the module must not be in the "Precompiled modules" list
xcodebuild -workspace ios/Zoggyfin.xcworkspace -scheme Zoggyfin -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build > build.log 2>&1
grep NowPlayingManager.swift build.log      # no match: the patch is not in the binary
```

## 6. How each target gets the change

| Target | How it ships |
|---|---|
| iOS, Android, TV, JS only | OTA: `eas update --channel <channel> --message "<summary>"`. Channels in `eas.json`: `development`, `preview`, `production`, `tv` |
| iOS, Android, TV, native change | New build with the EAS profile (`production`, `tv`, `preview`), then store or TestFlight submission |
| Mac app | A desktop release (`pnpm desktop:release`, `pnpm desktop:publish`): the app embeds the web build, so OTA updates do not reach it. Notes go in `desktop/CHANGELOG.md` |
| Web | A new `pnpm expo export --platform web`, then host `dist/` |
| Website (`site/`) | Deploys from `main` through `.github/workflows/site.yml` |

Users see an OTA update: release builds check after start and on return to the foreground, download it, and show a card "An update is ready" with "Restart now" and "Later" (`src/platform/updates/ota.ts`). To show a short line on that card, set `ZOGGYFIN_UPDATE_MESSAGE="<one line>"` for the `eas update` command (app.config.ts puts it in the manifest). EAS does not put the `--message` text in the manifest. No links: the card removes them.

## 7. Report

Report: the last build commit, the decision (OTA or native build) with the files that decide it, the native-import check result, and the targets that need their own release.
