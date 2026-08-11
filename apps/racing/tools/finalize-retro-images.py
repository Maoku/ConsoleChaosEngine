#!/usr/bin/env python3
"""Finalize and validate the checked-in FC/SFC Image Gen outputs."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
SPECS = {
    "gen1/sprites/cars.png": ((384, 256), 24, True),
    "gen1/backgrounds/coast.png": ((512, 192), 24, False),
    "gen1/road/road.png": ((256, 256), 16, False),
    "gen2/sprites/cars.png": ((384, 256), 128, True),
    "gen2/backgrounds/coast.png": ((512, 192), 128, False),
    "gen2/tiles/circuit.png": ((256, 256), 128, False),
}


def remove_green_spill(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    cleaned = []
    for red, green, blue, alpha in rgba.get_flattened_data():
        if alpha and green > 80 and green > red * 1.35 and green > blue * 1.35:
            cleaned.append((red, green, blue, 0))
        else:
            cleaned.append((red, green, blue, alpha))
    rgba.putdata(cleaned)
    return rgba


def quantize(image: Image.Image, colors: int, has_alpha: bool) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    rgb = rgba.convert("RGB").quantize(
        colors=colors,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    ).convert("RGB")
    if not has_alpha:
        return rgb
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    result.putdata([
        pixel if pixel[3] else (0, 0, 0, 0)
        for pixel in result.get_flattened_data()
    ])
    return result


def seam_error(image: Image.Image) -> tuple[float, float]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    top_bottom = sum(
        abs(pixels[x, 0][channel] - pixels[x, height - 1][channel])
        for x in range(width)
        for channel in range(3)
    ) / (width * 3)
    left_right = sum(
        abs(pixels[0, y][channel] - pixels[width - 1, y][channel])
        for y in range(height)
        for channel in range(3)
    ) / (height * 3)
    return top_bottom, left_right


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate without rewriting images")
    args = parser.parse_args()
    failed = False
    for relative, (expected_size, palette_budget, has_alpha) in SPECS.items():
        path = ASSETS / relative
        image = Image.open(path)
        if not args.check:
            if image.size != expected_size:
                image = image.resize(expected_size, Image.Resampling.NEAREST)
            if has_alpha:
                image = remove_green_spill(image)
            image = quantize(image, palette_budget, has_alpha)
            image.save(path, optimize=True)
        image = Image.open(path).convert("RGBA")
        color_count = len(image.getcolors(maxcolors=10_000_000) or [])
        transparent = sum(1 for alpha in image.getchannel("A").get_flattened_data() if alpha == 0)
        top_bottom, left_right = seam_error(image)
        valid = image.size == expected_size and color_count <= palette_budget + (1 if has_alpha else 0)
        if has_alpha:
            valid = valid and transparent > image.width * image.height // 3
        failed = failed or not valid
        print(
            f"{relative}: size={image.width}x{image.height} colors={color_count} "
            f"transparent={transparent} seamTB={top_bottom:.2f} seamLR={left_right:.2f} "
            f"{'PASS' if valid else 'FAIL'}"
        )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
