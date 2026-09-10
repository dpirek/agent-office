import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SPRITE_NAMES = [
  "manager", "researcher", "developer", "designer",
  "qa-tester", "deployment-engineer", "analyst", "support-agent",
];

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbPng(file) {
  const input = fs.readFileSync(file);
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Input is not a PNG file.");
  let width;
  let height;
  const compressed = [];
  for (let offset = 8; offset < input.length;) {
    const length = input.readUInt32BE(offset);
    const type = input.toString("ascii", offset + 4, offset + 8);
    const data = input.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new Error("Expected a non-interlaced, 8-bit RGB PNG.");
      }
    } else if (type === "IDAT") compressed.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0, source = 0; y < height; y += 1) {
    const filter = filtered[source];
    source += 1;
    for (let x = 0; x < stride; x += 1, source += 1) {
      const left = x >= 3 ? pixels[y * stride + x - 3] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 3 ? pixels[(y - 1) * stride + x - 3] : 0;
      const value = filtered[source];
      const restored = filter === 0 ? value
        : filter === 1 ? value + left
          : filter === 2 ? value + above
            : filter === 3 ? value + Math.floor((left + above) / 2)
              : filter === 4 ? value + paeth(left, above, upperLeft)
                : NaN;
      if (!Number.isFinite(restored)) throw new Error(`Unsupported PNG filter: ${filter}`);
      pixels[y * stride + x] = restored & 255;
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

function writeRgbaPng(file, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

function isChroma(r, g, b) {
  return r > 150 && b > 150 && g < 115 && b / r > 0.7 && r - g > 80 && b - g > 70;
}

function extractSprite(image, column, row) {
  const cellWidth = Math.floor(image.width / 4);
  const cellHeight = Math.floor(image.height / 2);
  const rgba = Buffer.alloc(cellWidth * cellHeight * 4);
  let minX = cellWidth;
  let minY = cellHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const source = ((row * cellHeight + y) * image.width + column * cellWidth + x) * 3;
      const target = (y * cellWidth + x) * 4;
      const r = image.pixels[source];
      const g = image.pixels[source + 1];
      const b = image.pixels[source + 2];
      const alpha = isChroma(r, g, b) ? 0 : 255;
      rgba.set([r, g, b, alpha], target);
      if (alpha) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  const padding = 6;
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding);
  maxX = Math.min(cellWidth - 1, maxX + padding); maxY = Math.min(cellHeight - 1, maxY + padding);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    rgba.copy(cropped, y * width * 4, ((minY + y) * cellWidth + minX) * 4, ((minY + y) * cellWidth + minX + width) * 4);
  }
  return { width, height, pixels: cropped };
}

const [inputFile, outputDirectory] = process.argv.slice(2);
if (!inputFile || !outputDirectory) {
  throw new Error("Usage: node scripts/split-office-sprites.mjs <sheet.png> <output-directory>");
}
fs.mkdirSync(outputDirectory, { recursive: true });
const image = decodeRgbPng(inputFile);
if (image.width % 4 || image.height % 2) throw new Error("Sprite sheet must use a 4 by 2 grid.");
SPRITE_NAMES.forEach((name, index) => {
  const sprite = extractSprite(image, index % 4, Math.floor(index / 4));
  writeRgbaPng(path.join(outputDirectory, `${name}.png`), sprite.width, sprite.height, sprite.pixels);
});
