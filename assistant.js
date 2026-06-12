/* ─────────────────────────────────────────────────────────────────────────
 * Takumo docs assistant — chat drawer for docs.takumo.io
 *
 * Mintlify includes any `.js` file at the docs root on every page (see
 * https://mintlify.com/docs/settings/custom-scripts). This file ships the
 * full widget: a sparkle button bottom-right, a slide-in drawer with a chat
 * transcript, Cmd+I to toggle, streaming SSE from ai.takumo.io/v1/chat.
 *
 * Styling matches the takumo-frontend brand spec (CLAUDE.md):
 *   - Inter font (already loaded by Mintlify)
 *   - Indigo-500 (#6366F1) accent
 *   - bg-[#0a0a0a] surface, bg-white/[0.04] cards, border-white/[0.08]
 *   - Rounded-full buttons, transition-colors duration-150
 *
 * The widget is self-contained: no React, no bundler, no shadow DOM. We
 * scope every selector to `.takumo-assistant-*` so we can't collide with
 * Mintlify's own classes.
 * ─────────────────────────────────────────────────────────────────────── */

(function () {
    if (typeof window === 'undefined') return
    if (window.__takumoAssistantLoaded) return
    window.__takumoAssistantLoaded = true

    const ENDPOINT = 'https://ai.takumo.io/v1/chat'
    const HEALTH = 'https://ai.takumo.io/v1/health'
    const STORAGE_KEY = 'takumo:assistant:history'
    const HISTORY_LIMIT = 16

    // ─── State ──────────────────────────────────────────────────────────
    let open = false
    let busy = false
    let abortController = null
    let history = loadHistory()

    // ─── Styles ─────────────────────────────────────────────────────────
    const css = `
.takumo-assistant-trigger {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: #6366F1;
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9998;
    box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
    transition: transform 150ms ease, background-color 150ms ease;
    font-family: inherit;
}
.takumo-assistant-trigger:hover {
    background: #818CF8;
    transform: translateY(-1px);
}
.takumo-assistant-trigger svg { width: 18px; height: 18px; }

.takumo-assistant-drawer {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: min(420px, calc(100vw - 48px));
    height: min(640px, calc(100vh - 48px));
    background: #0a0a0a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 9999;
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(24px);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: rgba(255, 255, 255, 0.9);
}
.takumo-assistant-drawer.open { display: flex; }

.takumo-assistant-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.takumo-assistant-header-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.95);
}
.takumo-assistant-header-title svg { width: 14px; height: 14px; color: #818CF8; }

.takumo-assistant-header-actions {
    display: flex;
    gap: 4px;
}
.takumo-assistant-header-action {
    background: transparent;
    border: 0;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    transition: color 150ms ease, background-color 150ms ease;
    font-family: inherit;
}
.takumo-assistant-header-action:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.04);
}
.takumo-assistant-header-action svg { width: 14px; height: 14px; display: block; }

.takumo-assistant-transcript {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    scroll-behavior: smooth;
}
.takumo-assistant-transcript::-webkit-scrollbar { width: 6px; }
.takumo-assistant-transcript::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
}

.takumo-assistant-empty {
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    line-height: 1.55;
    padding: 6px 2px;
}
.takumo-assistant-empty strong {
    color: rgba(255, 255, 255, 0.85);
    font-weight: 600;
}
.takumo-assistant-suggestions {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.takumo-assistant-suggestion {
    text-align: left;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.75);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12.5px;
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
    font-family: inherit;
}
.takumo-assistant-suggestion:hover {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.95);
    border-color: rgba(255, 255, 255, 0.12);
}

.takumo-assistant-msg {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.takumo-assistant-msg-role {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.4);
}
.takumo-assistant-msg-body {
    font-size: 13px;
    line-height: 1.62;
    color: rgba(255, 255, 255, 0.85);
    white-space: pre-wrap;
    word-wrap: break-word;
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
    color: #818CF8;
    text-decoration: underline;
    text-decoration-color: rgba(129, 140, 248, 0.4);
    text-underline-offset: 2px;
}
.takumo-assistant-msg-body a:hover { color: #A5B4FC; }
.takumo-assistant-citation {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: rgba(99, 102, 241, 0.12);
    color: #A5B4FC;
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 600;
    margin: 0 1px;
    text-decoration: none;
    vertical-align: 1px;
    transition: background-color 150ms ease;
}
.takumo-assistant-citation:hover {
    background: rgba(99, 102, 241, 0.2);
}

.takumo-assistant-sources {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11.5px;
}
.takumo-assistant-source {
    color: rgba(255, 255, 255, 0.45);
    text-decoration: none;
    display: flex;
    gap: 6px;
    align-items: center;
    transition: color 150ms ease;
}
.takumo-assistant-source:hover { color: rgba(255, 255, 255, 0.9); }
.takumo-assistant-source-index {
    color: #A5B4FC;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.takumo-assistant-thinking {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
}
.takumo-assistant-thinking-dot {
    width: 4px;
    height: 4px;
    background: rgba(255, 255, 255, 0.4);
    border-radius: 999px;
    animation: takumo-pulse 1.2s ease-in-out infinite;
}
.takumo-assistant-thinking-dot:nth-child(2) { animation-delay: 0.15s; }
.takumo-assistant-thinking-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes takumo-pulse {
    0%, 80%, 100% { opacity: 0.2; }
    40% { opacity: 1; }
}

.takumo-assistant-input-wrap {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding: 14px 16px;
}
.takumo-assistant-input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
}
.takumo-assistant-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: 12px;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    resize: none;
    outline: none;
    max-height: 120px;
    transition: border-color 150ms ease, background-color 150ms ease;
}
.takumo-assistant-input::placeholder { color: rgba(255, 255, 255, 0.3); }
.takumo-assistant-input:focus {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(255, 255, 255, 0.06);
}
.takumo-assistant-send {
    background: #6366F1;
    color: #fff;
    border: 0;
    border-radius: 12px;
    width: 36px;
    height: 36px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 150ms ease;
    flex-shrink: 0;
    font-family: inherit;
}
.takumo-assistant-send:hover { background: #818CF8; }
.takumo-assistant-send:disabled {
    background: rgba(255, 255, 255, 0.08);
    cursor: not-allowed;
}
.takumo-assistant-send svg { width: 14px; height: 14px; }

.takumo-assistant-hint {
    margin-top: 8px;
    font-size: 10.5px;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.02em;
}
.takumo-assistant-hint kbd {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 1px 4px;
    font-family: inherit;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
}

.takumo-assistant-error {
    color: #FCA5A5;
    background: rgba(248, 113, 113, 0.06);
    border: 1px solid rgba(248, 113, 113, 0.16);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12.5px;
}
`

    // ─── Helpers ────────────────────────────────────────────────────────
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

    // Minimal markdown rendering. Mintlify already serves the docs as
    // HTML; here we just need to handle assistant output which is plain
    // markdown. We DO NOT enable arbitrary HTML — too easy to XSS via
    // a prompt-injected response.
    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    function renderMarkdown(md, citations) {
        let html = escapeHtml(md)
        // Code fences
        html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic
        html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        // Links
        html = html.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>',
        )
        // Citations [n] → linkified chips
        if (citations && citations.length) {
            html = html.replace(/\[(\d+)\]/g, (m, n) => {
                const idx = parseInt(n, 10)
                const cit = citations.find((c) => c.index === idx)
                if (!cit) return m
                return `<a class="takumo-assistant-citation" href="${cit.url}" target="_blank" rel="noopener" title="${escapeHtml(
                    cit.title + (cit.section ? ' — ' + cit.section : ''),
                )}">${idx}</a>`
            })
        }
        // Paragraphs (light — preserve line breaks)
        html = html.replace(/\n\n+/g, '\n')
        return html
    }

    function renderSources(citations) {
        if (!citations || !citations.length) return ''
        return (
            '<div class="takumo-assistant-sources">' +
            citations
                .slice(0, 5)
                .map(
                    (c) =>
                        `<a class="takumo-assistant-source" href="${c.url}" target="_blank" rel="noopener"><span class="takumo-assistant-source-index">${c.index}</span><span>${escapeHtml(
                            c.title + (c.section ? ' — ' + c.section : ''),
                        )}</span></a>`,
                )
                .join('') +
            '</div>'
        )
    }

    // ─── DOM construction ──────────────────────────────────────────────
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    const trigger = el(`
<button class="takumo-assistant-trigger" aria-label="Open Takumo docs assistant" title="Ask the docs (⌘I)">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m12 3-1.9 5.8L4.5 10l5.6 2.2L12 18l1.9-5.8L19.5 10l-5.6-2.2L12 3z"/>
    <path d="M5 21v-4"/>
    <path d="M3 19h4"/>
    <path d="M19 7V3"/>
    <path d="M17 5h4"/>
  </svg>
</button>`)

    const drawer = el(`
<div class="takumo-assistant-drawer" role="dialog" aria-label="Takumo docs assistant" aria-hidden="true">
  <div class="takumo-assistant-header">
    <div class="takumo-assistant-header-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8L4.5 10l5.6 2.2L12 18l1.9-5.8L19.5 10l-5.6-2.2L12 3z"/></svg>
      Ask the docs
    </div>
    <div class="takumo-assistant-header-actions">
      <button class="takumo-assistant-header-action" data-action="reset" title="Clear conversation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
      </button>
      <button class="takumo-assistant-header-action" data-action="close" title="Close (Esc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  </div>
  <div class="takumo-assistant-transcript"></div>
  <div class="takumo-assistant-input-wrap">
    <div class="takumo-assistant-input-row">
      <textarea class="takumo-assistant-input" rows="1" placeholder="Ask anything about Takumo…" aria-label="Ask the docs"></textarea>
      <button class="takumo-assistant-send" aria-label="Send" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
    </div>
    <div class="takumo-assistant-hint">Enter to send · <kbd>⌘</kbd>+<kbd>I</kbd> to toggle</div>
  </div>
</div>`)

    document.body.appendChild(trigger)
    document.body.appendChild(drawer)

    const transcript = drawer.querySelector('.takumo-assistant-transcript')
    const input = drawer.querySelector('.takumo-assistant-input')
    const sendBtn = drawer.querySelector('.takumo-assistant-send')

    // ─── Render ─────────────────────────────────────────────────────────
    const SUGGESTIONS = [
        'How do I install Aegis Shield on-prem?',
        'Where do I issue a deploy token?',
        'What does Sentinel scan for in pull requests?',
        'How does Brain Intelligence learn patterns?',
    ]

    function renderEmpty() {
        transcript.innerHTML = `
<div class="takumo-assistant-empty">
  <div><strong>Ask anything about Takumo.</strong> Answers cite the docs they came from — click a citation to jump straight in.</div>
  <div class="takumo-assistant-suggestions">
    ${SUGGESTIONS.map((s) => `<button class="takumo-assistant-suggestion">${escapeHtml(s)}</button>`).join('')}
  </div>
</div>`
        transcript.querySelectorAll('.takumo-assistant-suggestion').forEach((b, i) => {
            b.addEventListener('click', () => {
                input.value = SUGGESTIONS[i]
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

    function appendThinking() {
        const node = el(`
<div class="takumo-assistant-msg" data-pending>
  <div class="takumo-assistant-msg-role">Assistant</div>
  <div class="takumo-assistant-msg-body"><span class="takumo-assistant-thinking"><span class="takumo-assistant-thinking-dot"></span><span class="takumo-assistant-thinking-dot"></span><span class="takumo-assistant-thinking-dot"></span></span></div>
</div>`)
        transcript.appendChild(node)
        transcript.scrollTop = transcript.scrollHeight
        return node
    }

    function appendError(message) {
        const node = el(`<div class="takumo-assistant-error">${escapeHtml(message)}</div>`)
        transcript.appendChild(node)
        transcript.scrollTop = transcript.scrollHeight
    }

    // ─── Open / close ──────────────────────────────────────────────────
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

    // ─── Input handling ────────────────────────────────────────────────
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

    // ─── Send + stream ─────────────────────────────────────────────────
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
                pending.remove()
                appendError(
                    'The assistant is temporarily unavailable. You can browse the docs directly or email support@takumo.io.',
                )
                history.pop()
                return
            }
            if (r.status === 429) {
                pending.remove()
                appendError('Whoa — too many questions in a short window. Give it a minute and try again.')
                history.pop()
                return
            }
            if (!r.ok || !r.body) {
                pending.remove()
                appendError(`Couldn't reach the assistant (HTTP ${r.status}).`)
                history.pop()
                return
            }

            const decoder = new TextDecoder()
            const reader = r.body.getReader()
            let buffer = ''
            const body = pending.querySelector('.takumo-assistant-msg-body')

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
                        answer += parsed.value || ''
                        body.innerHTML = renderMarkdown(answer, citations)
                        if (citations) {
                            // Re-append sources every text delta — cheap, keeps the
                            // citation list visible while streaming.
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
                pending.remove()
                return
            }
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

    // ─── Boot ───────────────────────────────────────────────────────────
    // If ai.takumo.io is health-down (AUTH_MODE=off in the Worker), hide the
    // trigger entirely so the user never sees a button that returns an error.
    fetch(HEALTH, { method: 'GET' })
        .then((r) => r.json())
        .then((info) => {
            if (!info?.ok || info.mode === 'off') {
                trigger.remove()
                drawer.remove()
            }
        })
        .catch(() => {
            // Network error — leave the trigger up; user will get a clean
            // error message in the drawer if they actually try to chat.
        })
})()
