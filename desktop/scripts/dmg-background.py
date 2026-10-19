# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Renders the background of the Zoggyfin DMG window.

    uv run desktop/scripts/dmg-background.py

Writes desktop/dmg/background.png (600x380) and background@2x.png (1200x760). dmgbuild finds
the @2x file next to the 1x file and joins both into one multi-resolution TIFF for Retina
screens. Commit both files; the release does not render them.

The layout must agree with desktop/dmg/settings.py: a 600x380 window, 128 pt icons with their
centres at (150, 170) for the app and (450, 170) for the Applications link. Finder draws the
icon labels in black, so the background is light: a quiet off-white, an arrow in the light
accent colour (docs/design/brand.md) and one grey line of text in the system font.
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 600, 380
ICON_Y = 170
APP_X, APPS_X = 150, 450
ICON_SIZE = 128
TEXT = "Drag Zoggyfin to Applications to install"
TEXT_Y = 300  # vertical centre of the text line

TOP = (252, 252, 253)
BOTTOM = (242, 242, 245)
ARROW = (181, 58, 23)  # accent (light theme) #B53A17
TEXT_COLOR = (89, 89, 99)  # text2 (light theme) #595963

FONTS = ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]
OUT = pathlib.Path(__file__).resolve().parent.parent / "dmg"


def system_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONTS:
        if pathlib.Path(path).exists():
            font = ImageFont.truetype(path, size)
            try:
                font.set_variation_by_name("Medium")
            except (OSError, ValueError):
                pass
            return font
    return ImageFont.load_default(size)


def render(scale: int) -> Image.Image:
    # Shapes are drawn at 4x the target size and scaled down, for smooth edges.
    ss = scale * 4
    w, h = WIDTH * ss, HEIGHT * ss
    img = Image.new("RGB", (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        px.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))

    # The arrow: a thin line between the two icons with an open chevron head.
    gap = 30
    x0 = (APP_X + ICON_SIZE / 2 + gap) * ss
    x1 = (APPS_X - ICON_SIZE / 2 - gap) * ss
    y = ICON_Y * ss
    stroke = round(2.5 * ss)
    head = 10 * ss
    px.line([(x0, y), (x1, y)], fill=ARROW, width=stroke)
    px.line([(x1 - head, y - head), (x1, y), (x1 - head, y + head)], fill=ARROW, width=stroke, joint="curve")
    r = stroke / 2
    for cx, cy in [(x0, y), (x1, y), (x1 - head, y - head), (x1 - head, y + head)]:
        px.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ARROW)
    img = img.resize((WIDTH * scale, HEIGHT * scale), Image.LANCZOS)

    # Text is drawn at the target size: the font rasterizer antialiases it.
    draw = ImageDraw.Draw(img)
    draw.text((WIDTH * scale / 2, TEXT_Y * scale), TEXT, font=system_font(13 * scale), fill=TEXT_COLOR, anchor="mm")
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for scale, name in [(1, "background.png"), (2, "background@2x.png")]:
        img = render(scale)
        # 72 dpi at 1x and 144 dpi at 2x tell macOS the point size of each image.
        img.save(OUT / name, optimize=True, dpi=(72 * scale, 72 * scale))
        print(f"wrote {OUT / name} {img.size}")


if __name__ == "__main__":
    main()
