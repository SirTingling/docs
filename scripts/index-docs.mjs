#!/usr/bin/env node
/**
 * Walk every .mdx file under the docs root, chunk by heading, embed each
 * chunk with Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5 → 768-dim),
 * and upsert into the takumo-docs-index Vectorize index.
 *
 * Used by .github/workflows/index-docs.yml on every push to main, and from
 * an operator's laptop:
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/index-docs.mjs
 *
 * The token needs:
 *   - Account → Workers AI → Read
 *   - Account → Vectorize → Edit
 *
 * Implementation notes (the boring but real choices):
 *
 * - Chunking is dumb-on-purpose: split on `## ` headings (with `# ` as a
 *   fallback for one-section pages), strip frontmatter and link/image
 *   syntax. Each chunk carries its title + section + URL as metadata so the
 *   assistant can render `[1]` citations into clickable deep-links.
 *
 * - Index name `takumo-docs-index` is hard-coded — same as in the Worker's
 *   wrangler.toml binding. Change in both places if you rename.
 *
 * - We upsert by content-hash IDs. A re-run with unchanged content is a
 *   no-op (same id, same vector → idempotent). When a page changes, the old
 *   chunks linger in the index until they expire — see the SWEEP_DELETIONS
 *   note below.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep, basename } from 'node:path'
import { createHash } from 'node:crypto'

const DOCS_ROOT = process.env.DOCS_ROOT ?? '.'
const SITE_BASE = (process.env.SITE_BASE ?? 'https://docs.takumo.io').replace(/\/$/, '')
const INDEX_NAME = process.env.VECTORIZE_INDEX ?? 'takumo-docs-index'
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'
const BATCH = 32 // embed up to N chunks per API call; Vectorize upsert batches of 1000

const accountId = required('CLOUDFLARE_ACCOUNT_ID')
const apiToken = required('CLOUDFLARE_API_TOKEN')

const cfBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}`
const cfHeaders = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
}

// ─── Walk + chunk ─────────────────────────────────────────────────────────

const mdxPaths = await listMdx(DOCS_ROOT)
console.log(`[index-docs] discovered ${mdxPaths.length} .mdx files`)

const chunks = []
for (const path of mdxPaths) {
    const raw = await readFile(path, 'utf8')
    const { title, body } = stripFrontmatter(raw)
    const url = mdxPathToUrl(path)
    for (const c of splitByH2(body, title)) {
        const text = sanitize(c.text)
        if (text.length < 40) continue // skip tiny stubs
        const id = sha1(`${url}#${c.section ?? ''}::${text}`).slice(0, 32)
        chunks.push({ id, url, title, section: c.section, text, kind: 'body' })

        // Synthetic question chunk for sections whose H2 reads like a verb
        // form (Creating, Using, Revoking, …). Embedded text is just the
        // synthetic question — no body — so it wins ranking when a user
        // types a natural-language "how do I X" query. Metadata still
        // points at the same URL + carries the original body text, so the
        // citation context the Worker shows Claude is unchanged.
        if (c.section) {
            const q = synthesizeQuestion(title, c.section)
            if (q) {
                const qId = sha1(`${url}#${c.section}::Q`).slice(0, 32)
                chunks.push({
                    id: qId,
                    url,
                    title,
                    section: c.section,
                    text,
                    kind: 'question',
                    embedText: q,
                })
            }
        }
    }
}
console.log(`[index-docs] produced ${chunks.length} chunks (incl. synthetic Qs)`)

if (chunks.length === 0) {
    console.error('[index-docs] no chunks; refusing to upsert')
    process.exit(1)
}

// ─── Embed + upsert ────────────────────────────────────────────────────────

let upserted = 0
for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH)
    // For body chunks: prepend the page title + section to the text we
    // embed so the vector captures "Creating a Token" semantics even when
    // the body is bare imperative steps. Metadata.text stays clean (no
    // prefix) so the citation context the Worker shows Claude reads like
    // docs prose.
    // For question chunks: embed the synthetic question alone.
    const vectors = await embedBatch(
        slice.map((c) => {
            if (c.kind === 'question') return c.embedText
            const heading = c.section ? `${c.title} — ${c.section}` : c.title
            return `${heading}\n\n${c.text}`
        }),
    )
    const payload = slice
        .map((c, j) => ({
            id: c.id,
            values: vectors[j],
            metadata: {
                title: c.title,
                section: c.section ?? '',
                url: c.url,
                // We store the raw text in metadata so the Worker can
                // surface it as the citation context without a second
                // round-trip. Vectorize allows up to 10kB per metadata
                // record; we already clip in `sanitize`.
                text: c.text,
            },
        }))
        .map((v) => JSON.stringify(v))
        .join('\n')
    await upsert(payload)
    upserted += slice.length
    console.log(`[index-docs] upserted ${upserted}/${chunks.length}`)
}

console.log(`[index-docs] done. ${upserted} vectors live in ${INDEX_NAME}.`)

// SWEEP_DELETIONS: when a page is deleted upstream, its chunks remain in the
// index. For a small docs site this is fine — they just stop matching as
// other pages surge in relevance. If/when it matters, add a cron Worker to
// fetch the full id list, diff against what we just wrote, and delete the
// orphans.

// ─── Helpers ──────────────────────────────────────────────────────────────

function required(name) {
    const v = process.env[name]
    if (!v) {
        console.error(`[index-docs] missing required env var ${name}`)
        process.exit(2)
    }
    return v
}

async function listMdx(root) {
    const out = []
    async function walk(dir) {
        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue
            const full = join(dir, e.name)
            if (e.isDirectory()) await walk(full)
            else if (e.isFile() && e.name.endsWith('.mdx')) out.push(full)
        }
    }
    await walk(root)
    return out
}

function stripFrontmatter(raw) {
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
    if (!m) return { title: null, body: raw }
    const yaml = m[1]
    const body = m[2]
    const titleMatch = yaml.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)
    return { title: titleMatch ? titleMatch[1] : null, body }
}

/**
 * Split body on H2 headings. The pre-H2 content (if any) becomes the
 * "intro" chunk with section=null; subsequent chunks are titled by their
 * heading. If the body has no H2 at all we yield a single chunk.
 */
