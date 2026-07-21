// カタログの保留中タイムスタンプを走査し、Bitcoin の確認に畳み込む。
// cron 等で定期実行する。確認できたら manifest にも反映する。
import fs from 'node:fs'
import path from 'node:path'
import { upgradeOts, verifyOts } from './timestamp.mjs'

export async function upgradeCatalog(catalogDir) {
  const files = fs.existsSync(catalogDir) ? fs.readdirSync(catalogDir).filter(f => f.endsWith('.ots')) : []
  const results = []
  let confirmed = 0, pending = 0
  for (const f of files) {
    const otsPath = path.join(catalogDir, f)
    const up = await upgradeOts(fs.readFileSync(otsPath))
    if (up.ots && up.changed) fs.writeFileSync(otsPath, up.ots)

    const ih = f.replace(/\.ots$/, '')
    const mp = path.join(catalogDir, ih + '.json')
    let status = up.changed ? 'upgraded' : 'no-change'
    if (fs.existsSync(mp)) {
      let m = null
      try { m = JSON.parse(fs.readFileSync(mp, 'utf8')) } catch { m = null }
      if (m) {
        const v = await verifyOts(m.sha256, fs.readFileSync(otsPath))
        status = v.status
        if (v.status === 'confirmed') {
          confirmed++
          m.timestamp = { ...(m.timestamp || {}), proof: 'confirmed @ ' + v.time, file: ih + '.ots' }
          fs.writeFileSync(mp, JSON.stringify(m, null, 2))
        } else pending++
      }
    }
    results.push({ infoHash: ih, status })
  }
  return { confirmed, pending, results }
}
