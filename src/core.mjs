// blz の核。取り込みと検証。
// - 内容アドレス化: ファイルから決定的に infohash を作る。バイトは data/<infohash>/<name> に保管。
// - 完全性: SHA-256（ストリーミング）
// - 取り込みゲート: 既知の禁止ハッシュに照合（intake.mjs、fail-closed）
// - 存在証明: OpenTimestamps（timestamp.mjs、best-effort。検証は完全性の合否と切り離す）
// - 配信: WebSeed(BEP-19) の url-list をマニフェストに刻む（複数で多ノード冗長）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'
import { stampSha256, verifyOts } from './timestamp.mjs'
import { screen } from './intake.mjs'

export const PIECE_LENGTH = 262144 // 256 KiB 固定。infohash を決定的にするため

export function sha256File(p) {
  const h = crypto.createHash('sha256')
  const fd = fs.openSync(p, 'r')
  try {
    const buf = Buffer.alloc(1 << 20)
    let n
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
  } finally { fs.closeSync(fd) }
  return h.digest('hex')
}

// ファイル名はベース名のみ許す。パス区切りや .. を弾く（取り込み・ミラー双方の防御）。
export function safeName(name) {
  const b = path.basename(name)
  if (!b || b === '.' || b === '..' || b !== name || /[\/\\]/.test(name)) return null
  return b
}

function torrentFor(filePath, name, webseeds) {
  return new Promise((res, rej) =>
    createTorrent(filePath, { name, pieceLength: PIECE_LENGTH, urlList: webseeds, announceList: [] },
      (e, b) => e ? rej(e) : res(b)))
}

// url-list は info 辞書の外なので infohash に影響しない。検証は webseed 無しで再計算する。
export async function infohashOf(filePath, name) {
  return (await parseTorrent(await torrentFor(filePath, name, []))).infoHash
}

export async function ingest(filePath, { webseedBase, webseedBases, catalogDir, dataDir, stamp = true, blocklist = null }) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('ファイルが見つからない: ' + filePath)
  const bases = (webseedBases && webseedBases.length) ? webseedBases : (webseedBase ? [webseedBase] : [])
  if (!bases.length) throw new Error('--webseed の origin URL が要る（複数指定で多ノード冗長）')
  const name = safeName(path.basename(filePath))
  if (!name) throw new Error('不正なファイル名')

  const size = fs.statSync(filePath).size
  const sha256 = sha256File(filePath)

  // 取り込みゲート。既知の禁止ハッシュに一致したら公開しない（fail-closed、書き込む前に弾く）。
  const scr = screen(sha256, blocklist)
  if (scr.matched) throw new Error('取り込み拒否: 既知の禁止ハッシュ(' + scr.provider + ')に一致。公開しない。')
  const intake = scr.cleared
    ? { status: 'cleared', provider: scr.provider, checkedAt: new Date().toISOString() }
    : { status: 'UNVERIFIED', note: scr.note }

  const infoHash = await infohashOf(filePath, name)

  // バイトは内容アドレスのディレクトリに置く。ベース名衝突で上書きしない。
  const itemDir = path.join(dataDir, infoHash)
  fs.mkdirSync(itemDir, { recursive: true })
  fs.mkdirSync(catalogDir, { recursive: true })
  const dataPath = path.join(itemDir, name)
  if (path.resolve(dataPath) !== path.resolve(filePath)) fs.copyFileSync(filePath, dataPath)

  const webseeds = bases.map(b => b.replace(/\/+$/, '') + '/' + infoHash + '/' + encodeURIComponent(name))
  const torrentBuf = await torrentFor(dataPath, name, webseeds)
  fs.writeFileSync(path.join(catalogDir, infoHash + '.torrent'), torrentBuf)

  const ts = stamp ? await stampSha256(sha256) : { status: 'skipped (--no-timestamp)' }
  if (ts.ots) fs.writeFileSync(path.join(catalogDir, infoHash + '.ots'), ts.ots)

  const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}` +
    webseeds.map(w => `&ws=${encodeURIComponent(w)}`).join('')

  const manifest = {
    name, size, sha256, infoHash, pieceLength: PIECE_LENGTH, webseeds, magnet,
    created: new Date().toISOString(),
    timestamp: { proof: ts.status, file: ts.ots ? infoHash + '.ots' : null },
    intake,
    tool: 'bitlazarus 0.1.0'
  }
  fs.writeFileSync(path.join(catalogDir, infoHash + '.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

// 完全性(sha256+infohash)と、存在証明(OpenTimestamps)を分けて返す。
// OpenTimestamps はネットワーク依存なので、完全性の合否には絶対に混ぜない。
export async function verify(manifestPath, filePath) {
  if (!fs.existsSync(manifestPath)) throw new Error('マニフェストが見つからない: ' + manifestPath)
  if (!fs.existsSync(filePath)) throw new Error('ファイルが見つからない: ' + filePath)
  const m = JSON.parse(fs.readFileSync(manifestPath))
  const integrity = []
  integrity.push(['SHA-256 完全性', sha256File(filePath) === m.sha256])
  integrity.push(['infohash（内容アドレス）', (await infohashOf(filePath, m.name)) === m.infoHash])

  let timestamp = { status: (m.timestamp && m.timestamp.proof) || 'none', verified: null }
  if (m.timestamp && m.timestamp.file) {
    const otsPath = path.join(path.dirname(manifestPath), m.timestamp.file)
    if (fs.existsSync(otsPath)) {
      const v = await verifyOts(m.sha256, fs.readFileSync(otsPath))
      timestamp = { status: v.status + (v.time ? ' @ ' + v.time : ''), verified: v.ok }
    } else {
      timestamp = { status: 'unverified (証明ファイルが無い)', verified: null }
    }
  }
  return { manifest: m, integrity, timestamp }
}