function splitByH2(body, title) {
    const parts = body.split(/^##\s+(.+)$/m)
    const out = []
    if (parts[0].trim().length > 0) {
        out.push({ section: null, text: parts[0].trim() })
    }
    for (let i = 1; i < parts.length; i += 2) {
        const section = parts[i].trim()
        const text = (parts[i + 1] ?? '').trim()
        out.push({ section, text })
    }
    return out
}

/**
 * Strip MDX/JSX, links, images, callout components, code fences, table
 * pipes — the embedding model loves plain English; markup just adds noise
 * to the vector.
 */
function sanitize(s) {
    return s
        .replace(/<[A-Z][^>]*\/>/g, ' ') // self-closing JSX (e.g. <Card/>) → drop
        // Strip JSX tags BUT KEEP the inner text. The earlier version was
        // removing the entire paired component including its body, which
        // killed every step inside <Steps>...</Steps> + every accordion body.
        .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text only
        .replace(/[`*_~]/g, '') // inline markers
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000) // metadata cap; embedding model also caps around here
}

function mdxPathToUrl(p) {
    let rel = relative(DOCS_ROOT, p).split(sep).join('/')
    rel = rel.replace(/\.mdx$/, '')
    rel = rel.replace(/\/index$/, '')
    return rel === 'index' ? SITE_BASE : `${SITE_BASE}/${rel}`
}

function sha1(s) {
    return createHash('sha1').update(s).digest('hex')
}

// Gerund → infinitive mapping. Covers the verbs that show up in our docs
// sections; everything else falls through to no synthetic question.
const VERB_MAP = {
    creating: 'create',
    using: 'use',
    installing: 'install',
    configuring: 'configure',
    deploying: 'deploy',
    building: 'build',
    managing: 'manage',
    adding: 'add',
    removing: 'remove',
    revoking: 'revoke',
    rotating: 'rotate',
    updating: 'update',
    upgrading: 'upgrade',
    generating: 'generate',
    issuing: 'issue',
    setting: 'set',
    enabling: 'enable',
    disabling: 'disable',
    connecting: 'connect',
    integrating: 'integrate',
    migrating: 'migrate',
    deleting: 'delete',
    sending: 'send',
    handling: 'handle',
    publishing: 'publish',
    starting: 'start',
    running: 'run',
    customizing: 'customize',
    scanning: 'scan',
    monitoring: 'monitor',
    debugging: 'debug',
    testing: 'test',
}

function synthesizeQuestion(title, section) {
    // Section: "Creating a Token" → "How do I create a token in Title?"
    // Section: "Air-Gapped Deployments" → no transform (no gerund); skip
    const m = section.match(/^([A-Z][a-z]+)\b\s*(.*)$/)
    if (!m) return null
    const gerund = m[1].toLowerCase()
    const rest = m[2].trim()
    const verb = VERB_MAP[gerund]
    if (!verb) return null
    const tail = rest ? ` ${rest.toLowerCase()}` : ''
    return `How do I ${verb}${tail} in ${title}?`
}

async function embedBatch(texts) {
    const r = await fetch(`${cfBase}/ai/run/${EMBED_MODEL}`, {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({ text: texts }),
    })
    if (!r.ok) {
        const body = await r.text()
        throw new Error(`embed ${r.status}: ${body.slice(0, 200)}`)
    }
    const json = await r.json()
    if (!json.success) {
        throw new Error(`embed error: ${JSON.stringify(json.errors)}`)
    }
    return json.result.data
}

async function upsert(ndjson) {
    const r = await fetch(`${cfBase}/vectorize/v2/indexes/${INDEX_NAME}/upsert`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
    })
    if (!r.ok) {
        const body = await r.text()
        throw new Error(`upsert ${r.status}: ${body.slice(0, 200)}`)
    }
    const json = await r.json()
    if (!json.success) {
        throw new Error(`upsert error: ${JSON.stringify(json.errors)}`)
    }
}
