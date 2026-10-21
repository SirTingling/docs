// Tests for the stale-chunk sweep (scripts/index-docs-sweep.mjs). Run: node --test scripts/index-docs.test.mjs
// Fixture ids only; nothing here touches the network or the production index.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSweepArgs, planSweep, checkExpect, checkoutRefusal, orphanDigest, listAllIds, batches, MAX_FRACTION } from './index-docs-sweep.mjs'

const live = Array.from({ length: 20 }, (_, i) => `live-${String(i).padStart(2, '0')}`)

test('a planted orphan is in the delete list and live ids are not', () => {
    const { orphans, refused } = planSweep({ listedIds: [...live, 'orphan-a'], upsertedIds: live })
    assert.equal(refused, null)
    assert.deepEqual(orphans, ['orphan-a'])
    for (const id of live) assert.ok(!orphans.includes(id), `${id} must not be deleted`)
})

test('nothing to delete when the index holds exactly what was upserted', () => {
    assert.deepEqual(planSweep({ listedIds: live, upsertedIds: live }), { orphans: [], refused: null })
})

test('a 30% diff refuses (a partial upsert must never empty the index)', () => {
    const listed = [...live.slice(0, 14), 'o1', 'o2', 'o3', 'o4', 'o5', 'o6'] // 6 of 20 = 30%
    const { orphans, refused } = planSweep({ listedIds: listed, upsertedIds: live.slice(0, 14) })
    assert.equal(orphans.length, 6)
    assert.match(refused, /30\.0%.*above the 25% limit/)
})

test('exactly 25% is allowed; just over is refused', () => {
    const upserted = live.slice(0, 15)
    const at = planSweep({ listedIds: [...upserted, 'a', 'b', 'c', 'd', 'e'], upsertedIds: upserted }) // 5 of 20
    assert.equal(at.refused, null)
    const over = planSweep({ listedIds: [...upserted, 'a', 'b', 'c', 'd', 'e', 'f'], upsertedIds: upserted }) // 6 of 21
    assert.ok(6 / 21 > MAX_FRACTION)
    assert.notEqual(over.refused, null)
})

test('empty upsert set or empty listing refuses outright', () => {
    assert.match(planSweep({ listedIds: live, upsertedIds: [] }).refused, /upserted nothing/)
    assert.match(planSweep({ listedIds: [], upsertedIds: live }).refused, /listing is empty/)
})

test('a wrong --expect refuses (count or set); the right one passes', () => {
    const orphans = ['o1', 'o2', 'o3']
    const digest = orphanDigest(orphans)
    assert.match(digest, /^[0-9a-f]{12}$/)
    assert.equal(orphanDigest(['o3', 'o1', 'o2', 'o1']), digest, 'order and duplicates do not change the digest')
    assert.match(checkExpect(orphans, { count: 4, digest }), /does not match the 3 orphans/)
    assert.match(checkExpect(['o1', 'o2', 'live-07'], { count: 3, digest }), /does not match/, 'same count, different set')
    assert.match(checkExpect(orphans, null), /no --expect/)
    assert.equal(checkExpect(orphans, { count: 3, digest }), null)
    assert.equal(checkExpect([], { count: 0, digest: orphanDigest([]) }), null)
})

test('the sweep refuses any checkout other than a clean origin/main', () => {
    const sha = 'a'.repeat(40)
    assert.equal(checkoutRefusal({ head: sha, originMain: sha, porcelain: '' }), null)
    assert.match(checkoutRefusal({ head: sha, originMain: 'b'.repeat(40), porcelain: '' }), /is not origin\/main/)
    assert.match(checkoutRefusal({ head: sha, originMain: sha, porcelain: ' M installation.mdx\n' }), /uncommitted/)
    assert.match(checkoutRefusal({ head: '', originMain: sha, porcelain: '' }), /cannot read/)
})

test('flags: a real sweep needs --expect; --expect must be an integer; --dry-run needs --sweep', () => {
    assert.deepEqual(parseSweepArgs([]), { sweep: false, dryRun: false, expect: null })
    assert.deepEqual(parseSweepArgs(['--sweep', '--dry-run']), { sweep: true, dryRun: true, expect: null })
    assert.deepEqual(parseSweepArgs(['--sweep', '--expect', '7:0123456789ab']), {
        sweep: true,
        dryRun: false,
        expect: { count: 7, digest: '0123456789ab' },
    })
    assert.throws(() => parseSweepArgs(['--sweep']), /needs --expect/)
    assert.throws(() => parseSweepArgs(['--sweep', '--expect', '7']), /<count>:<digest>/)
    assert.throws(() => parseSweepArgs(['--sweep', '--expect', 'x']), /<count>:<digest>/)
    assert.throws(() => parseSweepArgs(['--sweep', '--expect']), /<count>:<digest>/)
    assert.throws(() => parseSweepArgs(['--dry-run']), /only apply with --sweep/)
})

test('listing follows nextCursor while isTruncated and fails on a broken page', async () => {
    const pages = {
        undefined: { vectors: [{ id: 'a' }, { id: 'b' }], isTruncated: true, nextCursor: 'c1' },
        c1: { vectors: [{ id: 'c' }], isTruncated: true, nextCursor: 'c2' },
        c2: { vectors: [{ id: 'd' }], isTruncated: false },
    }
    const seen = []
    const ids = await listAllIds(async (cursor) => {
        seen.push(cursor)
        return pages[String(cursor)]
    })
    assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
    assert.deepEqual(seen, [undefined, 'c1', 'c2'])
    await assert.rejects(listAllIds(async () => ({ vectors: [], isTruncated: true })), /no nextCursor/)
    await assert.rejects(listAllIds(async () => ({ vectors: [], isTruncated: true, nextCursor: 'same' })), /repeated/)
    await assert.rejects(listAllIds(async () => ({})), /no vectors array/)
})

test('delete batches cover every id once', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `x${i}`)
    const b = batches(ids, 100)
    assert.deepEqual(b.map((x) => x.length), [100, 100, 50])
    assert.deepEqual(b.flat(), ids)
})
