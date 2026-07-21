import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest } from '../src/core.mjs'
import { buildIndex, writeIndex, loadIndex } from '../src/catalog.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-cat-'))

test('buildIndex includes only cleared items', async () => {
  const d = tmp()
  const cat = path.join(d, 'cat'), data = path.join(d, 'data')
  const a = path.join(d, 'a.txt'); fs.writeFileSync(a, 'cleared one')
  const b = path.join(d, 'b.txt'); fs.writeFileSync(b, 'unverified one')
  await ingest(a, { webseedBase: 'http://o', catalogDir: cat, dataDir: data, stamp: false, blocklist: new Set(['0'.repeat(64)]) }) // cleared
  await ingest(b, { webseedBase: 'http://o', catalogDir: cat, dataDir: data, stamp: false }) // UNVERIFIED
  const idx = buildIndex(cat)
  assert.equal(idx.count, 1)
  assert.equal(idx.entries[0].name, 'a.txt')
  assert.ok(idx.entries[0].infoHash)
})

test('writeIndex and loadIndex round-trip', async () => {
  const d = tmp()
  const cat = path.join(d, 'cat'), data = path.join(d, 'data')
  const a = path.join(d, 'a.txt'); fs.writeFileSync(a, 'x')
  await ingest(a, { webseedBase: 'http://o', catalogDir: cat, dataDir: data, stamp: false, blocklist: new Set(['0'.repeat(64)]) })
  writeIndex(cat)
  const idx = await loadIndex(path.join(cat, 'index.json'))
  assert.equal(idx.count, 1)
})
