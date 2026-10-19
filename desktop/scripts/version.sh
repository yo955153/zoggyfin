#!/usr/bin/env bash
# Sets the version of the desktop app in all its places: tauri.conf.json, Cargo.toml and
# Cargo.lock (the zoggyfin-desktop package). It adds a "## <version>" section to
# desktop/CHANGELOG.md when there is none.
#
#   pnpm desktop:version 0.1.2
#
# It does not change the Expo app.json `version`: that version sets the runtime of the iPhone
# and iPad over-the-air updates.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI_DIR="$ROOT/desktop/src-tauri"
NEW="${1:-}"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "Usage: pnpm desktop:version <x.y.z>" >&2; exit 2; }

python3 - "$TAURI_DIR" "$NEW" "$ROOT/desktop/CHANGELOG.md" <<'PY'
import datetime, json, pathlib, re, sys
tauri, new, changelog = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])

conf = tauri / "tauri.conf.json"
text = conf.read_text()
old = json.loads(text)["version"]
text, n = re.subn(r'^(  "version": )"[^"]*"', rf'\1"{new}"', text, count=1, flags=re.M)
assert n == 1, "no version in tauri.conf.json"
conf.write_text(text)

cargo = tauri / "Cargo.toml"
text, n = re.subn(r'(\[package\]\nname = "zoggyfin-desktop"\nversion = )"[^"]*"', rf'\1"{new}"', cargo.read_text(), count=1)
assert n == 1, "no [package] version in Cargo.toml"
cargo.write_text(text)

lock = tauri / "Cargo.lock"
text, n = re.subn(r'(\[\[package\]\]\nname = "zoggyfin-desktop"\nversion = )"[^"]*"', rf'\1"{new}"', lock.read_text(), count=1)
assert n == 1, "no zoggyfin-desktop package in Cargo.lock"
lock.write_text(text)

log = changelog.read_text() if changelog.exists() else "# Zoggyfin for Mac: changes\n"
if not re.search(r"^## \[?v?" + re.escape(new) + r"\b", log, re.M):
    head, sep, rest = log.partition("\n## ")
    entry = f"\n## {new} ({datetime.date.today().isoformat()})\n\n- \n"
    log = head.rstrip("\n") + "\n" + entry + (("\n## " + rest) if sep else "")
    changelog.write_text(log)
    print(f"desktop/CHANGELOG.md: added '## {new}'. Write the notes there.")
print(f"desktop version {old} -> {new} (tauri.conf.json, Cargo.toml, Cargo.lock)")
PY
