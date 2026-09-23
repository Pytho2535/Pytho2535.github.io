import fs from 'node:fs';
import path from 'node:path';

/*
  Every screenshot in a writeup gets its real size and a lazy flag at
  build time.

  Markdown writes `![alt](/images/slug/1.webp)` and nothing else, so the
  browser has no idea how tall the picture will be until the bytes
  arrive: the page jumps under the reader as each one lands, and all
  twenty-five of them are fetched at once. Stamping width and height on
  the tag lets the browser reserve the box, and loading="lazy" keeps the
  ones below the fold out of the first request.

  Dimensions are read from the file header by hand rather than by
  pulling in an image library: a PNG, a WebP and a JPEG all state their
  size in the first few dozen bytes.
*/

const PUBLIC_DIR = 'public';
const cache = new Map();

function png(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);

  // Extended: 24-bit canvas size, minus one, little endian.
  if (kind === 'VP8X') {
    return {
      width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  // Lossless: a signature byte, then two 14-bit fields, minus one.
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  // Lossy: 14 bits each, after the three-byte start code.
  if (kind === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function jpeg(buf) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    const size = buf.readUInt16BE(i + 2);
    // Every SOF carries the frame size, except the four that are not
    // frames at all (DHT, JPG, DAC, and the restart markers).
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + size;
  }
  return null;
}

function measure(src) {
  if (cache.has(src)) return cache.get(src);

  let size = null;
  try {
    const file = path.join(PUBLIC_DIR, src.replace(/^\/+/, ''));
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, read);
    size = png(head) ?? webp(head) ?? jpeg(head);
  } catch {
    // A missing or unreadable file is not worth failing a build over:
    // the image still renders, it just renders without a reserved box.
    size = null;
  }

  cache.set(src, size);
  return size;
}

function walk(node, fn) {
  fn(node);
  for (const child of node.children ?? []) walk(child, fn);
}

export function rehypeImageAttrs() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'img') return;
      const src = node.properties?.src;
      if (typeof src !== 'string' || !src.startsWith('/')) return;

      node.properties.loading ??= 'lazy';
      node.properties.decoding ??= 'async';

      const size = measure(src);
      if (size) {
        node.properties.width ??= size.width;
        node.properties.height ??= size.height;
      }
    });
  };
}
