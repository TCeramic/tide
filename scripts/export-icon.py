#!/usr/bin/env python3
"""Cut a transparent rounded Tide icon from the square wave artwork.

The source is fully opaque. The rounded square is masked here so the
top-right corner does not keep a rectangular block of background.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/home/ubuntu/.cursor/projects/workspace/uploads/tide-icon-source_edaf.png")
SIZES = (16, 32, 48, 64, 128, 256)
MASTER = 1024
RADIUS_RATIO = 0.2237


def rounded_alpha(size: int, radius: float) -> Image.Image:
    scale = 4
    big = size * scale
    rad = radius * scale
    mask = Image.new("L", (big, big), 0)
    pixels = mask.load()
    limit = big - rad
    for y in range(big):
        for x in range(big):
            cx = min(max(x + 0.5, rad), limit)
            cy = min(max(y + 0.5, rad), limit)
            distance = math.hypot((x + 0.5) - cx, (y + 0.5) - cy) - rad
            if distance <= -0.75:
                alpha = 255
            elif distance >= 0.75:
                alpha = 0
            else:
                alpha = int(round(255 * (0.75 - distance) / 1.5))
            pixels[x, y] = alpha
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def apply_mask(art: Image.Image) -> Image.Image:
    size = art.width
    radius = size * RADIUS_RATIO
    alpha = rounded_alpha(size, radius)
    red, green, blue, _old = art.split()
    merged = Image.merge("RGBA", (red, green, blue, alpha))
    pixels = merged.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = pixels[x, y]
            if a == 0:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                pixels[x, y] = (r, g, b, a)
    return merged


def outside(size: int, x: int, y: int) -> bool:
    radius = size * RADIUS_RATIO
    cx = min(max(x + 0.5, radius), size - radius)
    cy = min(max(y + 0.5, radius), size - radius)
    return math.hypot((x + 0.5) - cx, (y + 0.5) - cy) - radius > 1.25


def assert_clean(icon: Image.Image) -> None:
    pixels = icon.load()
    width, height = icon.size
    for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if pixels[x, y][3] != 0:
            raise SystemExit(f"corner {x},{y} is not transparent: {pixels[x, y]}")
    leaks = 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] > 18 and outside(width, x, y):
                leaks += 1
    if leaks:
        raise SystemExit(f"{leaks} pixels sit outside the rounded square")
    if pixels[width // 2, height // 2][3] < 250:
        raise SystemExit("the wave center was punched out")


def export(source: Path) -> None:
    art = Image.open(source).convert("RGBA")
    if art.width < 256 or art.height < 256:
        raise SystemExit(f"source is too small: {art.size}")
    side = min(art.width, art.height)
    left = (art.width - side) // 2
    top = (art.height - side) // 2
    square = art.crop((left, top, left + side, top + side)).resize((MASTER, MASTER), Image.Resampling.LANCZOS)
    masked = apply_mask(square)
    assert_clean(masked)
    icon_dir = ROOT / "build" / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    sized = {}
    for size in SIZES:
        resized = masked.resize((size, size), Image.Resampling.LANCZOS)
        sized[size] = apply_mask(resized)
    for size, image in sized.items():
        assert_clean(image)
        image.save(icon_dir / f"{size}.png")
    sized[256].save(ROOT / "build" / "icon.png")
    sized[256].save(
        ROOT / "build" / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES],
    )
    preview_dir = Path("/opt/cursor/artifacts")
    preview_dir.mkdir(parents=True, exist_ok=True)
    for color, name in (
        ((248, 246, 242), "icon-on-white"),
        ((226, 226, 226), "icon-on-gray"),
        ((7, 8, 11), "icon-on-ink"),
    ):
        board = Image.new("RGB", (360, 360), color)
        icon = sized[256]
        board.paste(icon, (52, 52), icon)
        board.save(preview_dir / f"{name}.png")
    print(f"exported {source} -> build/icon.png and build/icon.ico")


if __name__ == "__main__":
    export(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE)
