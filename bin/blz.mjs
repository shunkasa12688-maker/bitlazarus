#!/usr/bin/env node
import { Command } from 'commander'
import path from 'node:path'
import { ingest, verify } from '../src/core.mjs'
import { loadBlocklist } from '../src/intake.mjs'

const program = new Command()
program.name('blz').description('BitLazarus — 死んだ記録を蘇らせ、内容で住所を付け、存在を証明する道具').version('0.1.0')

program.command('ingest')
  .argument('<file>', '取り込むファイル')
  .option('--webseed <url>', 'WebSeed origin（複数指定で多ノード冗長）', (v, acc) => acc.concat(v), [])
  .option('--catalog <dir>', 'カタログの場所', './catalog')
  .option('--data <dir>', 'バイトの置き場（WebSeed origin の root）', './data')
  .option('--blocklist <file>', '既知の禁止ハッシュ(SHA-256)リスト。公開運用では必須')
  .option('--no-timestamp', 'OpenTimestamps を刻まない（オフライン用）')
  .action(run(async (file, o) => {
    const bases = o.webseed.length ? o.webseed : ['http://localhost:6969']
    const blocklist = loadBlocklist(o.blocklist)
    if (o.blocklist && !blocklist) console.error('警告: ブロックリストに有効な SHA-256 が0件。cleared にせず UNVERIFIED 扱いにする。')
    printCert(await ingest(file, { webseedBases: bases, catalogDir: o.catalog, dataDir: o.data, stamp: o.timestamp, blocklist }), o.catalog)
  }))

program.command('verify')
  .argument('<manifest>', 'マニフェスト JSON の場所')
  .argument('<file>', '照合するファイル')
  .action(run(async (manifest, file) => {
    const r = await verify(manifest, file)
    console.log(`\n検証: ${r.manifest.name}`)
    let allPass = true
    for (const [label, ok] of r.integrity) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) allPass = false }
    console.log(`  タイムスタンプ（参考・合否に含めない）: ${r.timestamp.status}`)
    console.log(allPass ? '\n=> 一致。このファイルは登録時と同一で、改ざんされていない。' : '\n=> 不一致。')
    process.exit(allPass ? 0 : 1)
  }))

program.command('seed')
  .option('--catalog <dir>', 'カタログの場所', './catalog')
  .option('--data <dir>', 'バイトの置き場', './data')
  .option('--port <n>', 'WebSeed origin のポート', '6969')
  .option('--host <addr>', 'bind するアドレス（既定は全インターフェース＝公開）')
  .action(run(async (o) => {
    const { seed } = await import('../src/seed.mjs') // 遅延読み込み。ingest/verify では webtorrent を読まない
    await seed({ catalogDir: o.catalog, dataDir: o.data, port: Number(o.port), host: o.host })
  }))

program.command('index')
  .description('cleared 項目だけの公開インデックス index.json を書き出す')
  .option('--catalog <dir>', 'カタログの場所', './catalog')
  .option('--out <file>', 'index.json の出力先')
  .action(run(async (o) => {
    const { writeIndex } = await import('../src/catalog.mjs')
    const i = writeIndex(o.catalog, o.out)
    console.log(`index を書き出した。${i.count} 件（cleared のみ）。`)
  }))

program.command('mirror')
  .description('審査を通ったカタログを引き、隔離取得・自己検証・自己再審査し、自分の origin を足して再配信可能にする')
  .argument('<srcCatalog>', 'ミラー元のカタログ（git clone したディレクトリ）')
  .requiredOption('--origin <url>', '自分の WebSeed origin ベースURL')
  .option('--catalog <dir>', '自分のカタログ', './catalog')
  .option('--data <dir>', '自分のバイト置き場', './data')
  .option('--blocklist <file>', '自分のブロックリスト（無いと cleared にならず配信保留）')
  .option('--allow-local-webseed', 'ループバック/内部の webseed を許す（テスト用）')
  .option('--max-size <bytes>', '1件あたりの取得上限バイト数', '0')
  .action(run(async (srcCatalog, o) => {
    const { mirror } = await import('../src/mirror.mjs')
    await mirror({ srcCatalogDir: srcCatalog, originBase: o.origin, dataDir: o.data, catalogDir: o.catalog, blocklist: loadBlocklist(o.blocklist), allowLocalWebseed: !!o.allowLocalWebseed, maxSizeBytes: Number(o.maxSize) })
  }))

program.command('upgrade')
  .description('保留中の OpenTimestamps を Bitcoin の確認に畳み込む（cron 等で定期実行）')
  .option('--catalog <dir>', 'カタログの場所', './catalog')
  .option('--watch <min>', '指定分ごとに繰り返す（常駐）')
  .action(run(async (o) => {
    const { upgradeCatalog } = await import('../src/upgrade.mjs')
    const once = async () => {
      const r = await upgradeCatalog(o.catalog)
      for (const x of r.results) console.log(`  ${x.infoHash.slice(0, 12)} : ${x.status}`)
      console.log(`確認済み ${r.confirmed} 件、保留 ${r.pending} 件。`)
    }
    await once()
    if (o.watch !== undefined) {
      const min = Number(o.watch)
      if (!(min > 0)) throw new Error('--watch は正の数（分）を指定')
      console.log(`--watch: ${min} 分ごとに繰り返す。Ctrl-C で停止。`)
      setInterval(() => once().catch(e => console.error('エラー:', e && e.message || e)), min * 60000)
    }
  }))

program.parseAsync()

// エラーは一行で出して 1 で終える。スタックトレースをユーザーに見せない。
function run(fn) {
  return async (...a) => {
    try { await fn(...a) }
    catch (e) { console.error('エラー:', e && e.message || e); process.exit(1) }
  }
}

function printCert(m, catalog) {
  const intake = m.intake.status + (m.intake.provider ? ' (' + m.intake.provider + ')' : '')
  const hasProof = !!(m.timestamp && m.timestamp.file)
  const claim = hasProof
    ? 'この bitstream は上記時刻に存在し、以降改ざんされていない。本物性ではなく、存在と完全性のみを証明する。'
    : 'タイムスタンプ未生成。この証明書が保証するのは完全性（内容の同一性）のみで、存在時刻は証明しない。'
  console.log(`
================ BitLazarus 蘇生・存在証明 証明書 ================
 名前          : ${m.name}
 サイズ        : ${m.size} bytes
 SHA-256       : ${m.sha256}
 infohash      : ${m.infoHash}
 magnet        : ${m.magnet}
 タイムスタンプ : ${m.timestamp.proof}
 取り込み審査  : ${intake}
 作成時刻      : ${m.created}
 マニフェスト  : ${path.join(catalog, m.infoHash + '.json')}
----------------------------------------------------------------
 検証コマンド  : blz verify ${path.join(catalog, m.infoHash + '.json')} <file>
 主張の範囲    : ${claim}
================================================================
`)
}
