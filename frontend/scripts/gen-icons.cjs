/**
 * Generates PNG icons for the PWA using pure-JS pngjs.
 * Creates a green dot on a dark background.
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

function makeIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.40;
  const innerR = size * 0.36;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;

      if (d2 <= innerR * innerR) {
        // Green dot (#00e676)
        png.data[i]   = 0;
        png.data[i+1] = 230;
        png.data[i+2] = 118;
        png.data[i+3] = 255;
      } else if (d2 <= outerR * outerR) {
        // Slight glow ring
        png.data[i]   = 0;
        png.data[i+1] = 80;
        png.data[i+2] = 40;
        png.data[i+3] = 255;
      } else {
        // Dark background (#0a0a0a)
        png.data[i]   = 10;
        png.data[i+1] = 10;
        png.data[i+2] = 10;
        png.data[i+3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

const pub = path.join(__dirname, '..', 'public');
fs.mkdirSync(pub, { recursive: true });

fs.writeFileSync(path.join(pub, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(pub, 'icon-512.png'), makeIcon(512));
fs.writeFileSync(path.join(pub, 'icon-1024.png'), makeIcon(1024));
fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), makeIcon(180));
console.log('✓ PWA + macOS icons generated');
