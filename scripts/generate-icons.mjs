import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function hash(x, y) {
  let value = (x * 374761393 + y * 668265263) ^ 0x5bf03635
  value = (value ^ (value >>> 13)) * 1274126177
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function polygonPoints(points) {
  return points
}

function insidePolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0]
    const yi = points[i][1]
    const xj = points[j][0]
    const yj = points[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = size / 512
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const index = (y * size + x) * 4
    const srcA = a / 255
    const dstA = pixels[index + 3] / 255
    const outA = srcA + dstA * (1 - srcA)
    if (outA === 0) return
    pixels[index] = Math.round((r * srcA + pixels[index] * dstA * (1 - srcA)) / outA)
    pixels[index + 1] = Math.round((g * srcA + pixels[index + 1] * dstA * (1 - srcA)) / outA)
    pixels[index + 2] = Math.round((b * srcA + pixels[index + 2] * dstA * (1 - srcA)) / outA)
    pixels[index + 3] = Math.round(outA * 255)
  }

  const rounded = (x, y, left, top, width, height, radius) => {
    if (x < left || y < top || x >= left + width || y >= top + height) return false
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius))
    const dy = Math.max(top + radius - y, 0, y - (top + height - radius))
    return dx * dx + dy * dy <= radius * radius
  }

  const bgLeft = 20 * scale
  const bgTop = 20 * scale
  const bgSize = 472 * scale
  const radius = 108 * scale
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!rounded(x, y, bgLeft, bgTop, bgSize, bgSize, radius)) continue
      const u = x / size
      const v = y / size
      const radial = Math.max(0, 1 - Math.hypot(u - 0.42, v - 0.32) * 1.15)
      const r = Math.round(6 + radial * 5 + v * 3)
      const g = Math.round(12 + radial * 12 + (1 - v) * 6)
      const b = Math.round(18 + radial * 20 + v * 5)
      set(x, y, r, g, b, 255)
    }
  }

  // Soft aqua glow behind the block.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!rounded(x, y, bgLeft, bgTop, bgSize, bgSize, radius)) continue
      const d = Math.hypot(x / size - 0.5, y / size - 0.46)
      if (d < 0.4) {
        const alpha = Math.round((1 - d / 0.4) ** 2 * 26)
        set(x, y, 92, 200, 232, alpha)
      }
    }
  }

  // Border.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!rounded(x, y, bgLeft, bgTop, bgSize, bgSize, radius)) continue
      const edge =
        !rounded(x - 2 * scale, y, bgLeft, bgTop, bgSize, bgSize, radius) ||
        !rounded(x + 2 * scale, y, bgLeft, bgTop, bgSize, bgSize, radius) ||
        !rounded(x, y - 2 * scale, bgLeft, bgTop, bgSize, bgSize, radius) ||
        !rounded(x, y + 2 * scale, bgLeft, bgTop, bgSize, bgSize, radius)
      if (edge) set(x, y, 52, 84, 104, 150)
    }
  }

  const top = polygonPoints([
    [256, 118],
    [404, 205],
    [256, 292],
    [108, 205],
  ])
  const left = polygonPoints([
    [108, 205],
    [256, 292],
    [256, 442],
    [108, 355],
  ])
  const right = polygonPoints([
    [404, 205],
    [256, 292],
    [256, 442],
    [404, 355],
  ])

  const cell = Math.max(4, Math.round(12 * scale))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!rounded(x, y, bgLeft, bgTop, bgSize, bgSize, radius)) continue
      const gx = Math.floor(x / cell)
      const gy = Math.floor(y / cell)
      const noise = hash(gx, gy)
      if (insidePolygon(x, y, top)) {
        const bright = 0.8 + (1 - (y / size - 0.23) * 1.6) * 0.25 + noise * 0.12
        const r = Math.round(92 * bright)
        const g = Math.round(200 * bright)
        const b = Math.round(232 * bright)
        set(x, y, Math.min(235, r), Math.min(255, g), Math.min(255, b))
      } else if (insidePolygon(x, y, left)) {
        const greenBand = y < 328 * scale
        if (greenBand) {
          set(x, y, 74 + Math.round(noise * 16), 158 + Math.round(noise * 26), 190 + Math.round(noise * 20))
        } else {
          const shade = 0.86 + noise * 0.2
          set(x, y, Math.round(62 * shade), Math.round(82 * shade), Math.round(97 * shade))
        }
      } else if (insidePolygon(x, y, right)) {
        const greenBand = y < 328 * scale
        if (greenBand) {
          set(x, y, 52 + Math.round(noise * 12), 124 + Math.round(noise * 20), 154 + Math.round(noise * 18))
        } else {
          const shade = 0.72 + noise * 0.18
          set(x, y, Math.round(48 * shade), Math.round(64 * shade), Math.round(78 * shade))
        }
      }
    }
  }

  // Highlight edge on the block top and a few pixel sparkles.
  for (let i = 0; i < 6; i += 1) {
    const x = Math.round((196 + i * 23) * scale)
    const y = Math.round((184 + (i % 2) * 10) * scale)
    set(x, y, 186, 240, 255, 110)
    set(x + Math.round(6 * scale), y + Math.round(6 * scale), 214, 248, 255, 70)
  }
  const edgeStep = Math.max(1, Math.round(2 * scale))
  for (let y = Math.round(203 * scale); y < Math.round(216 * scale); y += edgeStep) {
    for (let x = Math.round(114 * scale); x < Math.round(400 * scale); x += 1) {
      if (insidePolygon(x, y, left) || insidePolygon(x, y, right)) set(x, y, 148, 220, 245, 90)
    }
  }

  return pixels
}

function icoFromPng(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([header, entry, png])
}

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true })
const png512 = encodePng(512, 512, drawIcon(512))
const png256 = encodePng(256, 256, drawIcon(256))
fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png512)
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), icoFromPng(png256, 256))
fs.writeFileSync(path.join(ROOT, 'public', 'favicon.png'), png256)
fs.writeFileSync(path.join(ROOT, 'build', 'icon-256.png'), png256)

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="15" fill="#080e13"/>
<path d="M32 14 52 25 32 36 12 25Z" fill="#5cc8e8"/>
<path d="M12 25 32 36 32 52 12 41Z" fill="#4a7f9e"/>
<path d="M12 29 32 40 32 46 12 35Z" fill="#3b5462"/>
<path d="M52 25 32 36 32 52 52 41Z" fill="#35617a"/>
<path d="M52 29 32 40 32 46 52 35Z" fill="#2e414d"/>
</svg>`
fs.writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), favicon)
console.log('Generated build/icon.png, build/icon.ico, build/icon-256.png and favicon assets.')
