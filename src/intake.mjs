// Intake gate. Before public seeding, match against known blocked hashes.
// Important: never build a CSAM classifier ourselves. Here we only match against a reference list of known-bad items.
// The interface is generic; in real operation, plug in the perceptual hashes of PhotoDNA / NCMEC / Thorn.
// Two composable providers:
//   - exact SHA-256 denylist (screen / loadBlocklist): the primary gate; decides cleared vs UNVERIFIED.
//   - perceptual dHash (screenPerceptual / loadPhashBlocklist): a REJECT-ONLY gate. It can block a
//     near-duplicate image but never clears an item on its own, so adding it only makes intake stricter.
// We neither handle nor store actual CSAM hashes.
import fs from 'node:fs'
import { decodeImage, dHash, hamming, hexToHash, isProbablyImage } from './phash.mjs'

// Read a blocklist with one hex SHA-256 per line.
// Return null if there are 0 valid lines (= cannot match). An empty list must not clear everything (fail-closed).
export function loadBlocklist(file) {
  if (!file) return null
  const set = new Set()
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const h = line.trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(h)) set.add(h)
    }
  } catch { return null }
  return set.size > 0 ? set : null
}

// Matching. On a match, cleared=false and matched=true. An unset/empty blocklist is UNVERIFIED.
export function screen(sha256hex, blocklist, provider = 'sha256-denylist') {
  if (!blocklist) return { cleared: false, matched: false, provider: null, note: 'UNVERIFIED — no valid blocklist. Matching is required before public seeding' }
  const matched = blocklist.has(String(sha256hex).toLowerCase())
  return { cleared: !matched, matched, provider }
}

// Whether seed may publish it. Fail-closed. Only cleared items. Legacy strings or an unset field are not treated as cleared.
export function isCleared(manifest) {
  return !!(manifest && manifest.intake && manifest.intake.status === 'cleared')
}

// Load a perceptual-hash blocklist: one 64-bit dHash (16 hex chars) per line; '#' starts a comment.
// Fail-closed: 0 valid entries => null (the perceptual gate simply does not run).
export function loadPhashBlocklist(file) {
  if (!file) return null
  const arr = []
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const h = hexToHash(line.split('#')[0])
      if (h !== null) arr.push(h)
    }
  } catch { return null }
  return arr.length ? arr : null
}

// Perceptual screen. Reject-only: match a file's image perceptual hash against the blocklist within
// `threshold` bits (Hamming). Non-images / undecodable files => ran:false (no match, no opinion).
// This NEVER clears an item; clearance stays with the exact-hash gate above (fail-closed).
export function screenPerceptual(filePath, phashBlocklist, threshold = 10, provider = 'dhash-perceptual') {
  if (!phashBlocklist || !phashBlocklist.length) return { ran: false, matched: false, provider: null, note: 'no perceptual blocklist' }
  if (!isProbablyImage(filePath)) return { ran: false, matched: false, provider, note: 'not a decodable image' }
  let img
  try { img = decodeImage(filePath) } catch (e) { return { ran: false, matched: false, provider, note: 'decode failed: ' + (e && e.message || e) } }
  let h
  try { h = dHash(img.gray, img.width, img.height) } catch { return { ran: false, matched: false, provider, note: 'could not hash image' } }
  let best = 64
  for (const b of phashBlocklist) { const d = hamming(h, b); if (d < best) best = d }
  return { ran: true, matched: best <= threshold, distance: best, threshold, provider }
}
