import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest } from '../src/core.mjs'
import { upgradeCatalog } from '../src/upgrade.mjs'

// ネットワークに触らない。.ots が無い（--no-timestamp）カタログでの挙動を固定する。
test('upgradeCatalog: .ots が無ければ何もしない', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-up-'))
  const f = path.join(d, 'a.txt'); fs.writeFileSync(f, 'x')
  await ingest(f, { webseedBase: 'http://o', catalogDir: path.join(d, 'cat'), dataDir: path.join(d, 'data'), stamp: false, blocklist: new Set(['0'.repeat(64)]) })
  const r = await upgradeCatalog(path.join(d, 'cat'))
  assert.equal(r.confirmed, 0)
  assert.equal(r.pending, 0)
  assert.equal(r.results.length, 0)
})

test('upgradeCatalog: 存在しないカタログでも落ちない', async () => {
  const r = await upgradeCatalog(path.join(os.tmpdir(), 'blz-nope-' + process.pid))
  assert.equal(r.results.length, 0)
})
