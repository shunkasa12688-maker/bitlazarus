// Intake gate. Before public seeding, match against known blocked hashes.
// Important: never build a CSAM classifier ourselves. Here we only match against a reference list of known-bad items.
// The interface is generic; in real operation, plug in the perceptual hashes of PhotoDNA / NCMEC / Thorn.
// The default is an exact-match SHA-256 denylist (we neither handle nor store actual CSAM hashes).
import fs from 'node:fs'

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
