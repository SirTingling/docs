/**
 * Stale-chunk sweep for the takumo-docs-index Vectorize index.
 *
 * Side-effect free: no top-level I/O, no env reads, no process.exit. index-docs.mjs drives it with the real
 * Cloudflare API; scripts/index-docs.test.mjs drives it with fixtures (`node --test`).
 *
 * The sweep deletes vectors that the index lists but this run did not upsert (chunks of pages that changed or
 * were removed). Guards:
 *   - it refuses when the orphans exceed MAX_FRACTION of the listed ids (a partial upsert must never empty the
 *     index);
 *   - the real delete runs only with --expect <n>:<digest> equal to what a prior --dry-run printed: the orphan
 *     count and a digest of the exact orphan id set, so a run that would delete a different set refuses;
 *   - an empty listing or an empty upsert set refuses outright.
 */

import { createHash } from 'node:crypto'

export const MAX_FRACTION = 0.25
export const LIST_PAGE = 1000
export const DELETE_BATCH = 100

/** Parse the sweep flags from argv. Unknown flags are left to the caller. */
export function parseSweepArgs(argv) {
    const sweep = argv.includes('--sweep')
    const dryRun = argv.includes('--dry-run')
    let expect = null
    const i = argv.indexOf('--expect')
    if (i !== -1) {
        const raw = argv[i + 1]
        const m = raw === undefined ? null : /^(\d+):([0-9a-f]{12})$/.exec(raw)
        if (!m) {
            throw new Error(
                `--expect needs <count>:<digest> as printed by --sweep --dry-run, got ${raw === undefined ? 'nothing' : JSON.stringify(raw)}`,
            )
        }
        expect = { count: Number(m[1]), digest: m[2] }
    }
    if (!sweep && (dryRun || expect !== null)) {
        throw new Error('--dry-run and --expect only apply with --sweep')
    }
    if (sweep && !dryRun && expect === null) {
        throw new Error('a real sweep needs --expect <count>:<digest>, as printed by a --sweep --dry-run run')
    }
    return { sweep, dryRun, expect }
}

/**
 * Decide what to delete. Returns { orphans, refused } where refused is null or a reason string.
 * listedIds: every id the index lists. upsertedIds: every id this run upserted.
 */
export function planSweep({ listedIds, upsertedIds, maxFraction = MAX_FRACTION }) {
    if (!Array.isArray(listedIds) || !Array.isArray(upsertedIds)) {
        return { orphans: [], refused: 'listed and upserted ids must both be arrays' }
    }
    if (upsertedIds.length === 0) return { orphans: [], refused: 'this run upserted nothing' }
    if (listedIds.length === 0) return { orphans: [], refused: 'the index listing is empty' }
    const live = new Set(upsertedIds)
    const orphans = [...new Set(listedIds)].filter((id) => !live.has(id)).sort()
    const fraction = orphans.length / listedIds.length
    if (fraction > maxFraction) {
        return {
            orphans,
            refused: `${orphans.length} of ${listedIds.length} listed ids (${(fraction * 100).toFixed(1)}%) would be deleted, above the ${(maxFraction * 100).toFixed(0)}% limit`,
        }
    }
    return { orphans, refused: null }
}

/** 12 hex of sha256 over the sorted, de-duplicated orphan ids: binds --expect to the exact set. */
export function orphanDigest(orphans) {
    const ids = [...new Set(orphans)].sort()
    return createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 12)
}

/** The real delete runs only when --expect matches the planned orphan count and set exactly. */
export function checkExpect(orphans, expect) {
    if (expect === null || expect === undefined) return 'no --expect given'
    const digest = orphanDigest(orphans)
    if (expect.count !== orphans.length || expect.digest !== digest) {
        return `--expect ${expect.count}:${expect.digest} does not match the ${orphans.length} orphans planned now (${orphans.length}:${digest}); re-run --sweep --dry-run`
    }
    return null
}

/** The sweep only runs from a clean checkout of exactly origin/main, so it never deletes newer pages. */
export function checkoutRefusal({ head, originMain, porcelain }) {
    if (!head || !originMain) return 'cannot read HEAD or origin/main'
    if (head !== originMain) return `HEAD ${head.slice(0, 7)} is not origin/main ${originMain.slice(0, 7)}; fetch and check out origin/main first`
    if (porcelain.trim() !== '') return 'the working tree has uncommitted changes'
    return null
}

/**
 * Page through the index listing. fetchPage(cursor) resolves to the Vectorize v2 `result` object
 * ({ vectors: [{ id }], isTruncated, nextCursor }). Throws on a truncated page with no cursor, or on a loop.
 */
export async function listAllIds(fetchPage, { maxPages = 10000 } = {}) {
    const ids = []
    let cursor
    const seen = new Set()
    for (let page = 0; page < maxPages; page++) {
        const result = await fetchPage(cursor)
        if (!result || !Array.isArray(result.vectors)) throw new Error('list response has no vectors array')
        for (const v of result.vectors) ids.push(v.id)
        if (!result.isTruncated) return ids
        if (!result.nextCursor) throw new Error('list response is truncated but has no nextCursor')
        if (seen.has(result.nextCursor)) throw new Error('list cursor repeated')
        seen.add(result.nextCursor)
        cursor = result.nextCursor
    }
    throw new Error(`list did not finish within ${maxPages} pages`)
}

/** Split ids into delete batches. */
export function batches(ids, size = DELETE_BATCH) {
    const out = []
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
    return out
}
