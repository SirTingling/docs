<p align="center">
  <img src="logo/favicon.svg" height="80" alt="Takumo" />
</p>

<h1 align="center">Takumo Docs</h1>

<p align="center">
  <strong>Your secrets stay on your machine.</strong>
</p>

<p align="center">
  <a href="https://docs.takumo.io">docs.takumo.io</a> ·
  <a href="https://cloud.takumo.io/dashboard">Dashboard</a> ·
  <a href="https://takumo.io">takumo.io</a>
</p>

---

This repo powers [docs.takumo.io](https://docs.takumo.io), built on [Mintlify](https://mintlify.com) (maple theme).

## What Takumo does

You paste code into an AI tool. That code has your database password, your API keys, your production credentials. Now the AI has them too.

Takumo fixes this. Secrets are tokenized before they leave your machine. When the AI responds, tokens are swapped back to real values. The AI never sees your actual credentials.

**Aegis Shield** — Outbound protection. Scans your code, finds secrets, replaces them with tokens. Sends safe code to AI. Restores real values in the response.

**Sentinel** — Inbound validation. Scans AI-generated code for security vulnerabilities, license violations, and deprecated patterns. Dashboard scanning available, standalone API coming.

## Documentation sections

| Section | Pages | What you'll find |
|---------|-------|------------------|
| [Get Started](https://docs.takumo.io/introduction) | 5 | Introduction, quickstart, installation, authentication, first request |
| [Concepts](https://docs.takumo.io/concepts/how-it-works) | 5 | How it works, Aegis Shield, Sentinel, security model, policies |
| [Dashboard](https://docs.takumo.io/dashboard/overview) | 8 | API keys, fleet management, team members, audit log, security, billing |
| [Deployment](https://docs.takumo.io/deployment/overview) | 5 | SaaS setup, on-prem Kubernetes, configuration reference, monitoring |
| [AI Tools](https://docs.takumo.io/ai-tools/overview) | 7 | Cursor, Copilot, Continue.dev, Windsurf, Claude Code, generic setup |
| [CLI](https://docs.takumo.io/cli/overview) | 4 | `scan`, `tokenize`, `shield` commands |
| [API](https://docs.takumo.io/api/overview) | 8 | Sessions, tokenize, rehydrate, authentication, errors, rate limits, webhooks |
| [Reference](https://docs.takumo.io/patterns/supported) | 6 | Supported patterns, plan comparison, error codes, FAQ, troubleshooting, changelog |

48 pages total across 6 navigation tabs.

## Local preview

Requires Node LTS (22 or earlier):

```bash
npx mintlify dev
```

## Project structure

```
docs/
├── docs.json                  # Mintlify config (nav, theme, fonts, colors)
├── logo/                      # Wordmark SVGs (light + dark) and favicon
├── introduction.mdx           # Landing page
├── quickstart.mdx
├── installation.mdx
├── authentication.mdx
├── first-request.mdx
├── changelog.mdx
├── concepts/                  # How it works, Aegis Shield, Sentinel, security, policies
├── patterns/                  # Supported secret patterns
├── reference/                 # Plan comparison, error codes, FAQ, troubleshooting
├── dashboard/                 # Dashboard guide (8 pages)
├── deployment/                # SaaS, on-prem, configuration, monitoring
├── cli/                       # CLI command reference
├── ai-tools/                  # AI tool integrations (7 pages)
└── api/                       # API reference (8 pages)
```

## Tech

- **Platform:** [Mintlify](https://mintlify.com) (maple theme)
- **Font:** Geist Sans
- **Brand color:** `#6366F1` (indigo)
- **Dark mode:** Default, with light mode available

---

<p align="center">
  <sub>Copyright &copy; 2026 Takumo. All rights reserved.</sub>
</p>
