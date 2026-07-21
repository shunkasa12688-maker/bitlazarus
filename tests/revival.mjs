// 多ノード蘇生の実証。単一ノードを止めても他ノードから完走する。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import WebTorrent from 'webtorrent'
import { ingest } from '../src/core.mjs'
import { makeOrigin } from '../src/seed.mjs'

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
function serve(dataDir, clearedSet, port) {
  const server = http.createServer(makeOrigin(dataDir, clearedSet))
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)))
}
function webseedOnly(torrentBuf, outDir, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const client = new WebTorrent({ dht: false, lsd: false, tracker: false, utp: false })
    const t = client.add(torrentBuf, { path: outDir, announce: [] })
    const to = setTimeout(() => client.destroy(() => resolve({ done: false })), timeoutMs)
    t.on('done', () => { clearTimeout(to); const fp = path.join(outDir, t.files[0].name); const h = sha(fp); client.destroy(() => resolve({ done: true, sha: h })) })
  })
}

async function main() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-rev-'))
  const f = path.join(d, 'rare_1998.bin'); fs.writeFileSync(f, crypto.randomBytes(2 * 1024 * 1024))
  const originSha = sha(f)
  const PA = 6971, PB = 6972
  const m = await ingest(f, { webseedBases: [`http://127.0.0.1:${PA}`, `http://127.0.0.1:${PB}`], catalogDir: path.join(d, 'cat'), dataDir: path.join(d, 'data'), stamp: false, blocklist: new Set(['0'.repeat(64)]) })
  const cleared = new Set([m.infoHash])
  const torrentBuf = fs.readFileSync(path.join(d, 'cat', m.infoHash + '.torrent'))
  console.log(`infohash=${m.infoHash} intake=${m.intake.status} ミラー数=${m.webseeds.length}`)

  let A = await serve(path.join(d, 'data'), cleared, PA)
  const B = await serve(path.join(d, 'data'), cleared, PB)

  const r1 = await webseedOnly(torrentBuf, path.join(d, 'out1'))
  const p1 = r1.done && r1.sha === originSha
  console.log(`1) 両オリジン稼働・peerゼロ        : ${p1 ? 'PASS 完走・ハッシュ一致' : 'FAIL'}`)

  await new Promise(r => A.close(r))
  const r2 = await webseedOnly(torrentBuf, path.join(d, 'out2'))
  const p2 = r2.done && r2.sha === originSha
  console.log(`2) オリジンA停止・Bのみ            : ${p2 ? 'PASS 別ノードから完走' : 'FAIL'}`)

  await new Promise(r => B.close(r))
  const r3 = await webseedOnly(torrentBuf, path.join(d, 'out3'), 8000)
  const p3 = !r3.done
  console.log(`3) 両方停止（保持者ゼロ）          : ${p3 ? 'PASS 完走せず（正直な限界）' : 'FAIL'}`)

  const ok = p1 && p2 && p3
  console.log(`\n総合: ${ok ? 'PASS 単一ノードの喪失を生き延びる' : 'FAIL'}`)
  process.exit(ok ? 0 : 1)
}
main()
