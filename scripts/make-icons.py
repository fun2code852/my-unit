#!/usr/bin/env python3
"""Rasterize icons/icon.svg (geometric 1 + dotted underline) to PNG. No Pillow."""
import struct
import zlib
from pathlib import Path

RED = (197, 69, 70, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def sdf_segment(px, py, ax, ay, bx, by):
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay or 1.0
    h = clamp((pax * bax + pay * bay) / denom)
    dx, dy = pax - bax * h, pay - bay * h
    return (dx * dx + dy * dy) ** 0.5


def sdf_circle(px, py, cx, cy):
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def sdf_round_box(px, py, size, radius):
    hx = hy = size * 0.5
    x = px - hx
    y = py - hy
    ax = abs(x) - (hx - radius)
    ay = abs(y) - (hy - radius)
    qx, qy = max(ax, 0.0), max(ay, 0.0)
    return (qx * qx + qy * qy) ** 0.5 + min(max(ax, ay), 0.0) - radius


def cover(dist, aa):
    return clamp(0.5 - dist / aa)


def overlay(dst, src, a):
    if a <= 0:
        return dst
    if a >= 1:
        return src
    ia = 1 - a
    return (
        int(dst[0] * ia + src[0] * a),
        int(dst[1] * ia + src[1] * a),
        int(dst[2] * ia + src[2] * a),
        int(min(255, dst[3] * ia + src[3] * a)),
    )


def glyph_dist(x, y, canvas, out_size):
    """Distance to the 1 + three dots in 128-viewBox units, scaled to `canvas`."""
    k = canvas / 128.0
    stroke_vb = 18 if out_size <= 16 else 14
    stroke = stroke_vb * k * 0.5
    d = sdf_segment(x, y, 46 * k, 44 * k, 66 * k, 28 * k) - stroke
    d = min(d, sdf_segment(x, y, 66 * k, 28 * k, 66 * k, 86 * k) - stroke)
    dr = (8 if out_size <= 16 else 6) * k
    dy = 100 if out_size <= 16 else 104
    for cx in (46, 64, 82):
        d = min(d, sdf_circle(x, y, cx * k, dy * k) - dr)
    return d


def render(size: int, ss: int = 4) -> bytes:
    n = size * ss
    aa = 0.65
    grid = []
    for y in range(n):
        for x in range(n):
            px, py = x + 0.5, y + 0.5
            pix = CLEAR
            box = sdf_round_box(px, py, n, 32 / 128 * n)
            pix = overlay(pix, RED, cover(box, aa))
            pix = overlay(pix, WHITE, cover(glyph_dist(px, py, n, size), aa))
            grid.append(pix)

    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            r = g = b = a = 0
            for oy in range(ss):
                for ox in range(ss):
                    pr, pg, pb, pa = grid[(y * ss + oy) * n + (x * ss + ox)]
                    r += pr
                    g += pg
                    b += pb
                    a += pa
            count = ss * ss
            row.extend((r // count, g // count, b // count, a // count))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    )


root = Path(__file__).resolve().parent.parent / "icons"
root.mkdir(exist_ok=True)
for size in (16, 48, 128):
    write_png(root / f"icon{size}.png", size, render(size))
    print("wrote", size)
