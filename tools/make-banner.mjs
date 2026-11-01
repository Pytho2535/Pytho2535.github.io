/*
  Draws the link-preview banner (src/assets/banner.png): what Discord,
  Slack, X and the rest show under a link to the site.

  It is the home page in one still: stars over a faint nebula, the green
  planet's dotted horizon across the bottom, two planets far off, and the
  name with the line under it. The lettering is traced from the site's
  own font files, so it matches the page exactly.

      node tools/make-banner.mjs
*/
import { readFileSync } from 'node:fs';
import { create } from 'fontkitten';
import sharp from 'sharp';

const W = 2400;
const H = 1260;
const OUT = new URL('../src/assets/banner.png', import.meta.url);
const font = (file) => create(readFileSync(new URL(`../public/fonts/${file}`, import.meta.url)));
const serif = font('instrument-serif-400-latin.woff2');
const sans = font('instrument-sans-400-latin.woff2');

const ACCENT = '#2BE39B';
const DEEP = '#11B97A';

/* A fixed seed, so the banner comes out the same every time. */
let seed = 1337;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* The same noise the site's planet uses for its continents. */
function hash(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}
function fbm(x, y, z) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---- text, traced from the font ---- */

function text(face, content, size, centreX, baseline, fill, extra = '') {
  const glyphs = face.glyphsForString(content);
  const scale = size / face.unitsPerEm;
  const width = glyphs.reduce((sum, g) => sum + g.advanceWidth, 0) * scale;
  let x = centreX - width / 2;
  const paths = glyphs.map((g, i) => {
    const colour = typeof fill === 'function' ? fill(i) : fill;
    const d = g.path.toSVG();
    const out = d ? `<path fill="${colour}" transform="translate(${x.toFixed(1)} ${baseline}) scale(${scale} ${-scale})" d="${d}"/>` : '';
    x += g.advanceWidth * scale;
    return out;
  });
  return `<g ${extra}>${paths.join('')}</g>`;
}

/* ---- the planet's horizon ---- */

const R = 1500;
const CX = W / 2;
const CY = 880 + R;
const light = (() => { const v = [-0.55, 0.65, 0.55]; const l = Math.hypot(...v); return v.map((n) => n / l); })();
const dots = [];
const count = 110000;
const golden = Math.PI * (3 - Math.sqrt(5));
const tilt = 0.32;
for (let i = 0; i < count; i++) {
  const y = 1 - ((i + 0.5) / count) * 2;
  const r = Math.sqrt(1 - y * y);
  let vx = Math.cos(i * golden) * r;
  let vy = y;
  const vz = Math.sin(i * golden) * r;
  const land = fbm(vx * 1.7 + 11.3, vy * 1.7 + 4.1, vz * 1.7 + 7.7) > 0.5;
  // Tipped like the globe on the page.
  [vx, vy] = [vx * Math.cos(tilt) - vy * Math.sin(tilt), vx * Math.sin(tilt) + vy * Math.cos(tilt)];
  if (vz <= 0) continue;
  const sx = CX + vx * R;
  const sy = CY - vy * R;
  if (sy > H + 4 || sx < -4 || sx > W + 4) continue;
  const lit = smoothstep(-0.3, 0.8, vx * light[0] + vy * light[1] + vz * light[2]);
  const alpha = (land ? 0.95 : 0.22) * (0.14 + 0.86 * lit);
  if (alpha < 0.03) continue;
  dots.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${land ? 2.6 : 1.7}" fill="${land ? ACCENT : DEEP}" fill-opacity="${alpha.toFixed(2)}"/>`);
}

/* ---- stars ---- */

const stars = [];
for (let i = 0; i < 950; i++) {
  const x = random() * W;
  const y = random() * H;
  if (Math.hypot(x - CX, y - CY) < R + 30) continue;
  const bright = random() < 0.07;
  const pick = random();
  const colour = pick < 0.12 ? ACCENT : pick < 0.22 ? '#9db8ff' : '#e6edff';
  const size = bright ? 2.2 + random() * 1.4 : 0.8 + random() * 1.2;
  stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(2)}" fill="${colour}" fill-opacity="${(0.35 + random() * 0.6).toFixed(2)}"/>`);
}

/* ---- two planets far off ---- */

function distant(x, y, r, colour, id) {
  return `
    <radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.82" stop-color="#05070d"/>
      <stop offset="1" stop-color="${colour}" stop-opacity="0.55"/>
    </radialGradient>
    <circle cx="${x}" cy="${y}" r="${r * 1.25}" fill="${colour}" fill-opacity="0.12" filter="url(#soft)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>`;
}

const title = text(serif, 'Pytho.', 380, W / 2, 565, (i) => (i === 5 ? ACCENT : '#eef2f0'));
const glow = text(serif, 'Pytho.', 380, W / 2, 565, ACCENT, 'opacity="0.22" filter="url(#glow)"');
const line1 = text(sans, 'Security research and bug bounty.', 58, W / 2, 745, '#a7b0b8');
const line2 = text(sans, 'This is where I keep my Hack The Box writeups.', 58, W / 2, 823, '#a7b0b8');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="nebulaA" cx="0.85" cy="0.1" r="0.7">
      <stop offset="0" stop-color="#13244a" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#13244a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebulaB" cx="0.08" cy="0.95" r="0.6">
      <stop offset="0" stop-color="#0c3b3a" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#0c3b3a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="body" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="${R}">
      <stop offset="0.9" stop-color="#04100c"/>
      <stop offset="0.985" stop-color="#062a1d"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0.55"/>
    </radialGradient>
    <filter id="halo" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="45"/></filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#05070d"/>
  <rect width="${W}" height="${H}" fill="url(#nebulaA)"/>
  <rect width="${W}" height="${H}" fill="url(#nebulaB)"/>
  ${stars.join('')}
  ${distant(330, 360, 78, '#b49cff', 'farA')}
  ${distant(2080, 470, 104, '#4fd1d9', 'farB')}
  <circle cx="${CX}" cy="${CY}" r="${R + 10}" fill="none" stroke="${ACCENT}" stroke-width="90" stroke-opacity="0.45" filter="url(#halo)"/>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#body)"/>
  ${dots.join('')}
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-opacity="0.8"/>
  <ellipse cx="${CX}" cy="${CY - 120}" rx="${R * 1.32}" ry="${R * 0.42}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-opacity="0.16" transform="rotate(-6 ${CX} ${CY})"/>
  ${glow}
  ${title}
  ${line1}
  ${line2}
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log(`banner: ${W}x${H}, ${dots.length} planet dots, ${stars.length} stars`);
