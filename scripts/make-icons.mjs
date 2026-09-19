// Renders public/icons/{192,512,maskable-512}.png from the same mark as public/icon.svg:
// a teal (#0f6e63) rounded square with a white check. Pure Node (zlib only), so no image deps.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const TEAL = [0x0f, 0x6e, 0x63];
const WHITE = [0xff, 0xff, 0xff];
// Check polyline in the 512 design space (matches icon.svg), stored centred: three points, stroke 56, round caps.
const CHECK = [
  [136, 268],
  [226, 356],
  [384, 176],
].map(([x, y]) => [x - 256, y - 256]);
const STROKE = 56;

// ---- CRC32 (Node 20 has no zlib.crc32) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- geometry (signed distances, in design units) ----
function sdRoundedBox(x, y, half, radius) {
  const qx = Math.abs(x) - half + radius;
  const qy = Math.abs(y) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}
function coverage(d) {
  // anti-aliased edge: distance <= 0 fully inside, fades over one design unit
  return Math.max(0, Math.min(1, 0.5 - d));
}

/**
 * @param {number} size output pixels
 * @param {{ maskable: boolean }} opts maskable: full-bleed background, mark shrunk to the 80 % safe zone
 */
function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 3×3 supersampling
  const scale = 512 / size;
  const markScale = maskable ? 0.8 : 1;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          const cx = (x - 256) / markScale;
          const cy = (y - 256) / markScale;
          const bg = maskable ? 1 : coverage(sdRoundedBox(cx, cy, 256, 112));
          let dCheck = Number.POSITIVE_INFINITY;
          for (let i = 0; i < CHECK.length - 1; i++) {
            dCheck = Math.min(
              dCheck,
              sdSegment(cx, cy, CHECK[i][0], CHECK[i][1], CHECK[i + 1][0], CHECK[i + 1][1]),
            );
          }
          const fg = coverage(dCheck - STROKE / 2) * bg;
          const col = [0, 1, 2].map((k) => TEAL[k] * (bg - fg) + WHITE[k] * fg);
          r += col[0];
          g += col[1];
          b += col[2];
          a += bg;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      // un-premultiply so transparent corners stay clean
      const alpha = a / n;
      rgba[o] = alpha > 0 ? Math.round(r / n / alpha) : 0;
      rgba[o + 1] = alpha > 0 ? Math.round(g / n / alpha) : 0;
      rgba[o + 2] = alpha > 0 ? Math.round(b / n / alpha) : 0;
      rgba[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['192.png', render(192, { maskable: false })],
  ['512.png', render(512, { maskable: false })],
  ['maskable-512.png', render(512, { maskable: true })],
];
for (const [name, png] of files) {
  writeFileSync(join(OUT, name), png);
  console.log(`wrote public/icons/${name} (${png.length} bytes)`);
}
