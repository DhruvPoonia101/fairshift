"""Dev tooling, not part of the app: draws the FairShift mark (public/logo.svg) into the PNG icons the PWA
manifest lists (192, 512, and a maskable 512 with a safe-zone margin). Pure Python (zlib), no image library.
Run: python scripts/make-icons.py
The geometry below is the same as in public/logo.svg and public/icon-maskable.svg (a 64-unit grid)."""
import math
import os
import struct
import zlib

GOLD = (214, 178, 106)
INK = (20, 17, 13)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
SAMPLES = 3  # 3x3 samples per pixel: smooth edges without a graphics library


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def in_round_rect(x, y, size, radius):
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return math.hypot(x - cx, y - cy) <= radius


def glyph(x, y):
    """True where the ink mark covers the point (x, y) of the 64-unit grid."""
    d = math.hypot(x - 32, y - 32)
    if abs(d - 15) <= 1.8:  # ring
        return True
    if y >= 32 and d <= 15:  # filled lower half: the shift
        return True
    if seg_dist(x, y, 32, 32, 32, 21.5) <= 1.8:  # hand
        return True
    if seg_dist(x, y, 7.5, 32, 17, 32) <= 1.8 or seg_dist(x, y, 47, 32, 56.5, 32) <= 1.8:  # balance arms
        return True
    return False


def render(px_size, maskable):
    scale = 64 / px_size
    rows = []
    for j in range(px_size):
        row = bytearray([0])
        for i in range(px_size):
            r = g = b = a = 0
            for sj in range(SAMPLES):
                for si in range(SAMPLES):
                    x = (i + (si + 0.5) / SAMPLES) * scale
                    y = (j + (sj + 0.5) / SAMPLES) * scale
                    if maskable:
                        # Full-bleed gold, with the mark scaled to 72% around the centre (the safe zone).
                        tile, gx, gy = True, 32 + (x - 32) / 0.72, 32 + (y - 32) / 0.72
                    else:
                        tile, gx, gy = in_round_rect(x, y, 64, 16), x, y
                    if not tile:
                        continue
                    colour = INK if glyph(gx, gy) else GOLD
                    r, g, b, a = r + colour[0], g + colour[1], b + colour[2], a + 1
            n = SAMPLES * SAMPLES
            if a == 0:
                row += bytes([0, 0, 0, 0])
            else:
                row += bytes([round(r / a), round(g / a), round(b / a), round(255 * a / n)])
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(data)
    print(f'{os.path.basename(path)}  {len(data) / 1024:.1f} KB')


for name, size, maskable in [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('icon-maskable-512.png', 512, True)]:
    write_png(os.path.join(OUT, name), size, render(size, maskable))
