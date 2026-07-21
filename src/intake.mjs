// 取り込みゲート。公開シードの前に、既知の禁止ハッシュと照合する。
// 重要: CSAM 分類器は絶対に自作しない。ここは既知の悪いものの参照リストに照合するだけ。
// 差し口は共通で、実運用では PhotoDNA / NCMEC / Thorn の知覚ハッシュを差す。
// 既定は SHA-256 の完全一致 denylist（実物のCSAMハッシュは扱わない・置かない）。
import fs from 'node:fs'

// SHA-256 の16進を1行ずつ書いたブロックリストを読む。
// 有効な行が0件なら null を返す（＝照合不能）。空リストで全部を cleared にしない（fail-closed）。
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

// 照合。一致したら cleared=false かつ matched=true。ブロックリスト未設定/空は UNVERIFIED。
export function screen(sha256hex, blocklist, provider = 'sha256-denylist') {
  if (!blocklist) return { cleared: false, matched: false, provider: null, note: 'UNVERIFIED — 有効なブロックリストが無い。公開シード前に照合が必須' }
  const matched = blocklist.has(String(sha256hex).toLowerCase())
  return { cleared: !matched, matched, provider }
}

// seed が公開してよいか。fail-closed。cleared のものだけ。古い文字列や未設定は cleared 扱いにしない。
export function isCleared(manifest) {
  return !!(manifest && manifest.intake && manifest.intake.status === 'cleared')
}
