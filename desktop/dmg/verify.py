"""Check the Finder layout of a built Zoggyfin DMG, without Finder (release.sh runs it).

    uv run --no-project --with ds_store==1.3.3 --with mac_alias==2.2.3 python desktop/dmg/verify.py <dmg>

Mounts the image read-only and checks: the Applications symlink, the app, the volume icon, the
.DS_Store window (bounds, no toolbar or sidebar, icon view, icon size), the icon positions and the
background alias pointing at the multi-resolution .background.tiff. Exits 1 with a list of problems.
"""

import os
import subprocess
import sys
import tempfile

from ds_store import DSStore
from mac_alias import Alias

WINDOW = "{{200, 160}, {600, 380}}"
ICONS = {"Zoggyfin.app": (150, 170), "Applications": (450, 170)}


def main(dmg: str) -> int:
    mount = tempfile.mkdtemp(prefix="zoggyfin-dmg-")
    subprocess.run(
        ["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    problems: list[str] = []
    try:
        apps = os.path.join(mount, "Applications")
        if not os.path.islink(apps) or os.readlink(apps) != "/Applications":
            problems.append("Applications is not a symlink to /Applications")
        if not os.path.isdir(os.path.join(mount, "Zoggyfin.app")):
            problems.append("Zoggyfin.app is missing")
        if not os.path.isfile(os.path.join(mount, ".VolumeIcon.icns")):
            problems.append(".VolumeIcon.icns is missing")
        tiff = os.path.join(mount, ".background.tiff")
        if not os.path.isfile(tiff):
            problems.append(".background.tiff is missing")
        else:
            info = subprocess.run(["tiffutil", "-info", tiff], capture_output=True, text=True).stdout
            if info.count("Image Width") < 2:
                problems.append(".background.tiff has no @2x image")
        store_path = os.path.join(mount, ".DS_Store")
        if not os.path.isfile(store_path):
            problems.append(".DS_Store is missing (Finder would use its default window)")
            return report(problems)
        with DSStore.open(store_path, "r") as store:
            bwsp = store["."]["bwsp"]
            icvp = store["."]["icvp"]
            if bwsp.get("WindowBounds") != WINDOW:
                problems.append(f"window bounds {bwsp.get('WindowBounds')!r}, expected {WINDOW!r}")
            for key in ("ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar", "ShowTabView"):
                if bwsp.get(key):
                    problems.append(f"{key} is on")
            if icvp.get("iconSize") != 128.0:
                problems.append(f"icon size {icvp.get('iconSize')}, expected 128")
            if icvp.get("backgroundType") != 2:
                problems.append("no background picture (backgroundType != 2)")
            else:
                alias = Alias.from_bytes(icvp["backgroundImageAlias"])
                if alias.target.filename != ".background.tiff":
                    problems.append(f"background alias points at {alias.target.filename!r}")
            for name, position in ICONS.items():
                try:
                    found = tuple(store[name]["Iloc"])
                except KeyError:
                    found = None
                if found != position:
                    problems.append(f"{name} at {found}, expected {position}")
        print(f"dmg layout: window {WINDOW}, icons {ICONS}, background .background.tiff (1x + 2x)")
    finally:
        subprocess.run(["hdiutil", "detach", mount, "-quiet"], check=False)
        if os.path.isdir(mount) and not os.listdir(mount):
            os.rmdir(mount)
    return report(problems)


def report(problems: list[str]) -> int:
    if problems:
        print("dmg layout problems:\n  - " + "\n  - ".join(problems), file=sys.stderr)
        return 1
    print("dmg layout: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
