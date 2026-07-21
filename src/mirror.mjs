// Volunteer mirror. Trust no upstream: fetch in isolation, verify the content address yourself,
// re-screen it yourself, and add your own origin so it can be re-served. Fail-closed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'
import { sha256File, infohashOf, safeName, PIECE_LENGTH } from './core.mjs'
import { isCleared, screen } from './intake.mjs'
import { verifyOts } from './timestamp.mjs'

// SSRF defense. Reject webseeds from an untrusted .torrent that point to internal/loopback addresses.
function allowedWebseed(url, allowLocal) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (allowLocal) return true
    const h = u.hostname
    if (/^localhost$/i.test(h) || /^127\./.test(h) || h === '::1' || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    return true
  } catch { return false }
}

function torrentWith(filePath, name, webseeds) {
  return new Promise((res, rej) => createTorrent(filePath, { name, pieceLength: PIECE_LENGTH, urlList: webseeds, announceList: [] }, (e, b) => e ? rej(e) : res(b)))
}

async function acquire(torrentBuf, outDir, { maxSize, allowLocal }, timeoutMs = 30000) {
  const parsed = await parseTorrent(torrentBuf)
  parsed.urlList = (parsed.urlList || []).filter(u => allowedWebseed(u, allowLocal))
  if (!parsed.urlList.length) throw new Error('no valid webseed (excluded by SSRF defense)')
  if (maxSize && parsed.length && parsed.length > maxSize) throw new Error('size exceeded: ' + parsed.length)
  return new Promise((resolve, reject) => {
    const client = new WebTorrent({ dht: false, lsd: false, tracker: false })
    const t = client.add(parsed, { path: outDir, announce: [] })
    const to = setTimeout(() => client.destroy(() => reject(new Error('fetch timed out'))), timeoutMs)
    t.on('error', e => { clearTimeout(to); client.destroy(() => reject(e)) })
    t.on('done', () => { clearTimeout(to); const fp = path.join(outDir, t.files[0].name); client.destroy(() => resolve(fp)) })
  })
}

export async function mirror({ srcCatalogDir, originBase, dataDir, catalogDir, blocklist = null, allowLocalWebseed = false, maxSizeBytes = 0 }) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(catalogDir, { recursive: true })
  const out = { mirrored: 0, skipped: 0, failed: 0 }
  const files = fs.readdirSync(srcCatalogDir).filter(f => f.endsWith('.json') && f !== 'index.json')
  for (const f of files) {
    let m
    try { m = JSON.parse(fs.readFileSync(path.join(srcCatalogDir, f), 'utf8')) } catch { out.failed++; console.log('failed (corrupt manifest):', f); continue }
    if (!isCleared(m)) { out.skipped++; console.log('skip (upstream not screened):', m && m.name); continue }
    const name = safeName(m.name)
    if (!name) { out.failed++; console.log('failed (invalid name):', m.name); continue }
    const torrentPath = path.join(srcCatalogDir, m.infoHash + '.torrent')
    if (!fs.existsSync(torrentPath)) { out.failed++; console.log('failed (.torrent missing):', name); continue }
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'blz-q-'))
    try {
      const fp = await acquire(fs.readFileSync(torrentPath), q, { maxSize: maxSizeBytes, allowLocal: allowLocalWebseed })
      // Trust no upstream: verify the content address yourself
      if (sha256File(fp) !== m.sha256) throw new Error('sha256 mismatch')
      if ((await infohashOf(fp, name)) !== m.infoHash) throw new Error('infohash mismatch')
      // Re-screen it yourself. Do not trust the upstream's cleared status (fail-closed).
      const scr = screen(m.sha256, blocklist)
      if (scr.matched) throw new Error('matched a blocked hash in your own check')
      const intake = scr.cleared
        ? { status: 'cleared', provider: scr.provider, checkedAt: new Date().toISOString(), by: 'mirror' }
        : { status: 'UNVERIFIED', note: scr.note, by: 'mirror' }

      const itemDir = path.join(dataDir, m.infoHash)
      fs.mkdirSync(itemDir, { recursive: true })
      const dst = path.join(itemDir, name)
      fs.copyFileSync(fp, dst)
      const webseeds = Array.from(new Set([...(m.webseeds || []), originBase.replace(/\/+$/, '') + '/' + m.infoHash + '/' + encodeURIComponent(name)]))
      fs.writeFileSync(path.join(catalogDir, m.infoHash + '.torrent'), await torrentWith(dst, name, webseeds))
      const magnet = `magnet:?xt=urn:btih:${m.infoHash}&dn=${encodeURIComponent(name)}` + webseeds.map(w => `&ws=${encodeURIComponent(w)}`).join('')

      // Carry over the .ots only if it verifies against the sha256. Do not re-publish a fake proof.
      let timestamp = { proof: 'not-carried', file: null }
      const otsSrc = path.join(srcCatalogDir, m.infoHash + '.ots')
      if (fs.existsSync(otsSrc)) {
        const v = await verifyOts(m.sha256, fs.readFileSync(otsSrc))
        if (v.ok) { fs.copyFileSync(otsSrc, path.join(catalogDir, m.infoHash + '.ots')); timestamp = { proof: v.status + (v.time ? ' @ ' + v.time : ''), file: m.infoHash + '.ots' } }
      }
      const local = { name, size: m.size, sha256: m.sha256, infoHash: m.infoHash, pieceLength: m.pieceLength, webseeds, magnet, created: m.created, timestamp, intake, tool: 'bitlazarus 0.1.0', mirroredAt: new Date().toISOString() }
      fs.writeFileSync(path.join(catalogDir, m.infoHash + '.json'), JSON.stringify(local, null, 2))
      out.mirrored++
      console.log(`mirrored+verified: ${name} ${m.infoHash} intake=${intake.status}`)
    } catch (e) { out.failed++; console.log('failed:', name, e.message) }
    finally { try { fs.rmSync(q, { recursive: true, force: true }) } catch {} }
  }
  console.log(`Mirror complete. Fetched+verified ${out.mirrored}, upstream not screened ${out.skipped}, failed ${out.failed}.`)
  return out
}
