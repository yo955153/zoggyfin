"""Check the Finder layout of a built Zoggyfin DMG, without Finder (release.sh runs it).

    uv run --no-project --with ds_store==1.3.3 --with mac_alias==2.2.3 --with pillow==11.3.0 \
      python desktop/dmg/verify.py <dmg>

Mounts the image read-only and checks: the Applications symlink, the app, the volume icon, the
.DS_Store window (bounds, no toolbar or sidebar, icon view, icon size), the icon positions, the
background alias pointing at the multi-resolution .background.tiff, and the Applications folder
icon drawn in the art (desktop/scripts/dmg-background.py) in the same 128 pt box as the link.
Exits 1 with a list of problems.
"""

import os
import subprocess
import sys
import tempfile

from ds_store import DSStore
from mac_alias import Alias
from PIL import Image

WINDOW = "{{200, 160}, {600, 380}}"
ICONS = {"Zoggyfin.app": (150, 170), "Applications": (450, 170)}
ICON_SIZE = 128


def art_icon_box(tiff: str, centre: tuple[int, int]) -> tuple[float, float, float, float] | None:
    """The box (in points) of the drawn icon around `centre` in the @2x frame of the background.

    The art outside the icon is a grey gradient, so the icon is the pixels with colour (the blue
    folder) or with a large step from the gradient. Returns None when nothing is drawn there.
    """
    with Image.open(tiff) as img:
        frames = []
        for i in range(getattr(img, "n_frames", 1)):
            img.seek(i)
            frames.append(img.convert("RGB").copy())
    art = max(frames, key=lambda f: f.width)
    scale = art.width / 600
    half = ICON_SIZE / 2 + 16  # a little wider than the box (to see an icon that is too large), clear of the arrow
    left, top = round((centre[0] - half) * scale), round((centre[1] - half) * scale)
    right, bottom = round((centre[0] + half) * scale), round((centre[1] + half) * scale)
    region = art.crop((left, top, right, bottom))
    px = region.load()
    xs, ys = [], []
    for y in range(region.height):
        r0, g0, b0 = px[0, y]  # the gradient at this row
        for x in range(region.width):
            r, g, b = px[x, y]
            if abs(r - r0) + abs(g - g0) + abs(b - b0) > 60:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return ((left + min(xs)) / scale, (top + min(ys)) / scale, (left + max(xs) + 1) / scale, (top + max(ys) + 1) / scale)


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
            # The art draws the Applications icon where Finder draws the link (Finder on macOS 26
            # can leave the link icon blank). It must lie inside the link box and nearly fill it.
            cx, cy = ICONS["Applications"]
            h = ICON_SIZE / 2
            box = art_icon_box(tiff, (cx, cy))
            if box is None:
                problems.append("the background has no Applications icon at the link position")
            else:
                inside = box[0] >= cx - h and box[1] >= cy - h and box[2] <= cx + h and box[3] <= cy + h
                width = box[2] - box[0]
                if not inside or width < ICON_SIZE * 0.85:
                    problems.append(f"the Applications icon in the art is at {box}, expected inside the "
                                    f"{ICON_SIZE} pt box around {(cx, cy)} and at least {ICON_SIZE * 0.85:.0f} pt wide")
                else:
                    print(f"dmg art: Applications icon box {tuple(round(v, 1) for v in box)} in the link box around {(cx, cy)}")
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
            if icvp.get("iconSize") != float(ICON_SIZE):
                problems.append(f"icon size {icvp.get('iconSize')}, expected {ICON_SIZE}")
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
