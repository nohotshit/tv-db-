"""
Turn the RGB logo into a 1024x1024 RGBA PNG with the black background removed.

Stdlib only - zlib does the heavy lifting, everything else is chunk plumbing.

Why 1024: Second Life textures cap at 1024 and want power-of-two dimensions,
and the interface never draws the logo larger than ~620px. 2000x2000 is wasted
bytes on every page load.

Alpha is derived from luminance rather than a hard colour key, so the
antialiased edges of the headphones and the script lettering stay smooth
instead of turning into a jagged cutout. Colour is un-premultiplied afterwards
so edge pixels keep their real hue rather than going muddy.
"""
import zlib, struct, sys

src = sys.argv[1]
dst = sys.argv[2]
SIZE = 1024

data = open(src, 'rb').read()
assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'

# ---- read chunks ----
pos, idat, w, h, depth, ctype = 8, b'', 0, 0, 0, 0
while pos < len(data):
    ln = struct.unpack('>I', data[pos:pos+4])[0]
    typ = data[pos+4:pos+8]
    body = data[pos+8:pos+8+ln]
    if typ == b'IHDR':
        w, h, depth, ctype, comp, filt, inter = struct.unpack('>IIBBBBB', body)
        assert depth == 8 and ctype == 2 and inter == 0, 'expected 8-bit non-interlaced RGB'
    elif typ == b'IDAT':
        idat += body
    elif typ == b'IEND':
        break
    pos += 12 + ln

raw = zlib.decompress(idat)

# ---- undo per-scanline filtering ----
bpp, stride = 3, w * 3
out = bytearray(stride * h)
p = 0
for y in range(h):
    f = raw[p]; p += 1
    line = bytearray(raw[p:p+stride]); p += stride
    base = y * stride
    prev = base - stride
    for x in range(stride):
        a = line[x-bpp] if x >= bpp else 0
        b = out[prev+x] if y > 0 else 0
        c = out[prev+x-bpp] if (y > 0 and x >= bpp) else 0
        if f == 1:   line[x] = (line[x] + a) & 255
        elif f == 2: line[x] = (line[x] + b) & 255
        elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
        elif f == 4:
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2*c)
            pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[x] = (line[x] + pr) & 255
    out[base:base+stride] = line

# ---- box downsample to SIZE, adding alpha from luminance ----
rgba = bytearray(SIZE * SIZE * 4)
step = w / SIZE
for ty in range(SIZE):
    y0, y1 = int(ty*step), max(int(ty*step)+1, int((ty+1)*step))
    for tx in range(SIZE):
        x0, x1 = int(tx*step), max(int(tx*step)+1, int((tx+1)*step))
        r = g = b = n = 0
        for yy in range(y0, min(y1, h)):
            row = yy * stride
            for xx in range(x0, min(x1, w)):
                i = row + xx*3
                r += out[i]; g += out[i+1]; b += out[i+2]; n += 1
        r //= n; g //= n; b //= n
        a = max(r, g, b)                       # black background -> transparent
        if a:                                  # un-premultiply so edges keep hue
            r = min(255, r*255//a); g = min(255, g*255//a); b = min(255, b*255//a)
        o = (ty*SIZE + tx) * 4
        rgba[o] = r; rgba[o+1] = g; rgba[o+2] = b; rgba[o+3] = a

# ---- encode ----
def chunk(typ, body):
    return struct.pack('>I', len(body)) + typ + body + struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff)

lines = bytearray()
for y in range(SIZE):
    lines.append(0)                             # filter type: none
    lines += rgba[y*SIZE*4:(y+1)*SIZE*4]

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(lines), 9))
       + chunk(b'IEND', b''))
open(dst, 'wb').write(png)
print('wrote', dst, len(png), 'bytes', SIZE, 'x', SIZE, 'RGBA')
