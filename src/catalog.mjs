// 公開インデックス。git でミラーできる、cleared 項目だけの一覧。
// カタログ自体が内容アドレスで自己検証できるので、ホストを信頼せずに引ける。
import fs from 'node:fs'
import path from 'node:path'
import { isCleared } from './intake.mjs'

export function buildIndex(catalogDir) {
  const files = fs.existsSync(catalogDir) ? fs.readdirSync(catalogDir).filter(f => f.endsWith('.json') && f !== 'index.json') : []
  const entries = []
  for (const f of files) {
    let m
    try { m = JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')) } catch { continue } // 壊れた1件で止めない
    if (!isCleared(m)) continue // 公開インデックスには審査を通ったものだけ
    entries.push({ name: m.name, size: m.size, sha256: m.sha256, infoHash: m.infoHash, pieceLength: m.pieceLength, webseeds: m.webseeds, magnet: m.magnet, timestamp: m.timestamp, intake: m.intake })
  }
  entries.sort((a, b) => a.infoHash.localeCompare(b.infoHash))
  return { tool: 'bitlazarus 0.1.0', generated: new Date().toISOString(), count: entries.length, entries }
}

export function writeIndex(catalogDir, outPath) {
  const idx = buildIndex(catalogDir)
  fs.writeFileSync(outPath || path.join(catalogDir, 'index.json'), JSON.stringify(idx, null, 2))
  return idx
}

export async function loadIndex(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src)
    if (!r.ok) throw new Error('index 取得失敗: ' + r.status)
    return await r.json()
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'))
}
