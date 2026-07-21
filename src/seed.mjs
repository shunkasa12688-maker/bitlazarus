// アンカーノード。審査を通った(cleared)項目だけを配信する。
// WebSeed の HTTP origin は cleared の infohash のバイトだけを配る（fail-closed をここでも守る）。
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import WebTorrent from 'webtorrent'
import { isCleared } from './intake.mjs'

// マニフェストを安全に読む。壊れた1件でバッチ全体を止めない。
function readManifests(catalogDir) {
  const out = []
  const files = fs.existsSync(catalogDir) ? fs.readdirSync(catalogDir).filter(f => f.endsWith('.json') && f !== 'index.json') : []
  for (const f of files) {
    try { out.push({ file: f, m: JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) }) }
    catch { console.log('skip (壊れたマニフェスト):', f) }
  }
  return out
}

// cleared の infohash 集合。origin はこの集合にあるものだけ配る。
export function buildClearedSet(catalogDir) {
  const set = new Set()
  for (const { m } of readManifests(catalogDir)) if (isCleared(m)) set.add(m.infoHash.toLowerCase())
  return set
}

// 内容アドレスで安全に配る origin。パス /<infohash>/<name> だけ、cleared のものだけ。
export function makeOrigin(dataDir, clearedSet) {
  const root = path.resolve(dataDir)
  return (req, res) => {
    let decoded
    try { decoded = decodeURIComponent((req.url || '').split('?')[0]) }
    catch { res.statusCode = 400; return res.end('bad request') }
    const parts = decoded.replace(/^\/+/, '').split('/')
    const ih = (parts.shift() || '').toLowerCase()
    const name = parts.join('/')
    if (!/^[0-9a-f]{40}$/.test(ih) || !clearedSet.has(ih)) { res.statusCode = 404; return res.end('not found') }
    if (!name || name.includes('..') || path.isAbsolute(name)) { res.statusCode = 404; return res.end('not found') }
    const itemRoot = path.join(root, ih)
    const fp = path.resolve(itemRoot, name)
    if (fp !== itemRoot && !fp.startsWith(itemRoot + path.sep)) { res.statusCode = 404; return res.end('not found') }
    let st
    try { st = fs.statSync(fp) } catch { res.statusCode = 404; return res.end('not found') }
    if (!st.isFile()) { res.statusCode = 404; return res.end('not found') }

    const size = st.size
    const hdr = { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
    let start = 0, end = size - 1
    const range = req.headers.range
    if (range) {
      const g = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!g || (g[1] === '' && g[2] === '')) { res.writeHead(416, { ...hdr, 'Content-Range': `bytes */${size}` }); return res.end() }
      if (g[1] === '') { start = Math.max(0, size - Number(g[2])); end = size - 1 } // suffix range
      else { start = Number(g[1]); end = g[2] === '' ? size - 1 : Number(g[2]) }
      end = Math.min(end, size - 1)
      if (size === 0 || start > end || start >= size) { res.writeHead(416, { ...hdr, 'Content-Range': `bytes */${size}` }); return res.end() }
      res.writeHead(206, { ...hdr, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    } else {
      res.writeHead(200, { ...hdr, 'Content-Length': size })
      if (size === 0) return res.end()
    }
    const rs = fs.createReadStream(fp, { start, end })
    rs.on('error', () => { if (!res.headersSent) res.statusCode = 500; res.destroy() })
    rs.pipe(res)
  }
}

export async function seed({ catalogDir, dataDir, port, host }) {
  const clearedSet = buildClearedSet(catalogDir)
  const server = http.createServer(makeOrigin(dataDir, clearedSet))
  server.on('clientError', (e, sock) => { try { sock.destroy() } catch {} })
  await new Promise(r => host ? server.listen(port, host, r) : server.listen(port, r))
  const a = server.address()
  console.log(`WebSeed origin 稼働 ${a.address}:${a.port}（公開の配信先）`)

  const client = new WebTorrent()
  let served = 0, withheld = 0
  for (const { m } of readManifests(catalogDir)) {
    if (!isCleared(m)) { console.log('公開保留 (intake 未通過):', m.name); withheld++; continue }
    const fp = path.join(dataDir, m.infoHash, m.name)
    if (!fs.existsSync(fp)) { console.log('skip (bytes missing):', m.name); continue }
    client.seed(fp, { name: m.name, pieceLength: m.pieceLength, urlList: m.webseeds, announceList: [] },
      t => console.log('seeding', t.infoHash, m.name))
    served++
  }
  console.log(`アンカーノード稼働。公開 ${served} 件、intake 保留 ${withheld} 件。Ctrl-C で停止。`)
  return { server, client }
}
