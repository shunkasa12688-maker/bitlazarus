import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { makeOrigin } from '../src/seed.mjs'

const IH = 'a'.repeat(40)
async function start(dataDir, clearedSet) {
  const server = http.createServer(makeOrigin(dataDir, clearedSet))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

test('origin: serves only cleared infohashes, 404 for non-cleared', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-o-'))
  fs.mkdirSync(path.join(d, IH), { recursive: true }); fs.writeFileSync(path.join(d, IH, 'f.txt'), 'hello')
  const other = 'b'.repeat(40)
  fs.mkdirSync(path.join(d, other), { recursive: true }); fs.writeFileSync(path.join(d, other, 'f.txt'), 'secret')
  const { server, base } = await start(d, new Set([IH]))
  try {
    assert.equal((await fetch(`${base}/${IH}/f.txt`)).status, 200)
    assert.equal((await fetch(`${base}/${other}/f.txt`)).status, 404) // non-cleared is not served
    assert.equal((await fetch(`${base}/`)).status, 404)
  } finally { server.close() }
})

test('origin: path traversal returns 404', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-o2-'))
  fs.mkdirSync(path.join(d, IH), { recursive: true }); fs.writeFileSync(path.join(d, IH, 'f.txt'), 'x')
  fs.writeFileSync(path.join(d, 'sibling.txt'), 'SECRET')
  const { server, base } = await start(d, new Set([IH]))
  try {
    assert.equal((await fetch(`${base}/${IH}/..%2f..%2fsibling.txt`)).status, 404)
    assert.equal((await fetch(`${base}/${IH}/%2e%2e/sibling.txt`)).status, 404)
  } finally { server.close() }
})

test('origin: bad encoding => 400, weird Range => 416, suffix Range => 206', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-o3-'))
  fs.mkdirSync(path.join(d, IH), { recursive: true }); fs.writeFileSync(path.join(d, IH, 'f.txt'), '0123456789')
  const { server, base } = await start(d, new Set([IH]))
  try {
    assert.equal((await fetch(`${base}/%zz`)).status, 400)
    assert.equal((await fetch(`${base}/${IH}/f.txt`, { headers: { Range: 'bytes=999-100' } })).status, 416)
    const s = await fetch(`${base}/${IH}/f.txt`, { headers: { Range: 'bytes=-3' } })
    assert.equal(s.status, 206)
    assert.equal(await s.text(), '789')
  } finally { server.close() }
})
