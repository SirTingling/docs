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
 *   - the real delete runs only with --expect <n> equal to the orphan count a prior --dry-run printed;
 *   - an empty listing or an empty upsert set refuses outright.
 */

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
        if (raw === undefined || !/^\d+$/.test(raw)) {
            throw new Error(`--expect needs a non-negative integer, got ${raw === undefined ? 'nothing' : JSON.stringify(raw)}`)
        }
        expect = Number(raw)
    }
    if (!sweep && (dryRun || expect !== null)) {
        throw new Error('--dry-run and --expect only apply with --sweep')
    }
    if (sweep && !dryRun && expect === null) {
        throw new Error('a real sweep needs --expect <n>, the orphan count printed by a --sweep --dry-run run')
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

/** The real delete runs only when --expect matches the planned orphan count exactly. */
export function checkExpect(orphanCount, expect) {
    if (expect === null || expect === undefined) return 'no --expect given'
    if (expect !== orphanCount) return `--expect ${expect} does not match the ${orphanCount} orphans planned now; re-run --sweep --dry-run`
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
