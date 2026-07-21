# Development and SDLC

Keep it small, guard it with tests, and auto-verify on every CI run. Humans judge; machines verify.

## Structure

```
blz/
  bin/blz.mjs        CLI entry point. Error handling and display only. Holds no logic.
  src/core.mjs       Ingest (single + directory batch) and verify. Content addressing, SHA-256, manifest.
  src/intake.mjs     Intake gate. Composable providers: exact SHA-256 denylist + perceptual dHash.
  src/phash.mjs      Reference perceptual hash (dHash) and Netpbm decoder. The plug-in boundary.
  src/timestamp.mjs  OpenTimestamps proof of existence. Best-effort.
  src/seed.mjs       Anchor node. WebSeed origin and seeding.
  tests/             node:test automated tests. Never touch the network.
  .github/workflows/ CI. Runs npm test on push and PR.
```

## Development workflow

1. Always pair a change with tests. Pin the core logic with tests.
2. Push only after `npm test` is green locally.
3. On push and PR, CI runs the tests automatically on Node 20 and 22. Nothing that isn't green gets merged.
4. Versioning is semver. Breaking changes bump the major version.
5. Keep dependencies minimal. Never roll your own crypto; use audited libraries only.

## How to run

```
npm install
npm test
node bin/blz.mjs ingest <file> --webseed http://your-origin
node bin/blz.mjs verify <manifest.json> <file>
node bin/blz.mjs seed --port 6969
```

## Hard lines (non-negotiable)

- Always pass the CSAM hash-matching intake gate before public seeding. Do not build your own classifier.
- Never put real data, keys, or credentials in Git. Respect `.gitignore` and the pre-commit secret scan.
- Do not write code that moves money. No payments, no escrow, no marketplace.

## Implemented (one pass at closing the gaps)

1. Multi-node revival. With multiple origins, a download completes even if one node is stopped. `npm run test:revival`
2. Catalog publishing and independent mirrors. If the operator disappears, another operator keeps it alive. `blz index`, `blz mirror`, and the Dockerfile. `npm run test:mirror`
3. Intake gate. Fail-closed matching against known blocked hashes. `blz ingest --blocklist`. `seed` serves only cleared items.
4. Folding OpenTimestamps into confirmations. `blz upgrade`.
5. Directory batch ingest. `blz ingest <dir> -r`. Each file is its own item, screened independently; a blocked file is rejected without aborting the batch. Symlinks are not followed.
6. Composable intake providers. A reject-only perceptual (dHash) gate behind `--phash-blocklist`, alongside the exact SHA-256 denylist. Reference implementation only — a licensed PhotoDNA/Thorn provider plugs in at `src/phash.mjs` (`decodeImage`) and `src/intake.mjs` (`screenPerceptual`). No real hashes and no classifier ever ship here.

## Scheduling timestamp upgrades

Run `blz upgrade` on a schedule to fold pending proofs into Bitcoin confirmations. Bitcoin confirmation takes several hours, so weekly is enough.

Example cron:
```
0 3 * * 0 cd /app && node bin/blz.mjs upgrade --catalog /app/catalog >> /var/log/blz-upgrade.log 2>&1
```
To run it resident: `node bin/blz.mjs upgrade --watch 1440` (once a day).

## Next stage (needed before production use)

- Wire intake matching to a real PhotoDNA / NCMEC / Thorn provider. The interface exists (`screenPerceptual` in `src/intake.mjs`, `decodeImage` in `src/phash.mjs`); replace the reference dHash/Netpbm code with the licensed provider. This assumes NCMEC ESP registration and legal counsel.
- Obtain legal standing under a fiscal sponsor (e.g. CS&S). See ../OPERATING_PLAN.md for details.
- Mirror the catalog in an actual public git repository.
