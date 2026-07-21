import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingest, verify, infohashOf, sha256File } from '../src/core.mjs'

// stamp: false でネットワーク(OpenTimestamps)に触らず、決定的に速く回す。
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blz-'))
const opts = (d) => ({ webseedBase: 'http://o', catalogDir: path.join(d, 'cat'), dataDir: path.join(d, 'data'), stamp: false })

test('ingest は内容アドレス化したマニフェストを作る', async () => {
  const d = tmp()
  const f = path.join(d, 'rec.txt'); fs.writeFileSync(f, 'evidence 1998')
  const m = await ingest(f, opts(d))
  assert.equal(m.sha256, sha256File(f))
  assert.match(m.infoHash, /^[0-9a-f]{40}$/)
  assert.ok(fs.existsSync(path.join(d, 'cat', m.infoHash + '.json')))
  assert.ok(m.magnet.includes(m.infoHash))
  assert.ok(m.webseeds[0].endsWith('rec.txt'))
})

test('infohash は 中身と名前から決定的', async () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'a.txt'), 'same bytes')
  fs.writeFileSync(path.join(d, 'b.txt'), 'same bytes')
  assert.equal(await infohashOf(path.join(d, 'a.txt'), 'x.txt'), await infohashOf(path.join(d, 'b.txt'), 'x.txt'))
})

test('別の中身は別の infohash', async () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'a.txt'), 'aaa')
  fs.writeFileSync(path.join(d, 'b.txt'), 'bbb')
  assert.notEqual(await infohashOf(path.join(d, 'a.txt'), 'x.txt'), await infohashOf(path.join(d, 'b.txt'), 'x.txt'))
})

test('verify は原本で全PASS、改ざんでFAIL', async () => {
  const d = tmp()
  const f = path.join(d, 'rec.txt'); fs.writeFileSync(f, 'original body')
  const m = await ingest(f, opts(d))
  const mpath = path.join(d, 'cat', m.infoHash + '.json')
  const ok = await verify(mpath, path.join(d, 'data', m.infoHash, 'rec.txt'))
  assert.ok(ok.integrity.every(([, p]) => p), '原本は全PASSのはず')
  const t = path.join(d, 'tam.txt'); fs.writeFileSync(t, 'tampered body')
  const bad = await verify(mpath, t)
  assert.ok(bad.integrity.some(([, p]) => !p), '改ざんはFAILを含むはず')
})

test('ingest は存在しないファイルを弾く', async () => {
  await assert.rejects(() => ingest('/no/such/file.bin', opts(tmp())))
})

test('sha256File はストリーミングで大きめの入力も扱える', () => {
  const d = tmp()
  const f = path.join(d, 'big.bin'); fs.writeFileSync(f, Buffer.alloc(3 * 1024 * 1024, 7))
  assert.match(sha256File(f), /^[0-9a-f]{64}$/)
})
