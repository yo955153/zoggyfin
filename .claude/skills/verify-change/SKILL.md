---
name: verify-change
description: Check a Zoggyfin change before a commit or a pull request. Use when you finish a change, when asked to "verify", "check" or "test" a diff, or before you commit. It maps the changed files to the affected areas, runs typecheck, lint and the right Jest tests, and lists the manual checks and the native-build question.
---

# Verify a change

Work from the repository root. Never run tests from `.claude/worktrees/` or a parent folder.

## 1. Get the changed files

```sh
git status --short
git diff --name-only HEAD          # uncommitted changes
git diff --name-only main...HEAD   # a branch against main
```

## 2. Map files to areas

Use the matrix in `AGENTS.md`, section 4 ("Change → what to check"). Quick map from path to tests:

| Changed path | Jest paths to run |
|---|---|
| `src/api/`, `src/images/` | `src/api src/images` |
| `src/auth/` | `src/auth` |
| `src/servers/`, `src/lib/online.ts` | `src/servers` |
| `src/player/` (not `audio/`) | `src/player src/downloads src/together` (downloads and together use the device profile, stream plan and session) |
| `src/player/audio/` | `src/player/audio src/together` |
| `src/downloads/` | `src/downloads src/player src/together` |
| `src/together/` | `src/together` |
| `src/extensions/`, `src/registry/`, `src/features/actions/`, `src/features/home/` | `src/extensions src/registry` |
| `src/invite/`, `site/public/join/` | `src/invite` |
| `src/features/<name>/` | `src/features/<name>` (when it has `__tests__/`) |
| `src/theme/`, `src/components/`, `src/lib/` | `src/theme src/lib` |
| `src/platform/` | `src/platform` |
| `src/native/` | `src/native src/player` |

If a pure module changed and it has no test, add one in the `__tests__/` folder next to it.

## 3. Run the checks

```sh
pnpm typecheck
pnpm lint
pnpm jest <paths from step 2>
```

Before a commit, run the full suite once: `pnpm test`.

Extra checks:

- `desktop/` changed: `cd desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings` (macOS with Homebrew `mpv`).
- `src/together/rendezvous*` or `modules/zoggyfin-native/ios/RendezvousCrypto.swift` changed: `pnpm test:crypto-swift`.
- `docs/design/theme.ts` changed: copy it to `src/theme/theme.ts` and check that the two files match.

## 4. Native build or OTA?

If any of these changed, the change needs a new native build (see `AGENTS.md` section 5):
`modules/`, `patches/`, native dependencies in `package.json`, `pnpm-workspace.yaml` patches, or the `ios`, `android` or `plugins` parts of `app.json`.

Also check the JS side: new code must not import a native package at the top level when older binaries lack it. Search the diff:

```sh
git diff main...HEAD -- src | grep -E "^\+.*(from 'expo-|from 'react-native-|requireNativeModule\()"
```

Use `requireOptionalNativeModule` and a fallback for local or new native modules.

## 5. Manual checks

Take the "Manual check" column of the matrix for each affected area. Typical sets:

- UI: light and dark theme, phone and iPad widths, the web, and TV (web `?tv=1` or a TV build). See the `run-simulator` skill.
- Player: iOS, Android, web and the Mac app engines.
- Downloads: download, pause, kill and restart, resume, offline play ("Simulate no server"), a download from another server.
- Pull to refresh on a large-title screen (iOS 26): `refreshTint` + `useRefreshSpinner`.

## 6. Report

Report: the areas affected, the commands you ran and their results, the manual checks done or still open, and whether the change needs a native build.
