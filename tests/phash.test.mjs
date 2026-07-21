import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dHash, hamming, popcount64, hashToHex, hexToHash, decodeImage, decodeNetpbm, isProbablyImage } from '../src/phash.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-ph-'))

// Write a binary grayscale (P5) PGM whose pixel(x,y) = fn(x,y).
function writeP5(file, w, h, fn) {
  const data = Buffer.alloc(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y)
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, 'latin1'), data]))
}
const img = (file) => { const i = decodeImage(file); return [i.gray, i.width, i.height] }

test('hamming / popcount / hex round-trip', () => {
  assert.equal(popcount64(0n), 0)
  assert.equal(popcount64(0xffffffffffffffffn), 64)
  assert.equal(hamming(0n, 0xfn), 4)
  const x = 0x0123456789abcdefn
  assert.equal(hexToHash(hashToHex(x)), x)
  assert.equal(hexToHash('nothexnothexno!!'), null)
  assert.equal(hexToHash('abc'), null) // wrong length
})

test('dHash: identical images distance 0, opposite gradients distance 64, scale-invariant', () => {
  const d = tmp()
  const dec = path.join(d, 'dec.pgm'); writeP5(dec, 32, 32, (x) => 255 - Math.round(255 * x / 31))
  const inc = path.join(d, 'inc.pgm'); writeP5(inc, 32, 32, (x) => Math.round(255 * x / 31))
  const dec2 = path.join(d, 'dec2.pgm'); writeP5(dec2, 40, 24, (x) => 255 - Math.round(255 * x / 39)) // same pattern, other size
  const hDec = dHash(...img(dec)), hInc = dHash(...img(inc)), hDec2 = dHash(...img(dec2))
  assert.equal(hamming(hDec, hDec), 0)
  assert.equal(hamming(hDec, hInc), 64)
  assert.ok(hamming(hDec, hDec2) <= 2, 'same pattern at a different size stays close')
})

test('decodeNetpbm handles P2/P3/P5/P6, comments and maxval scaling; rejects the rest', () => {
  const p2 = decodeNetpbm(Buffer.from('P2\n2 1\n255\n0 255\n', 'latin1'))
  assert.equal(p2.width, 2); assert.equal(p2.height, 1)
  assert.equal(p2.gray[0], 0); assert.equal(p2.gray[1], 255)
  const p3 = decodeNetpbm(Buffer.from('P3\n1 1\n255\n255 0 0\n', 'latin1')) // pure red -> luma 76
  assert.equal(p3.gray[0], 76)
  const p6 = decodeNetpbm(Buffer.concat([Buffer.from('P6\n1 1\n255\n', 'latin1'), Buffer.from([0, 255, 0])])) // pure green -> 150
  assert.equal(p6.gray[0], 150)
  const p2c = decodeNetpbm(Buffer.from('P2\n# a comment\n1 1\n15\n15\n', 'latin1')) // maxval 15 -> scale to 255
  assert.equal(p2c.gray[0], 255)
  assert.throws(() => decodeNetpbm(Buffer.from('not an image', 'latin1')))
  assert.throws(() => decodeNetpbm(Buffer.from('P5\n1 1\n300\n', 'latin1'))) // maxval > 255 unsupported
})

test('isProbablyImage sniffs the magic without reading the whole file', () => {
  const d = tmp()
  const f = path.join(d, 'x.pgm'); writeP5(f, 4, 4, () => 10)
  assert.equal(isProbablyImage(f), true)
  const g = path.join(d, 'y.bin'); fs.writeFileSync(g, 'plain text data')
  assert.equal(isProbablyImage(g), false)
})
