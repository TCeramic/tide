"""Build Tide's Windows icon from the official wave mark.

Large sizes are a tight crop of the source. At 64 and below the bright crest
is thickened so the wave still reads. Corners outside the rounded square are
transparent. No third-party icon art.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "tide-icon-wave.png"
OUT_DIR = ROOT / "build" / "icons"
ICO_PATH = ROOT / "build" / "icon.ico"
SIZES = (256, 128, 64, 48, 32, 16)


def crop_mark(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    background = pixels[2, 2]

    def outside(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        return (
            abs(red - background[0]) < 18
            and abs(green - background[1]) < 22
            and abs(blue - background[2]) < 28
            and red + green + blue < 140
        )

    seen = bytearray(width * height)
    stack = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= width or y >= height:
            continue
        index = y * width + x
        if seen[index]:
            continue
        seen[index] = 1
        if not outside(x, y):
            continue
        seen[index] = 2
        stack.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

    left, top, right, bottom = width, height, 0, 0
    for y in range(height):
        row = y * width
        for x in range(width):
            if seen[row + x] == 2:
                continue
            left = min(left, x)
            top = min(top, y)
            right = max(right, x)
            bottom = max(bottom, y)
    cropped = rgb.crop((left, top, right + 1, bottom + 1)).convert("RGBA")
    alpha = cropped.getchannel("A")
    mask = alpha.load()
    for y in range(bottom - top + 1):
        for x in range(right - left + 1):
            if seen[(y + top) * width + (x + left)] == 2:
                mask[x, y] = 0
    cropped.putalpha(alpha)
    return cropped


def thicken(image: Image.Image, radius: int) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    source = rgba.load()
    painted = rgba.copy()
    target = painted.load()
    highlights: list[tuple[int, int, tuple[int, int, int, int]]] = []
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = source[x, y]
            if alpha < 20:
                continue
            if red + green + blue > 460 and blue > 150 and green > 140:
                highlights.append((x, y, (red, green, blue, alpha)))
    for x, y, color in highlights:
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy > radius * radius:
                    continue
                xx, yy = x + dx, y + dy
                if xx < 0 or yy < 0 or xx >= width or yy >= height:
                    continue
                current = target[xx, yy]
                if current[3] < 20:
                    continue
                if current[0] + current[1] + current[2] >= color[0] + color[1] + color[2] - 24:
                    continue
                target[xx, yy] = color
    return painted.filter(ImageFilter.SMOOTH_MORE)


def render(master: Image.Image, size: int) -> Image.Image:
    if size >= 128:
        return master.resize((size, size), Image.Resampling.LANCZOS)
    work = master.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
    radius = 3 if size <= 24 else 2 if size <= 40 else 1
    thick = thicken(work, radius)
    return thick.resize((size, size), Image.Resampling.LANCZOS)


def write_ico(path: Path, images: list[tuple[int, bytes]]) -> None:
    count = len(images)
    blob = struct.pack("<HHH", 0, 1, count)
    payload = b""
    offset = 6 + 16 * count
    for size, png in images:
        entry_size = 0 if size >= 256 else size
        blob += struct.pack("<BBBBHHII", entry_size, entry_size, 0, 0, 1, 32, len(png), offset)
        payload += png
        offset += len(png)
    path.write_bytes(blob + payload)


def main() -> None:
    master = crop_mark(Image.open(SOURCE))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pngs: list[tuple[int, bytes]] = []
    for size in SIZES:
        frame = render(master, size)
        destination = OUT_DIR / f"{size}.png"
        frame.save(destination, format="PNG")
        pngs.append((size, destination.read_bytes()))
    frame256 = OUT_DIR / "256.png"
    frame256_image = Image.open(frame256)
    (ROOT / "build" / "icon.png").write_bytes(frame256.read_bytes())
    write_ico(ICO_PATH, pngs)
    print(f"wrote {ICO_PATH} ({ICO_PATH.stat().st_size} bytes) from {master.size}")
    frame256_image.close()


if __name__ == "__main__":
    main()
