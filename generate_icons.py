"""Generate PWA icons for LED Solution Tool"""
import os, struct, zlib

def create_png(width, height, pixels):
    """Create PNG from RGBA pixel data"""
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter none
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx+4])
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

def make_icon(size):
    """Generate a simple LED-themed icon"""
    pixels = [0] * (size * size * 4)
    cx, cy = size // 2, size // 2
    r = int(size * 0.42)
    
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            idx = (y * size + x) * 4
            
            if dist <= r:
                # Inside circle - dark blue gradient
                t = dist / r
                pixels[idx]   = int(13 + t * 10)   # R
                pixels[idx+1] = int(71 - t * 20)    # G
                pixels[idx+2] = int(161 - t * 30)   # B
                pixels[idx+3] = 255                  # A
                
                # "LED" text area - lighter center band
                if size >= 96:
                    band_top = cy - int(size * 0.12)
                    band_bot = cy + int(size * 0.12)
                    if band_top <= y <= band_bot:
                        pixels[idx]   = min(255, pixels[idx] + 60)
                        pixels[idx+1] = min(255, pixels[idx+1] + 80)
                        pixels[idx+2] = min(255, pixels[idx+2] + 60)
            elif dist <= r + 1.5:
                # Anti-aliased edge
                alpha = max(0, int(255 * (1 - (dist - r) / 1.5)))
                pixels[idx]   = 13
                pixels[idx+1] = 71
                pixels[idx+2] = 161
                pixels[idx+3] = alpha
            else:
                # Transparent
                pixels[idx+3] = 0
    
    return create_png(size, size, pixels)

# Generate icons
icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(icons_dir, exist_ok=True)

sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for s in sizes:
    png = make_icon(s)
    path = os.path.join(icons_dir, f'icon-{s}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'icon-{s}.png  ({len(png)} bytes)')

print('All icons generated!')
