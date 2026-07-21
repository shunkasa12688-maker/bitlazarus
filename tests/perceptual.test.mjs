import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest } from '../src/core.mjs'
import { loadPhashBlocklist, screenPerceptual } from '../src/intake.mjs'
import { decodeImage, dHash, hashToHex } from '../src/phash.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-per-'))
function writeP5(file, w, h, fn) {
  const data = Buffer.alloc(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y)
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, 'latin1'), data]))
}
const phashOf = (file) => { const i = decodeImage(file); return hashToHex(dHash(i.gray, i.width, i.height)) }
const optsFor = (d, extra = {}) => ({ webseedBase: 'http://o', catalogDir: path.join(d, 'cat'), dataDir: path.join(d, 'data'), stamp: false, ...extra })

test('loadPhashBlocklist is fail-closed on an empty or invalid list', () => {
  const d = tmp()
  const empty = path.join(d, 'empty.txt'); fs.writeFileSync(empty, '# only comments\n\nnothex\n')
  assert.equal(loadPhashBlocklist(empty), null)
  assert.equal(loadPhashBlocklist(null), null)
  const good = path.join(d, 'good.txt'); fs.writeFileSync(good, 'ffffffffffffffff\n')
  assert.equal(loadPhashBlocklist(good).length, 1)
})

test('screenPerceptual: matches a known image, ignores a different one and non-images', () => {
  const d = tmp()
  const dec = path.join(d, 'dec.pgm'); writeP5(dec, 32, 32, (x) => 255 - Math.round(255 * x / 31))
  const inc = path.join(d, 'inc.pgm'); writeP5(inc, 32, 32, (x) => Math.round(255 * x / 31))
  const txt = path.join(d, 'note.txt'); fs.writeFileSync(txt, 'just text, not an image')
  const blFile = path.join(d, 'bl.txt'); fs.writeFileSync(blFile, phashOf(dec) + '\n')
  const bl = loadPhashBlocklist(blFile)

  assert.equal(screenPerceptual(dec, bl, 10).matched, true)   // same image => distance 0
  const far = screenPerceptual(inc, bl, 10)
  assert.equal(far.ran, true); assert.equal(far.matched, false); assert.equal(far.distance, 64)
  const nonimg = screenPerceptual(txt, bl, 10)
  assert.equal(nonimg.ran, false); assert.equal(nonimg.matched, false) // reject-only: no opinion on non-images
  assert.equal(screenPerceptual(dec, null, 10).ran, false)    // no blocklist => gate does not run
})

test('ingest: perceptual gate rejects a near-duplicate but clears a different image', async () => {
  const d = tmp()
  const dec = path.join(d, 'dec.pgm'); writeP5(dec, 32, 32, (x) => 255 - Math.round(255 * x / 31))
  const inc = path.join(d, 'inc.pgm'); writeP5(inc, 40, 20, (x) => Math.round(255 * x / 39))
  const blFile = path.join(d, 'bl.txt'); fs.writeFileSync(blFile, phashOf(dec) + '\n')
  const phashBlocklist = loadPhashBlocklist(blFile)
  const sha = new Set(['0'.repeat(64)]) // exact gate clears everything (no sha256 match)

  await assert.rejects(
    () => ingest(dec, optsFor(d, { blocklist: sha, phashBlocklist, phashThreshold: 10 })),
    /perceptual-hash match/)

  const m = await ingest(inc, optsFor(path.join(d, 'ok'), { blocklist: sha, phashBlocklist, phashThreshold: 10 }))
  assert.equal(m.intake.status, 'cleared')
  assert.equal(m.intake.perceptual.matched, false)
  assert.equal(m.intake.perceptual.distance, 64)
})
