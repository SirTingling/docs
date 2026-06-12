/* Takumo docs assistant. Chat drawer for docs.takumo.io.
 *
 * Mintlify auto-includes every .js file at the docs root on every page.
 * This widget is self-contained: no React, no bundler, no shadow DOM. Every
 * selector is scoped to .takumo-assistant-* so it can't collide with Mintlify.
 *
 * Brand spec from takumo-frontend/CLAUDE.md:
 *   Inter font (loaded by Mintlify), indigo-500 accent (#6366F1),
 *   bg-[#0a0a0a] surface, bg-white/[0.04] cards, border-white/[0.08],
 *   rounded-2xl containers, transition-colors duration-150.
 */

(function () {
    if (typeof window === 'undefined') return
    if (window.__takumoAssistantLoaded) return
    window.__takumoAssistantLoaded = true

    const ENDPOINT = 'https://ai.takumo.io/v1/chat'
    const HEALTH = 'https://ai.takumo.io/v1/health'
    const STORAGE_KEY = 'takumo:assistant:history'
    const HISTORY_LIMIT = 16

    let open = false
    let busy = false
    let abortController = null
    let history = loadHistory()

    const css = `
@keyframes ta-shimmer {
    from { background-position: 100% center; }
    to { background-position: 0% center; }
}
@keyframes ta-drawer-in {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ta-trigger-glow {
    0%, 100% { box-shadow: 0 8px 32px rgba(99, 102, 241, 0.32), 0 0 0 0 rgba(99, 102, 241, 0.4); }
    50%      { box-shadow: 0 8px 32px rgba(99, 102, 241, 0.48), 0 0 0 6px rgba(99, 102, 241, 0); }
}
@keyframes ta-msg-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes ta-chip-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}

.takumo-assistant-trigger {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    border-radius: 999px;
    background: radial-gradient(circle at 30% 30%, #818CF8, #6366F1 60%, #4F46E5 100%);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9998;
    animation: ta-trigger-glow 2.6s ease-in-out infinite;
    transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), background 150ms ease;
    font-family: inherit;
    padding: 0;
}
.takumo-assistant-trigger:hover {
    transform: translateY(-2px) scale(1.04);
    background: radial-gradient(circle at 30% 30%, #A5B4FC, #818CF8 60%, #6366F1 100%);
}
.takumo-assistant-trigger:active { transform: scale(0.97); }
.takumo-assistant-trigger svg { width: 22px; height: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); }

.takumo-assistant-drawer {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: min(440px, calc(100vw - 48px));
    height: min(680px, calc(100vh - 48px));
    background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99, 102, 241, 0.08), transparent 60%),
        linear-gradient(180deg, #111114 0%, #0a0a0a 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 9999;
    box-shadow:
        0 32px 80px rgba(0, 0, 0, 0.6),
        0 0 0 1px rgba(255, 255, 255, 0.02) inset,
        0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
    backdrop-filter: blur(24px);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: rgba(255, 255, 255, 0.92);
}
.takumo-assistant-drawer.open {
    display: flex;
    animation: ta-drawer-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.takumo-assistant-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.takumo-assistant-header-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgba(255, 255, 255, 0.96);
}
.takumo-assistant-header-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, rgba(129, 140, 248, 0.18), rgba(99, 102, 241, 0.08));
    border: 1px solid rgba(129, 140, 248, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
}
.takumo-assistant-header-icon svg { width: 14px; height: 14px; color: #A5B4FC; }

.takumo-assistant-header-actions { display: flex; gap: 4px; }
.takumo-assistant-header-action {
    background: transparent;
    border: 0;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 7px;
    border-radius: 8px;
    transition: color 150ms ease, background-color 150ms ease;
    font-family: inherit;
}
.takumo-assistant-header-action:hover {
    color: rgba(255, 255, 255, 0.95);
    background: rgba(255, 255, 255, 0.05);
}
.takumo-assistant-header-action svg { width: 14px; height: 14px; display: block; }

.takumo-assistant-transcript {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scroll-behavior: smooth;
}
.takumo-assistant-transcript::-webkit-scrollbar { width: 6px; }
.takumo-assistant-transcript::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
}

.takumo-assistant-empty {
    color: rgba(255, 255, 255, 0.55);
    font-size: 13.5px;
    line-height: 1.6;
    padding: 6px 2px;
}
.takumo-assistant-empty strong {
    color: rgba(255, 255, 255, 0.95);
    font-weight: 600;
}
.takumo-assistant-suggestions {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.takumo-assistant-suggestion {
    text-align: left;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.78);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.4;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: transform 150ms ease, background-color 150ms ease, color 150ms ease, border-color 150ms ease;
    font-family: inherit;
    animation: ta-chip-in 280ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
.takumo-assistant-suggestion:nth-child(1) { animation-delay: 60ms; }
.takumo-assistant-suggestion:nth-child(2) { animation-delay: 100ms; }
.takumo-assistant-suggestion:nth-child(3) { animation-delay: 140ms; }
.takumo-assistant-suggestion:nth-child(4) { animation-delay: 180ms; }
.takumo-assistant-suggestion svg {
    width: 14px;
    height: 14px;
    color: rgba(129, 140, 248, 0.7);
    flex-shrink: 0;
    transition: color 150ms ease;
}
.takumo-assistant-suggestion:hover {
    background: rgba(99, 102, 241, 0.08);
    color: rgba(255, 255, 255, 0.98);
    border-color: rgba(129, 140, 248, 0.32);
    transform: translateY(-1px);
}
.takumo-assistant-suggestion:hover svg { color: #A5B4FC; }

.takumo-assistant-msg {
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: ta-msg-in 200ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
.takumo-assistant-msg-role {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    font-weight: 500;
}
.takumo-assistant-msg-body {
    font-size: 13.5px;
    line-height: 1.62;
    color: rgba(255, 255, 255, 0.88);
    word-wrap: break-word;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.takumo-assistant-msg-body > * { margin: 0; }
.takumo-assistant-msg-body h2,
.takumo-assistant-msg-body h3,
.takumo-assistant-msg-body h4 {
    font-size: 13.5px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.96);
    margin-top: 6px;
    letter-spacing: -0.005em;
}
.takumo-assistant-msg-body h2:first-child,
.takumo-assistant-msg-body h3:first-child,
.takumo-assistant-msg-body h4:first-child { margin-top: 0; }
.takumo-assistant-msg-body h2 { font-size: 14.5px; }
.takumo-assistant-msg-body hr {
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 8px 0;
}
.takumo-assistant-msg-body .ta-bullet {
    display: flex;
    gap: 10px;
    padding-left: 2px;
}
.takumo-assistant-msg-body .ta-bullet-dot {
    flex-shrink: 0;
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: rgba(165, 180, 252, 0.7);
    margin-top: 8px;
}
.takumo-assistant-msg-body .ta-numbered {
    display: flex;
    gap: 10px;
    padding-left: 2px;
}
.takumo-assistant-msg-body .ta-numbered-marker {
    flex-shrink: 0;
    color: rgba(165, 180, 252, 0.8);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    min-width: 16px;
}
.takumo-assistant-msg-body code {
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
}
.takumo-assistant-msg-body pre {
    background: #0c0c0e;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 12px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    line-height: 1.55;
    margin: 8px 0;
}
.takumo-assistant-msg-body a {
    color: #A5B4FC;
    text-decoration: underline;
    text-decoration-color: rgba(129, 140, 248, 0.4);
    text-underline-offset: 2px;
}
.takumo-assistant-msg-body a:hover { color: #C7D2FE; }
.takumo-assistant-citation {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    background: linear-gradient(180deg, rgba(99, 102, 241, 0.18), rgba(99, 102, 241, 0.1));
    color: #C7D2FE;
    border: 1px solid rgba(99, 102, 241, 0.28);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    margin: 0 1px;
    text-decoration: none;
    vertical-align: 1px;
    transition: all 150ms ease;
}
.takumo-assistant-citation:hover {
    background: linear-gradient(180deg, rgba(99, 102, 241, 0.3), rgba(99, 102, 241, 0.18));
    border-color: rgba(99, 102, 241, 0.5);
    color: #fff;
}

.takumo-assistant-sources {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11.5px;
}
.takumo-assistant-source {
    color: rgba(255, 255, 255, 0.5);
    text-decoration: none;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
    transition: color 150ms ease;
}
.takumo-assistant-source:hover { color: rgba(255, 255, 255, 0.95); }
.takumo-assistant-source-index {
    color: #A5B4FC;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 14px;
}

.takumo-assistant-shimmer {
    display: inline-block;
    font-size: 13px;
    background-size: 250% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    background-image: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.32) 0%,
        rgba(255, 255, 255, 0.32) 40%,
        rgba(255, 255, 255, 0.95) 50%,
        rgba(255, 255, 255, 0.32) 60%,
        rgba(255, 255, 255, 0.32) 100%
    );
    background-repeat: no-repeat;
    animation: ta-shimmer 2s linear infinite;
}

.takumo-assistant-input-wrap {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding: 16px 18px;
}
.takumo-assistant-input-shell {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 10px 10px 10px 14px;
    transition: border-color 150ms ease, background-color 150ms ease, box-shadow 200ms ease;
}
.takumo-assistant-input-shell:focus-within {
    border-color: rgba(129, 140, 248, 0.45);
    background: rgba(99, 102, 241, 0.04);
    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.08);
}
.takumo-assistant-input {
    flex: 1;
    background: transparent;
    border: 0;
    color: #fff;
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    resize: none;
    outline: none;
    max-height: 120px;
    padding: 4px 0;
}
.takumo-assistant-input::placeholder { color: rgba(255, 255, 255, 0.32); }
.takumo-assistant-send {
    background: linear-gradient(180deg, #818CF8, #6366F1);
    color: #fff;
    border: 0;
    border-radius: 12px;
    width: 36px;
    height: 36px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), background 150ms ease, box-shadow 150ms ease;
    flex-shrink: 0;
    font-family: inherit;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.32);
}
.takumo-assistant-send:hover {
    background: linear-gradient(180deg, #A5B4FC, #818CF8);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}
.takumo-assistant-send:active { transform: scale(0.96); }
.takumo-assistant-send:disabled {
    background: rgba(255, 255, 255, 0.06);
    box-shadow: none;
    cursor: not-allowed;
    transform: none;
}
.takumo-assistant-send svg { width: 14px; height: 14px; }

.takumo-assistant-hint {
    margin-top: 10px;
    font-size: 10.5px;
    color: rgba(255, 255, 255, 0.32);
    letter-spacing: 0.02em;
}
.takumo-assistant-hint kbd {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 1.5px 5px;
    font-family: inherit;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.55);
    margin: 0 1px;
}

.takumo-assistant-error {
    color: #FCA5A5;
    background: rgba(248, 113, 113, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.18);
    border-radius: 12px;
    padding: 11px 14px;
    font-size: 12.5px;
    line-height: 1.5;
}
`

    function el(html) {
        const t = document.createElement('template')
        t.innerHTML = html.trim()
        return t.content.firstChild
    }

    function loadHistory() {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY)
            if (!stored) return []
            const parsed = JSON.parse(stored)
            return Array.isArray(parsed) ? parsed.slice(-HISTORY_LIMIT) : []
        } catch {
            return []
        }
    }

    function saveHistory() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)))
        } catch {}
    }

    function clearHistory() {
        history = []
        try {
            sessionStorage.removeItem(STORAGE_KEY)
        } catch {}
    }

    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    // Inline formatting (bold, italic, code, links, citations) on already-
    // escaped text. Pulled out so the line-by-line block renderer can apply
    // it to header / list / paragraph content uniformly.
    function renderInline(escaped, citations) {
        let s = escaped
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        s = s.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>',
        )
        if (citations && citations.length) {
            s = s.replace(/\[(\d+)\]/g, (m, n) => {
                const idx = parseInt(n, 10)
                const cit = citations.find((c) => c.index === idx)
                if (!cit) return m
                const label = cit.title + (cit.section ? ' / ' + cit.section : '')
                return `<a class="takumo-assistant-citation" href="${cit.url}" target="_blank" rel="noopener" title="${escapeHtml(label)}">${idx}</a>`
            })
        }
        return s
    }

    // Block-level renderer: escape, pull fenced code out, then walk the
    // remaining lines and turn headers / bullets / numbered lists / hrs /
    // paragraphs into their respective elements. Inline formatting is
    // applied to each block's content via renderInline. Pattern mirrors
    // Pluvel's MessageContent but emits HTML strings instead of JSX so we
    // stay vanilla.
    function renderMarkdown(md, citations) {
        const fences = []
        const withoutFences = md.replace(/```([\s\S]*?)```/g, (_, code) => {
            const i = fences.length
            fences.push(`<pre><code>${escapeHtml(code.replace(/^\n/, ''))}</code></pre>`)
            return ` FENCE${i} `
        })

        const lines = withoutFences.split('\n')
        const out = []
        let buffer = []

        const flushParagraph = () => {
            if (buffer.length === 0) return
            const joined = escapeHtml(buffer.join(' ').trim())
            if (joined) out.push('<p>' + renderInline(joined, citations) + '</p>')
            buffer = []
        }

        for (const raw of lines) {
            const line = raw.replace(/\s+$/, '')

            const fenceMatch = line.match(/^ FENCE(\d+) $/)
            if (fenceMatch) {
                flushParagraph()
                out.push(fences[parseInt(fenceMatch[1], 10)])
                continue
            }

            if (!line.trim()) {
                flushParagraph()
                continue
            }

            if (line.trim() === '---' || line.trim() === '***') {
                flushParagraph()
                out.push('<hr/>')
                continue
            }

            const h3 = line.match(/^###\s+(.+)$/)
            const h2 = line.match(/^##\s+(.+)$/)
            const h1 = line.match(/^#\s+(.+)$/)
            if (h3) {
                flushParagraph()
                out.push('<h4>' + renderInline(escapeHtml(h3[1]), citations) + '</h4>')
                continue
            }
            if (h2) {
                flushParagraph()
                out.push('<h3>' + renderInline(escapeHtml(h2[1]), citations) + '</h3>')
                continue
            }
            if (h1) {
                flushParagraph()
                out.push('<h2>' + renderInline(escapeHtml(h1[1]), citations) + '</h2>')
                continue
            }

            const bullet = line.match(/^[-*•]\s+(.+)$/)
            if (bullet) {
                flushParagraph()
                out.push(
                    '<div class="ta-bullet"><span class="ta-bullet-dot"></span><span>' +
                        renderInline(escapeHtml(bullet[1]), citations) +
                        '</span></div>',
                )
                continue
            }

            const numbered = line.match(/^(\d+)\.\s+(.+)$/)
            if (numbered) {
                flushParagraph()
                out.push(
                    '<div class="ta-numbered"><span class="ta-numbered-marker">' +
                        numbered[1] +
                        '.</span><span>' +
                        renderInline(escapeHtml(numbered[2]), citations) +
                        '</span></div>',
                )
                continue
            }

            buffer.push(line)
        }
        flushParagraph()

        return out.join('')
    }

    function renderSources(citations) {
        if (!citations || !citations.length) return ''
        return (
            '<div class="takumo-assistant-sources">' +
            citations
                .slice(0, 5)
                .map(
                    (c) =>
                        `<a class="takumo-assistant-source" href="${c.url}" target="_blank" rel="noopener"><span class="takumo-assistant-source-index">${c.index}</span><span>${escapeHtml(c.title + (c.section ? ' / ' + c.section : ''))}</span></a>`,
                )
                .join('') +
            '</div>'
        )
    }

    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    // Refined Sparkles icon. The classic four-pointed star paired with a
    // smaller star for depth — same family as the cns-docs trigger but
    // single-stroke so it renders cleanly at 22px.
    const SPARKLES_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><path d="M12 7.5l1.4 3.1L16.5 12l-3.1 1.4L12 16.5l-1.4-3.1L7.5 12l3.1-1.4L12 7.5z" fill="currentColor" fill-opacity="0.25"/></svg>`

    const trigger = el(`
<button class="takumo-assistant-trigger" aria-label="Open Takumo docs assistant" title="Ask the docs">${SPARKLES_SVG}</button>`)

    const drawer = el(`
<div class="takumo-assistant-drawer" role="dialog" aria-label="Takumo docs assistant" aria-hidden="true">
  <div class="takumo-assistant-header">
    <div class="takumo-assistant-header-title">
      <div class="takumo-assistant-header-icon">${SPARKLES_SVG}</div>
      Ask the docs
    </div>
    <div class="takumo-assistant-header-actions">
      <button class="takumo-assistant-header-action" data-action="reset" title="Clear conversation" aria-label="Clear conversation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
      </button>
      <button class="takumo-assistant-header-action" data-action="close" title="Close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  </div>
  <div class="takumo-assistant-transcript"></div>
  <div class="takumo-assistant-input-wrap">
    <div class="takumo-assistant-input-shell">
      <textarea class="takumo-assistant-input" rows="1" placeholder="Ask anything about Takumo..." aria-label="Ask the docs"></textarea>
      <button class="takumo-assistant-send" aria-label="Send" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
    </div>
    <div class="takumo-assistant-hint">Enter to send. <kbd>⌘</kbd><kbd>I</kbd> to toggle.</div>
  </div>
</div>`)

    document.body.appendChild(trigger)
    document.body.appendChild(drawer)

    const transcript = drawer.querySelector('.takumo-assistant-transcript')
    const input = drawer.querySelector('.takumo-assistant-input')
    const sendBtn = drawer.querySelector('.takumo-assistant-send')

    // Suggested starter questions. Each pairs an icon with copy that reads
    // like a real user question. No connectors in the copy.
    const SUGGESTIONS = [
        { icon: 'install', text: 'How do I install Aegis Shield on-prem?' },
        { icon: 'key', text: 'Where do I issue a deploy token?' },
        { icon: 'scan', text: 'What does Sentinel scan for in pull requests?' },
        { icon: 'brain', text: 'How does Brain Intelligence learn patterns?' },
    ]

    const ICONS = {
        install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
        key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
        scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>',
        brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>',
    }

    function renderEmpty() {
        transcript.innerHTML = `
<div class="takumo-assistant-empty">
  <div><strong>Ask anything about Takumo.</strong> Answers cite the docs they came from. Click a citation to jump straight in.</div>
  <div class="takumo-assistant-suggestions">
    ${SUGGESTIONS.map((s) => `<button class="takumo-assistant-suggestion">${ICONS[s.icon]}<span>${escapeHtml(s.text)}</span></button>`).join('')}
  </div>
</div>`
        transcript.querySelectorAll('.takumo-assistant-suggestion').forEach((b, i) => {
            b.addEventListener('click', () => {
                input.value = SUGGESTIONS[i].text
                input.dispatchEvent(new Event('input'))
                send()
            })
        })
    }

    function renderTranscript() {
        if (history.length === 0) {
            renderEmpty()
            return
        }
        transcript.innerHTML = history
            .map(
                (m) => `
<div class="takumo-assistant-msg">
  <div class="takumo-assistant-msg-role">${m.role === 'user' ? 'You' : 'Assistant'}</div>
  <div class="takumo-assistant-msg-body">${renderMarkdown(m.content, m.citations)}</div>
  ${m.role === 'assistant' ? renderSources(m.citations) : ''}
</div>`,
            )
            .join('')
        transcript.scrollTop = transcript.scrollHeight
    }

    // Shimmer-text loading state. Cycles through three short phrases while
    // the upstream answer streams. Replaces the dots animation.
    function appendThinking() {
        const node = el(`
<div class="takumo-assistant-msg" data-pending>
  <div class="takumo-assistant-msg-role">Assistant</div>
  <div class="takumo-assistant-msg-body"><span class="takumo-assistant-shimmer">Reading the docs...</span></div>
</div>`)
        transcript.appendChild(node)
        transcript.scrollTop = transcript.scrollHeight
        const shimmer = node.querySelector('.takumo-assistant-shimmer')
        const phrases = ['Reading the docs...', 'Finding the right page...', 'Writing your answer...']
        let i = 0
        const interval = setInterval(() => {
            i = (i + 1) % phrases.length
            if (shimmer.isConnected) shimmer.textContent = phrases[i]
            else clearInterval(interval)
        }, 1800)
        node.__cleanup = () => clearInterval(interval)
        return node
    }

    function appendError(message) {
        const node = el(`<div class="takumo-assistant-error">${escapeHtml(message)}</div>`)
        transcript.appendChild(node)
        transcript.scrollTop = transcript.scrollHeight
    }

    function setOpen(next) {
        open = next
        drawer.classList.toggle('open', open)
        drawer.setAttribute('aria-hidden', open ? 'false' : 'true')
        trigger.style.display = open ? 'none' : 'flex'
        if (open) {
            setTimeout(() => input.focus(), 50)
            renderTranscript()
        }
    }

    function reset() {
        if (busy && abortController) abortController.abort()
        busy = false
        clearHistory()
        renderTranscript()
        input.value = ''
        autosize()
        updateSendState()
    }

    trigger.addEventListener('click', () => setOpen(true))
    drawer.querySelector('[data-action="close"]').addEventListener('click', () => setOpen(false))
    drawer.querySelector('[data-action="reset"]').addEventListener('click', reset)

    document.addEventListener('keydown', (e) => {
        const meta = e.metaKey || e.ctrlKey
        if (meta && (e.key === 'i' || e.key === 'I')) {
            e.preventDefault()
            setOpen(!open)
        } else if (e.key === 'Escape' && open) {
            setOpen(false)
        }
    })

    // Close on outside click. Mousedown so it feels snappier than click,
    // and so a drag started inside the drawer can't immediately close it.
    document.addEventListener('mousedown', (e) => {
        if (!open) return
        if (drawer.contains(e.target) || trigger.contains(e.target)) return
        setOpen(false)
    })

    function autosize() {
        input.style.height = 'auto'
        input.style.height = Math.min(120, input.scrollHeight) + 'px'
    }
    function updateSendState() {
        sendBtn.disabled = input.value.trim().length === 0 || busy
    }
    input.addEventListener('input', () => {
        autosize()
        updateSendState()
    })
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!sendBtn.disabled) send()
        }
    })
    sendBtn.addEventListener('click', send)

    async function send() {
        const text = input.value.trim()
        if (!text || busy) return
        busy = true
        updateSendState()

        history.push({ role: 'user', content: text })
        saveHistory()
        input.value = ''
        autosize()
        renderTranscript()

        const pending = appendThinking()
        let answer = ''
        let citations = null

        abortController = new AbortController()
        try {
            const r = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: history.slice(-HISTORY_LIMIT).map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
                }),
                signal: abortController.signal,
            })

            if (r.status === 503) {
                if (pending.__cleanup) pending.__cleanup()
                pending.remove()
                appendError('The assistant is temporarily unavailable. Browse the docs directly or email support@takumo.io.')
                history.pop()
                return
            }
            if (r.status === 429) {
                if (pending.__cleanup) pending.__cleanup()
                pending.remove()
                appendError('Too many questions in a short window. Give it a minute and try again.')
                history.pop()
                return
            }
            if (!r.ok || !r.body) {
                if (pending.__cleanup) pending.__cleanup()
                pending.remove()
                appendError("Couldn't reach the assistant (HTTP " + r.status + ').')
                history.pop()
                return
            }

            const decoder = new TextDecoder()
            const reader = r.body.getReader()
            let buffer = ''
            let body = null

            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                let idx
                while ((idx = buffer.indexOf('\n\n')) !== -1) {
                    const event = buffer.slice(0, idx).trim()
                    buffer = buffer.slice(idx + 2)
                    if (!event.startsWith('data:')) continue
                    let parsed
                    try {
                        parsed = JSON.parse(event.slice(5).trim())
                    } catch {
                        continue
                    }
                    if (parsed.type === 'context') {
                        citations = parsed.chunks || []
                    } else if (parsed.type === 'text') {
                        if (!body) {
                            if (pending.__cleanup) pending.__cleanup()
                            pending.querySelector('.takumo-assistant-msg-body').innerHTML = ''
                            body = pending.querySelector('.takumo-assistant-msg-body')
                        }
                        answer += parsed.value || ''
                        body.innerHTML = renderMarkdown(answer, citations)
                        if (citations) {
                            const existing = pending.querySelector('.takumo-assistant-sources')
                            if (existing) existing.remove()
                            pending.insertAdjacentHTML('beforeend', renderSources(citations))
                        }
                        transcript.scrollTop = transcript.scrollHeight
                    } else if (parsed.type === 'error') {
                        appendError(parsed.value || 'Assistant error.')
                    }
                }
            }

            if (answer.trim().length === 0) {
                if (pending.__cleanup) pending.__cleanup()
                pending.remove()
                appendError('The assistant returned an empty response. Try rephrasing your question.')
                history.pop()
            } else {
                pending.removeAttribute('data-pending')
                history.push({ role: 'assistant', content: answer, citations: citations || [] })
                saveHistory()
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                if (pending.__cleanup) pending.__cleanup()
                pending.remove()
                return
            }
            if (pending.__cleanup) pending.__cleanup()
            pending.remove()
            appendError("Couldn't reach the assistant. Check your network connection and try again.")
            history.pop()
        } finally {
            busy = false
            abortController = null
            updateSendState()
            input.focus()
        }
    }

    // Hide the trigger when the Worker reports mode=off so users don't see
    // a button that returns errors.
    fetch(HEALTH, { method: 'GET' })
        .then((r) => r.json())
        .then((info) => {
            if (!info?.ok || info.mode === 'off') {
                trigger.remove()
                drawer.remove()
            }
        })
        .catch(() => {})
})()
