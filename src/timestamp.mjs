// The timestamp layer for proof of existence. Stamp the hash with OpenTimestamps.
// Best-effort, since it depends on the network. On failure the tool does not stop; it just records the state honestly.
import OpenTimestamps from 'opentimestamps'
const { DetachedTimestampFile, Ops } = OpenTimestamps

export async function stampSha256(sha256hex) {
  try {
    const digest = Buffer.from(sha256hex, 'hex')
    const detached = DetachedTimestampFile.fromHash(new Ops.OpSHA256(), digest)
    await OpenTimestamps.stamp(detached)
    const ots = Buffer.from(detached.serializeToBytes())
    return { status: 'stamped (pending Bitcoin confirmation)', ots }
  } catch (e) {
    return { status: 'unavailable (calendar unreachable)', detail: String(e && e.message || e) }
  }
}

export async function verifyOts(sha256hex, otsBytes) {
  try {
    const digest = Buffer.from(sha256hex, 'hex')
    const detached = DetachedTimestampFile.deserialize([...otsBytes])
    const original = DetachedTimestampFile.fromHash(new Ops.OpSHA256(), digest)
    const res = await OpenTimestamps.verify(detached, original)
    const btc = res && (res.bitcoin || res.Bitcoin)
    if (btc && btc.timestamp) return { ok: true, status: 'confirmed', time: new Date(btc.timestamp * 1000).toISOString() }
    return { ok: true, status: 'pending (not yet in Bitcoin)' }
  } catch (e) {
    return { ok: false, status: 'verify error: ' + String(e && e.message || e) }
  }
}

// Fold a pending proof into a confirmed calendar proof (ultimately Bitcoin).
export async function upgradeOts(otsBytes) {
  try {
    const detached = DetachedTimestampFile.deserialize([...otsBytes])
    const changed = await OpenTimestamps.upgrade(detached)
    return { changed, ots: Buffer.from(detached.serializeToBytes()) }
  } catch (e) {
    return { changed: false, error: String(e && e.message || e) }
  }
}
