#!/usr/bin/env python3
"""Chrome Web Store graphic assets from the brand icon. Needs Pillow."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store"
ICON = ROOT / "icons" / "icon128.png"
RED = (197, 69, 70)
CREAM = (247, 243, 238)
INK = (28, 27, 26)


def font(size: int, bold: bool = False):
    names = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    )
    for path in names:
        try:
            if path.endswith(".ttc"):
                return ImageFont.truetype(path, size, index=1 if bold else 0)
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def write_tile() -> Path:
    tile = Image.new("RGB", (440, 280), CREAM)
    draw = ImageDraw.Draw(tile)
    icon = Image.open(ICON).convert("RGBA").resize((112, 112), Image.Resampling.LANCZOS)
    tile.paste(icon, (40, 84), icon)
    draw.text((172, 96), "My Unit", font=font(36, bold=True), fill=RED)
    draw.text((172, 148), "Hover a price. See it in", font=font(16), fill=INK)
    draw.text((172, 172), "one favourite unit.", font=font(16), fill=INK)
    tile.paste(Image.new("RGB", (440, 6), RED), (0, 274))
    path = OUT / "tile-440x280.png"
    tile.save(path, "PNG")
    return path


def fit_shot(src: Path, dest: Path) -> Path:
    img = Image.open(src).convert("RGB")
    if img.size != (1280, 800):
        img = img.resize((1280, 800), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG")
    return dest


def main() -> None:
    OUT.mkdir(exist_ok=True)
    print("wrote", write_tile())


if __name__ == "__main__":
    main()
