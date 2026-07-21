// Perceptual image hashing for the intake gate — a difference hash (dHash).
//
// This is NOT a classifier and NOT a model. It is a fuzzy fingerprint: it matches an image
// against a list of KNOWN-bad perceptual hashes within a Hamming-distance threshold. This is
// the same shape as the industry providers (PhotoDNA, Thorn). In production you replace the
// reference decoder below with a licensed decoder + provider (see intake.mjs); the matching
// interface stays the same. We ship neither proprietary hashes nor any generative/predictive
// model, and we never store real CSAM hashes in this repo.
import fs from 'node:fs'

// --- dHash over an 8-bit grayscale matrix ------------------------------------------
// Downscale to (W+1) x H by area-average, then compare horizontally-adjacent cells.
// 8x8 comparisons over a 9x8 grid = 64 bits, returned as a BigInt.
const DHASH_W = 8, DHASH_H = 8
const MAX_PIXELS = 100_000_000 // sanity cap: reject absurd dimensions before allocating

function isWs(b) { return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d }
function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v }

// Area-average downscale of an 8-bit grayscale image to cols x rows.
function downscaleGray(gray, w, h, cols, rows) {
  const out = new Float64Array(cols * rows)
  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.floor(ry * h / rows), y1 = Math.max(y0 + 1, Math.floor((ry + 1) * h / rows))
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor(rx * w / cols), x1 = Math.max(x0 + 1, Math.floor((rx + 1) * w / cols))
      let sum = 0, n = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += gray[y * w + x]; n++ }
      out[ry * cols + rx] = n ? sum / n : 0
    }
  }
  return out
}

// dHash: 64-bit BigInt. Bit i is set when a cell is brighter than its right neighbor.
export function dHash(gray, w, h) {
  if (!(w > 0) || !(h > 0) || gray.length < w * h) throw new Error('invalid grayscale input')
  const small = downscaleGray(gray, w, h, DHASH_W + 1, DHASH_H)
  let bits = 0n, i = 0n
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W; x++) {
      const left = small[y * (DHASH_W + 1) + x], right = small[y * (DHASH_W + 1) + x + 1]
      if (left > right) bits |= (1n << i)
      i++
    }
  }
  return bits
}

// Hamming distance between two 64-bit perceptual hashes (BigInt).
export function popcount64(x) { let c = 0; while (x) { x &= x - 1n; c++ } return c }
export function hamming(a, b) { return popcount64(a ^ b) }

// 16-hex-char string <-> 64-bit BigInt.
export function hashToHex(x) { return (x & ((1n << 64n) - 1n)).toString(16).padStart(16, '0') }
export function hexToHash(hex) {
  const h = String(hex).trim().toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(h)) return null
  return BigInt('0x' + h)
}

// --- Reference image decoder: Netpbm (PGM/PPM) -------------------------------------
// Dependency-free, enough to demonstrate and test the perceptual gate. Production swaps in a
// real decoder (sharp/jimp/libvips) feeding the SAME dHash interface. Returns 8-bit grayscale.

// Cheap magic sniff (2 bytes) so we never read a large non-image file into memory.
export function isProbablyImage(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const b = Buffer.alloc(2)
    if (fs.readSync(fd, b, 0, 2, 0) < 2) return false
    return b[0] === 0x50 /* 'P' */ && b[1] >= 0x31 /* '1' */ && b[1] <= 0x36 /* '6' */
  } finally { fs.closeSync(fd) }
}

export function decodeImage(filePath) {
  if (!isProbablyImage(filePath)) throw new Error('unsupported image format (not Netpbm)')
  return decodeNetpbm(fs.readFileSync(filePath))
}

export function decodeNetpbm(buf) {
  if (buf.length < 2 || buf[0] !== 0x50) throw new Error('unsupported image format (not Netpbm)')
  const magic = String.fromCharCode(buf[1])
  const type = { '2': 'gray-ascii', '3': 'rgb-ascii', '5': 'gray-bin', '6': 'rgb-bin' }[magic]
  if (!type) throw new Error('unsupported Netpbm type P' + magic)
  const ascii = type.endsWith('ascii')
  const rgb = type.startsWith('rgb')

  // Parse header tokens (width, height, maxval), skipping whitespace and # comments.
  let pos = 2
  const nextToken = () => {
    while (pos < buf.length) {
      while (pos < buf.length && isWs(buf[pos])) pos++
      if (pos < buf.length && buf[pos] === 0x23 /* # */) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; continue }
      break
    }
    const s = pos
    while (pos < buf.length && !isWs(buf[pos])) pos++
    return buf.toString('latin1', s, pos)
  }
  const width = parseInt(nextToken(), 10)
  const height = parseInt(nextToken(), 10)
  const maxval = parseInt(nextToken(), 10)
  if (!(width > 0 && height > 0 && maxval > 0)) throw new Error('invalid Netpbm header')
  if (maxval > 255) throw new Error('unsupported Netpbm maxval > 255')
  if (width * height > MAX_PIXELS) throw new Error('image too large')
  const count = width * height
  const gray = new Uint8Array(count)
  const scale = 255 / maxval

  if (ascii) {
    for (let i = 0; i < count; i++) {
      if (rgb) {
        const r = parseInt(nextToken(), 10), g = parseInt(nextToken(), 10), b = parseInt(nextToken(), 10)
        gray[i] = clamp8((0.299 * r + 0.587 * g + 0.114 * b) * scale)
      } else {
        gray[i] = clamp8(parseInt(nextToken(), 10) * scale)
      }
    }
  } else {
    pos++ // exactly one whitespace byte separates the header from binary raster data
    const chans = rgb ? 3 : 1
    if (buf.length - pos < count * chans) throw new Error('truncated Netpbm data')
    for (let i = 0; i < count; i++) {
      if (rgb) {
        const r = buf[pos + i * 3], g = buf[pos + i * 3 + 1], b = buf[pos + i * 3 + 2]
        gray[i] = clamp8((0.299 * r + 0.587 * g + 0.114 * b) * scale)
      } else {
        gray[i] = clamp8(buf[pos + i] * scale)
      }
    }
  }
  return { width, height, gray }
}
