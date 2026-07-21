// The core of blz. Ingest and verify.
// - Content addressing: deterministically derive an infohash from a file. Bytes are stored at data/<infohash>/<name>.
// - Integrity: SHA-256 (streaming)
// - Intake gate: match against known blocked hashes (intake.mjs, fail-closed)
// - Proof of existence: OpenTimestamps (timestamp.mjs, best-effort; verification is kept separate from the integrity pass/fail)
// - Distribution: record the WebSeed (BEP-19) url-list in the manifest (multiple for multi-node redundancy)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'
import { stampSha256, verifyOts } from './timestamp.mjs'
import { screen, screenPerceptual } from './intake.mjs'

export const PIECE_LENGTH = 262144 // Fixed 256 KiB, to keep the infohash deterministic

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

// Allow base names only. Reject path separators and .. (a defense used by both ingest and mirror).
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

// The url-list lives outside the info dictionary, so it does not affect the infohash. Verification recomputes without webseeds.
export async function infohashOf(filePath, name) {
  return (await parseTorrent(await torrentFor(filePath, name, []))).infoHash
}

export async function ingest(filePath, { webseedBase, webseedBases, catalogDir, dataDir, stamp = true, blocklist = null, phashBlocklist = null, phashThreshold = 10 }) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('file not found: ' + filePath)
  const bases = (webseedBases && webseedBases.length) ? webseedBases : (webseedBase ? [webseedBase] : [])
  if (!bases.length) throw new Error('a --webseed origin URL is required (repeat for multi-node redundancy)')
  const name = safeName(path.basename(filePath))
  if (!name) throw new Error('invalid file name')

  const size = fs.statSync(filePath).size
  const sha256 = sha256File(filePath)

  // Intake gate. If it matches a known blocked hash, do not publish (fail-closed, rejected before anything is written).
  const scr = screen(sha256, blocklist)
  if (scr.matched) throw new Error('intake rejected: matched a known blocked hash (' + scr.provider + '). Not publishing.')

  // Perceptual gate (reject-only). Blocks a near-duplicate of a known blocked image; never clears on its own.
  const per = screenPerceptual(filePath, phashBlocklist, phashThreshold)
  if (per.matched) throw new Error('intake rejected: perceptual-hash match to a known blocked image (distance ' + per.distance + ' <= ' + per.threshold + ', ' + per.provider + '). Not publishing.')

  const intake = scr.cleared
    ? { status: 'cleared', provider: scr.provider, checkedAt: new Date().toISOString() }
    : { status: 'UNVERIFIED', note: scr.note }
  if (per.ran) intake.perceptual = { provider: per.provider, threshold: per.threshold, distance: per.distance, matched: false }

  const infoHash = await infohashOf(filePath, name)

  // Store bytes in a content-addressed directory. Do not overwrite on a base-name collision.
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

// Batch ingest a directory. Each contained file becomes its OWN content-addressed item,
// screened fail-closed independently — so one blocked file is rejected without aborting the
// batch or contaminating the rest. This is not a single multi-file torrent (that would move
// screening off the per-file boundary). Symlinks are not followed (loop/escape safety).
export async function ingestDir(dirPath, { recursive = false, ...opts } = {}) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) throw new Error('not a directory: ' + dirPath)
  const files = listFiles(dirPath, recursive)
  const items = [], rejected = [], failed = []
  for (const f of files) {
    try { items.push(await ingest(f, opts)) }
    catch (e) {
      const reason = e && e.message || String(e)
      ;(/^intake rejected/.test(reason) ? rejected : failed).push({ file: f, reason })
    }
  }
  return { batch: true, root: path.resolve(dirPath), scanned: files.length, items, rejected, failed }
}

// Deterministic, symlink-safe listing of regular files under dir.
function listFiles(dir, recursive) {
  const out = []
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const e of entries) {
      if (e.isSymbolicLink()) continue // never follow symlinks: avoids loops and escaping the tree
      const full = path.join(d, e.name)
      if (e.isDirectory()) { if (recursive) walk(full) }
      else if (e.isFile()) out.push(full)
    }
  }
  walk(dir)
  return out
}

// Return integrity (sha256+infohash) and proof of existence (OpenTimestamps) separately.
// OpenTimestamps depends on the network, so never mix it into the integrity pass/fail.
export async function verify(manifestPath, filePath) {
  if (!fs.existsSync(manifestPath)) throw new Error('manifest not found: ' + manifestPath)
  if (!fs.existsSync(filePath)) throw new Error('file not found: ' + filePath)
  const m = JSON.parse(fs.readFileSync(manifestPath))
  const integrity = []
  integrity.push(['SHA-256 integrity', sha256File(filePath) === m.sha256])
  integrity.push(['infohash (content address)', (await infohashOf(filePath, m.name)) === m.infoHash])

  let timestamp = { status: (m.timestamp && m.timestamp.proof) || 'none', verified: null }
  if (m.timestamp && m.timestamp.file) {
    const otsPath = path.join(path.dirname(manifestPath), m.timestamp.file)
    if (fs.existsSync(otsPath)) {
      const v = await verifyOts(m.sha256, fs.readFileSync(otsPath))
      timestamp = { status: v.status + (v.time ? ' @ ' + v.time : ''), verified: v.ok }
    } else {
      timestamp = { status: 'unverified (proof file missing)', verified: null }
    }
  }
  return { manifest: m, integrity, timestamp }
}
