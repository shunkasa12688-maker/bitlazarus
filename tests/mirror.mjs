// Demonstration of mirroring. Even if the operator disappears, an independent mirror keeps the record alive.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import WebTorrent from 'webtorrent'
import { ingest } from '../src/core.mjs'
import { mirror } from '../src/mirror.mjs'
import { makeOrigin, buildClearedSet } from '../src/seed.mjs'

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
function serve(dataDir, clearedSet, port) {
  const server = http.createServer(makeOrigin(dataDir, clearedSet))
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)))
}
function download(torrentBuf, outDir, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const client = new WebTorrent({ dht: false, lsd: false, tracker: false })
    const t = client.add(torrentBuf, { path: outDir, announce: [] })
    const to = setTimeout(() => client.destroy(() => resolve({ done: false })), timeoutMs)
    t.on('done', () => { clearTimeout(to); const fp = path.join(outDir, t.files[0].name); const h = sha(fp); client.destroy(() => resolve({ done: true, sha: h })) })
  })
}

async function main() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-mir-'))
  const f = path.join(d, 'evidence.bin'); fs.writeFileSync(f, crypto.randomBytes(2 * 1024 * 1024))
  const originSha = sha(f)
  const PA = 6981, PB = 6982
  const bl = new Set(['0'.repeat(64)])

  // 1) Operator: ingest and serve at origin A
  const m = await ingest(f, { webseedBase: `http://127.0.0.1:${PA}`, catalogDir: path.join(d, 'opcat'), dataDir: path.join(d, 'opdata'), stamp: false, blocklist: bl })
  let A = await serve(path.join(d, 'opdata'), new Set([m.infoHash]), PA)
  console.log(`Operator origin A running infohash=${m.infoHash} intake=${m.intake.status}`)

  // 2) Volunteer: fetch in isolation, self-verify, self-rescreen. Add origin B
  const r = await mirror({ srcCatalogDir: path.join(d, 'opcat'), originBase: `http://127.0.0.1:${PB}`, dataDir: path.join(d, 'mirdata'), catalogDir: path.join(d, 'mircat'), blocklist: bl, allowLocalWebseed: true })
  const mirredSha = sha(path.join(d, 'mirdata', m.infoHash, 'evidence.bin'))
  const p2 = r.mirrored === 1 && mirredSha === originSha
  console.log(`2) Mirror fetch + self-verify + self-screen : ${p2 ? 'PASS match, cleared' : 'FAIL'}`)

  // 3) Stop the operator (A) = seizure
  await new Promise(x => A.close(x))
  // 4) Only the mirror (B) is up. Download using the mirror's .torrent (which includes B)
  const B = await serve(path.join(d, 'mirdata'), buildClearedSet(path.join(d, 'mircat')), PB)
  const mirTorrent = fs.readFileSync(path.join(d, 'mircat', m.infoHash + '.torrent'))
  const dl = await download(mirTorrent, path.join(d, 'out'))
  const p4 = dl.done && dl.sha === originSha
  console.log(`4) Operator gone, completed from mirror B   : ${p4 ? 'PASS another operator kept the record alive' : 'FAIL'}`)
  await new Promise(x => B.close(x))

  const ok = p2 && p4
  console.log(`\nOverall: ${ok ? 'PASS an independent mirror survives the loss of a single operator' : 'FAIL'}`)
  process.exit(ok ? 0 : 1)
}
main()
