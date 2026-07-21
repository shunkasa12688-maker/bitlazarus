#!/usr/bin/env node
import { Command } from 'commander'
import path from 'node:path'
import { ingest, verify } from '../src/core.mjs'
import { loadBlocklist } from '../src/intake.mjs'

const program = new Command()
program.name('blz').description('BitLazarus — a tool to revive dead records, address them by content, and prove existence').version('0.1.0')

program.command('ingest')
  .argument('<file>', 'File to ingest')
  .option('--webseed <url>', 'WebSeed origin (repeat for multi-node redundancy)', (v, acc) => acc.concat(v), [])
  .option('--catalog <dir>', 'Catalog location', './catalog')
  .option('--data <dir>', 'Where bytes are stored (root of the WebSeed origin)', './data')
  .option('--blocklist <file>', 'List of known blocked hashes (SHA-256). Required for public operation')
  .option('--no-timestamp', 'Do not stamp with OpenTimestamps (for offline use)')
  .action(run(async (file, o) => {
    const bases = o.webseed.length ? o.webseed : ['http://localhost:6969']
    const blocklist = loadBlocklist(o.blocklist)
    if (o.blocklist && !blocklist) console.error('Warning: the blocklist has 0 valid SHA-256 entries. Treating as UNVERIFIED instead of cleared.')
    printCert(await ingest(file, { webseedBases: bases, catalogDir: o.catalog, dataDir: o.data, stamp: o.timestamp, blocklist }), o.catalog)
  }))

program.command('verify')
  .argument('<manifest>', 'Location of the manifest JSON')
  .argument('<file>', 'File to check against')
  .action(run(async (manifest, file) => {
    const r = await verify(manifest, file)
    console.log(`\nVerify: ${r.manifest.name}`)
    let allPass = true
    for (const [label, ok] of r.integrity) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) allPass = false }
    console.log(`  Timestamp (informational, not part of pass/fail): ${r.timestamp.status}`)
    console.log(allPass ? '\n=> Match. This file is identical to the one registered and has not been tampered with.' : '\n=> Mismatch.')
    process.exit(allPass ? 0 : 1)
  }))

program.command('seed')
  .option('--catalog <dir>', 'Catalog location', './catalog')
  .option('--data <dir>', 'Where bytes are stored', './data')
  .option('--port <n>', 'Port for the WebSeed origin', '6969')
  .option('--host <addr>', 'Address to bind (default is all interfaces = public)')
  .action(run(async (o) => {
    const { seed } = await import('../src/seed.mjs') // Lazy import. ingest/verify do not load webtorrent
    await seed({ catalogDir: o.catalog, dataDir: o.data, port: Number(o.port), host: o.host })
  }))

program.command('index')
  .description('Write index.json, a public index of cleared items only')
  .option('--catalog <dir>', 'Catalog location', './catalog')
  .option('--out <file>', 'Output path for index.json')
  .action(run(async (o) => {
    const { writeIndex } = await import('../src/catalog.mjs')
    const i = writeIndex(o.catalog, o.out)
    console.log(`Wrote index. ${i.count} items (cleared only).`)
  }))

program.command('mirror')
  .description('Pull a screened catalog, fetch in isolation, self-verify, self-rescreen, and add your own origin so it can be re-served')
  .argument('<srcCatalog>', 'Source catalog to mirror (a git-cloned directory)')
  .requiredOption('--origin <url>', 'Base URL of your own WebSeed origin')
  .option('--catalog <dir>', 'Your catalog', './catalog')
  .option('--data <dir>', 'Where your bytes are stored', './data')
  .option('--blocklist <file>', 'Your blocklist (without it, items are not cleared and serving is withheld)')
  .option('--allow-local-webseed', 'Allow loopback/internal webseeds (for testing)')
  .option('--max-size <bytes>', 'Max bytes to fetch per item', '0')
  .action(run(async (srcCatalog, o) => {
    const { mirror } = await import('../src/mirror.mjs')
    await mirror({ srcCatalogDir: srcCatalog, originBase: o.origin, dataDir: o.data, catalogDir: o.catalog, blocklist: loadBlocklist(o.blocklist), allowLocalWebseed: !!o.allowLocalWebseed, maxSizeBytes: Number(o.maxSize) })
  }))

program.command('upgrade')
  .description('Fold pending OpenTimestamps into Bitcoin confirmations (run on a schedule, e.g. via cron)')
  .option('--catalog <dir>', 'Catalog location', './catalog')
  .option('--watch <min>', 'Repeat every N minutes (resident)')
  .action(run(async (o) => {
    const { upgradeCatalog } = await import('../src/upgrade.mjs')
    const once = async () => {
      const r = await upgradeCatalog(o.catalog)
      for (const x of r.results) console.log(`  ${x.infoHash.slice(0, 12)} : ${x.status}`)
      console.log(`Confirmed ${r.confirmed}, pending ${r.pending}.`)
    }
    await once()
    if (o.watch !== undefined) {
      const min = Number(o.watch)
      if (!(min > 0)) throw new Error('--watch requires a positive number (minutes)')
      console.log(`--watch: repeating every ${min} minutes. Ctrl-C to stop.`)
      setInterval(() => once().catch(e => console.error('Error:', e && e.message || e)), min * 60000)
    }
  }))

program.parseAsync()

// Print errors on one line and exit with 1. Do not show the stack trace to the user.
function run(fn) {
  return async (...a) => {
    try { await fn(...a) }
    catch (e) { console.error('Error:', e && e.message || e); process.exit(1) }
  }
}

function printCert(m, catalog) {
  const intake = m.intake.status + (m.intake.provider ? ' (' + m.intake.provider + ')' : '')
  const hasProof = !!(m.timestamp && m.timestamp.file)
  const claim = hasProof
    ? 'This bitstream existed at the time above and has not been altered since. It proves existence and integrity only, not provenance.'
    : 'No timestamp was generated. This certificate guarantees integrity (content identity) only, not the time of existence.'
  console.log(`
========== BitLazarus revival & proof-of-existence certificate ==========
 Name          : ${m.name}
 Size          : ${m.size} bytes
 SHA-256       : ${m.sha256}
 infohash      : ${m.infoHash}
 magnet        : ${m.magnet}
 Timestamp     : ${m.timestamp.proof}
 Intake screen : ${intake}
 Created       : ${m.created}
 Manifest      : ${path.join(catalog, m.infoHash + '.json')}
-------------------------------------------------------------------------
 Verify command: blz verify ${path.join(catalog, m.infoHash + '.json')} <file>
 Claim scope   : ${claim}
=========================================================================
`)
}
