import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestDir, sha256File } from '../src/core.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-batch-'))
const optsFor = (d, extra = {}) => ({ webseedBase: 'http://o', catalogDir: path.join(d, 'cat'), dataDir: path.join(d, 'data'), stamp: false, ...extra })

test('ingestDir: batches every file, each as its own content-addressed item', async () => {
  const d = tmp()
  const src = path.join(d, 'src'); fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'a.txt'), 'alpha')
  fs.writeFileSync(path.join(src, 'b.txt'), 'bravo')
  fs.writeFileSync(path.join(src, 'c.txt'), 'charlie')
  const r = await ingestDir(src, optsFor(d))
  assert.equal(r.scanned, 3)
  assert.equal(r.items.length, 3)
  assert.equal(r.rejected.length, 0)
  assert.equal(new Set(r.items.map(m => m.infoHash)).size, 3) // distinct items
})

test('ingestDir: a blocked file is rejected without aborting the batch', async () => {
  const d = tmp()
  const src = path.join(d, 'src'); fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'good.txt'), 'keep me')
  const bad = path.join(src, 'bad.txt'); fs.writeFileSync(bad, 'block me')
  const bl = new Set([sha256File(bad)])
  const r = await ingestDir(src, optsFor(d, { blocklist: bl }))
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].name, 'good.txt')
  assert.equal(r.rejected.length, 1)
  assert.match(r.rejected[0].reason, /intake rejected/)
})

test('ingestDir: non-recursive skips subdirs, recursive descends', async () => {
  const d = tmp()
  const src = path.join(d, 'src'); fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'top.txt'), 'top')
  const sub = path.join(src, 'sub'); fs.mkdirSync(sub)
  fs.writeFileSync(path.join(sub, 'deep.txt'), 'deep')
  const flat = await ingestDir(src, optsFor(path.join(d, 'a')))
  assert.equal(flat.scanned, 1)
  const deep = await ingestDir(src, optsFor(path.join(d, 'b'), { recursive: true }))
  assert.equal(deep.scanned, 2)
})

test('ingestDir: does not follow symlinks', async () => {
  const d = tmp()
  const src = path.join(d, 'src'); fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'real.txt'), 'real')
  const outside = path.join(d, 'outside.txt'); fs.writeFileSync(outside, 'must not be ingested via a link')
  try { fs.symlinkSync(outside, path.join(src, 'link.txt')) } catch { /* Windows without symlink privilege: nothing to link */ }
  const r = await ingestDir(src, optsFor(d, { recursive: true }))
  assert.equal(r.scanned, 1, 'only the real file is ingested; a symlink is skipped')
})
