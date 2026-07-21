# bitlazarus (blz)

An open-source public-good tool that revives dead records, addresses them by their content, and proves that they existed.

This is not a business. It is a tool backed by a nonprofit. The operators take no part in moving money. We build no payments, no escrow, no fee pass-through, and no marketplace.

## Scope of our claims

We prove only **existence and integrity**: that this bitstream existed at time T and has not been altered since. We do **not** prove provenance. We do not claim "this footage is a real event." That requires hardware attestation at the moment of capture, which is the domain of established players like C2PA. We are not a competitor to C2PA but a complementary layer beneath it. C2PA proves what happened to a file; we guarantee that the file still exists and that no one can quietly erase it.

## What it does

- **Content addressing**: deterministically derive an infohash from a file. Because the address is a fingerprint of the content, anyone who has the same bytes can revive a previously shared link as-is.
- **Integrity**: SHA-256.
- **Proof of existence**: stamp the hash onto Bitcoin via OpenTimestamps. You do not need us to verify it. The proof outlives the organization.
- **Distribution and revival**: WebSeed (BEP-19) plus an always-on seed peer. Even if every peer disappears, the origin keeps serving, so a dead distribution comes back to life.

## Usage

```
blz ingest <file> --webseed http://your-origin
  -> Content-address, SHA-256, OpenTimestamps, WebSeed magnet, and certificate.

blz ingest <directory> -r --webseed http://your-origin
  -> Batch. Every file becomes its own content-addressed item, each screened
     independently. A blocked file is rejected without aborting the rest.

blz ingest <file> --blocklist bad-sha256.txt --phash-blocklist bad-phash.txt
  -> Run both intake gates: the exact SHA-256 denylist and the perceptual
     (dHash) reject-only image gate.

blz verify <manifest.json> <file>
  -> Re-verify the infohash, SHA-256, and OpenTimestamps. Tampering is detected instantly.

blz seed --port 6969
  -> Anchor node. Continuously seeds the catalog and serves the WebSeed origin.
```

## Mandatory intake gate (non-negotiable)

Before any public seeding, everything must pass industry-standard CSAM hash matching (PhotoDNA / NCMEC / Thorn). We never build our own classifier. Intake is limited to vetted partner sources. We do not open a public upload endpoint. For a US-based operator, reporting to NCMEC on detection is a legal obligation; we handle this with a lawyer. Today the `intake` field is UNVERIFIED and `seed` prints a warning. We do not seed publicly until real matching is integrated.

The gate is built from composable providers so a licensed provider drops in without touching the serving path:

- **Exact SHA-256 denylist** (`--blocklist`) — the primary gate; decides `cleared` vs `UNVERIFIED`. Fail-closed: an empty or missing list never clears anything.
- **Perceptual dHash** (`--phash-blocklist`) — a *reject-only* gate that catches a near-duplicate of a known blocked image within a Hamming-distance threshold. It can only block; it never clears an item on its own, so adding it can only make intake stricter. This is a fuzzy fingerprint matched against known-bad hashes — **not a classifier**.

The shipped perceptual code is a **reference implementation** (a dependency-free dHash over a Netpbm decoder) that proves the interface and is fully tested. It is not PhotoDNA. In production you swap in a licensed decoder and provider behind the same interface. This repo ships **no real CSAM hashes** and no predictive model.

## Honest limitations

- WebSeed revival only works when we or a mirror actually hold the bytes. An infohash alone cannot bring back data that no one has. We do not regenerate lost bytes.
- OpenTimestamps proves only one thing: that these bytes existed on this date. It is not authenticity or chain of custody.
- A single anchor node is a single point of failure and a single legal target. Real redundancy only begins when two or more mirrors in other jurisdictions actually hold copies.

## License (planned)

The seed and WebSeed core are AGPL-3.0-or-later, the client is Apache-2.0, and the infohash/timestamp specifications and catalog are CC0.
