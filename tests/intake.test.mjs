import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest, sha256File } from '../src/core.mjs'
import { screen, isCleared } from '../src/intake.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-i-'))

test('screen: 一致で cleared=false、未一致で cleared=true', () => {
  const bl = new Set(['a'.repeat(64)])
  assert.equal(screen('A'.repeat(64), bl).matched, true) // 大文字小文字を無視
  assert.equal(screen('b'.repeat(64), bl).cleared, true)
})

test('screen: ブロックリスト未設定は UNVERIFIED', () => {
  const r = screen('a'.repeat(64), null)
  assert.equal(r.cleared, false)
  assert.equal(r.matched, false)
})

test('isCleared: cleared のみ true（fail-closed）', () => {
  assert.equal(isCleared({ intake: { status: 'cleared' } }), true)
  assert.equal(isCleared({ intake: { status: 'UNVERIFIED' } }), false)
  assert.equal(isCleared({ intake: '古い文字列' }), false)
  assert.equal(isCleared({}), false)
})

test('ingest: 禁止ハッシュに一致したら取り込み拒否', async () => {
  const d = tmp()
  const f = path.join(d, 'bad.bin'); fs.writeFileSync(f, 'banned content')
  const bl = new Set([sha256File(f)])
  await assert.rejects(() => ingest(f, { webseedBase: 'http://o', catalogDir: path.join(d, 'c'), dataDir: path.join(d, 'dt'), stamp: false, blocklist: bl }))
})

test('ingest: 未一致は cleared、ブロックリスト無しは UNVERIFIED', async () => {
  const d = tmp()
  const f = path.join(d, 'ok.bin'); fs.writeFileSync(f, 'fine content')
  const m1 = await ingest(f, { webseedBase: 'http://o', catalogDir: path.join(d, 'c1'), dataDir: path.join(d, 'd1'), stamp: false, blocklist: new Set(['0'.repeat(64)]) })
  assert.equal(m1.intake.status, 'cleared')
  const m2 = await ingest(f, { webseedBase: 'http://o', catalogDir: path.join(d, 'c2'), dataDir: path.join(d, 'd2'), stamp: false })
  assert.equal(m2.intake.status, 'UNVERIFIED')
})
