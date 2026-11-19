// Draws the app icon (bow of a racing shell with a bowball, on a diagonal) and writes every PNG variant.
// Run: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BG = [0x09, 0x0d, 0x16];
const HULL = [0x38, 0xbd, 0xf8];
const DECK = [0x16, 0x1f, 0x33];
const BALL = [0xf8, 0xfa, 0xfc];
const WHITE = [255, 255, 255];

// Shapes in a 100x100 box, bow pointing up; the whole group is then rotated 42 degrees about (50, 56).
const cubic = (p0, p1, p2, p3, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
const hull = [...cubic([50, 6], [60, 30], [67, 70], [69, 130]), [71, 220], [29, 220], ...cubic([31, 130], [33, 70], [40, 30], [50, 6])];
const deck = [...cubic([50, 40], [55, 62], [57, 92], [58, 130]), [59.5, 220], [40.5, 220], ...cubic([42, 130], [43, 92], [45, 62], [50, 40])];
const ball = { x: 50, y: 2, r: 7 };

const inside = (poly, x, y) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const A = (-42 * Math.PI) / 180, COS = Math.cos(A), SIN = Math.sin(A);
/** Colour of the artwork at icon coordinate (x, y), or null where there is none. */
function art(x, y, scale, mono) {
  const sx = 50 + (x - 50) / scale, sy = 50 + (y - 50) / scale;
  const dx = sx - 50, dy = sy - 56;
  const lx = 50 + dx * COS - dy * SIN, ly = 56 + dx * SIN + dy * COS;
  if ((lx - ball.x) ** 2 + (ly - ball.y) ** 2 <= ball.r ** 2) return mono ? WHITE : BALL;
  if (ly < -10 || lx < 25 || lx > 75) return null;
  if (inside(deck, lx, ly)) return mono ? null : DECK;
  if (inside(hull, lx, ly)) return mono ? WHITE : HULL;
  return null;
}

const inRounded = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 100 - r), cy = Math.min(Math.max(y, r), 100 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** bg: 'solid' | 'rounded' | 'none'. */
function render(file, size, { scale = 1, bg = 'solid', mono = false, artwork = true }) {
  const png = new PNG({ width: size, height: size });
  const S = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let s = 0; s < S * S; s++) {
        const x = ((px + ((s % S) + 0.5) / S) / size) * 100, y = ((py + (Math.floor(s / S) + 0.5) / S) / size) * 100;
        const clip = bg !== 'rounded' || inRounded(x, y, 22);
        const c = clip ? (artwork ? art(x, y, scale, mono) : null) ?? (bg === 'none' ? null : BG) : null;
        if (c) (r += c[0]), (g += c[1]), (b += c[2]), a++;
      }
      const i = (py * size + px) * 4;
      png.data[i] = a ? r / a : 0;
      png.data[i + 1] = a ? g / a : 0;
      png.data[i + 2] = a ? b / a : 0;
      png.data[i + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'images', file), PNG.sync.write(png));
  console.log('wrote', file);
}

render('icon.png', 1024, {});
// Adaptive icon: launchers show only the middle ~66 %, so the artwork is drawn smaller.
render('android-icon-foreground.png', 1024, { scale: 0.62, bg: 'none' });
render('android-icon-monochrome.png', 1024, { scale: 0.62, bg: 'none', mono: true });
render('android-icon-background.png', 1024, { artwork: false });
render('splash-icon.png', 512, { bg: 'rounded' });
render('favicon.png', 48, { bg: 'rounded' });
