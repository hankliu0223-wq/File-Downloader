"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgbaPixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = chunk("IDAT", zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function roundedRectDistance(x, y, x0, y0, x1, y1, radius) {
  const halfW = (x1 - x0) / 2;
  const halfH = (y1 - y0) / 2;
  const cx = x0 + halfW;
  const cy = y0 + halfH;
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  return Math.sqrt(outsideX * outsideX + outsideY * outsideY) + Math.min(Math.max(qx, qy), 0) - radius;
}

function circleDistance(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

function segmentDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

const COLORS = {
  background: [11, 107, 203, 255],
  document: [255, 255, 255, 255],
  fold: [7, 87, 166, 255],
  badge: [255, 255, 255, 255],
  check: [7, 87, 166, 255],
  transparent: [0, 0, 0, 0]
};

function colorAt(nx, ny) {
  const background = roundedRectDistance(nx, ny, 0.05, 0.05, 0.95, 0.95, 0.2);
  if (background > 0) return COLORS.transparent;

  const document_ = roundedRectDistance(nx, ny, 0.26, 0.16, 0.68, 0.8, 0.05);
  if (document_ <= 0) {
    const distFromCorner = (0.68 - nx) + (ny - 0.16);
    const isFold = distFromCorner >= 0 && distFromCorner < 0.14;
    return isFold ? COLORS.fold : COLORS.document;
  }

  const badge = circleDistance(nx, ny, 0.78, 0.78, 0.2);
  if (badge <= 0) {
    const onCheck =
      segmentDistance(nx, ny, 0.69, 0.79, 0.76, 0.86) <= 0.035 ||
      segmentDistance(nx, ny, 0.76, 0.86, 0.88, 0.68) <= 0.035;
    return onCheck ? COLORS.check : COLORS.badge;
  }

  return COLORS.background;
}

function renderIcon(size) {
  const supersample = 4;
  const bigSize = size * supersample;
  const bigPixels = new Array(bigSize * bigSize);

  for (let y = 0; y < bigSize; y += 1) {
    for (let x = 0; x < bigSize; x += 1) {
      const nx = (x + 0.5) / bigSize;
      const ny = (y + 0.5) / bigSize;
      bigPixels[y * bigSize + x] = colorAt(nx, ny);
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = bigPixels[(y * supersample + sy) * bigSize + (x * supersample + sx)];
          r += px[0]; g += px[1]; b += px[2]; a += px[3];
        }
      }
      const count = supersample * supersample;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / count);
      rgba[offset + 1] = Math.round(g / count);
      rgba[offset + 2] = Math.round(b / count);
      rgba[offset + 3] = Math.round(a / count);
    }
  }

  return encodePng(size, size, rgba);
}

const SIZES = [16, 32, 48, 128];
const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const png = renderIcon(size);
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${png.length} bytes)`);
}
