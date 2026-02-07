<p align="center">
  <img src="logo/favicon.svg" height="80" alt="Takumo" />
</p>

<h1 align="center">Takumo</h1>

<p align="center">
  <strong>Your secrets stay on your machine.</strong>
</p>

<p align="center">
  <a href="https://docs.takumo.com">Documentation</a> ·
  <a href="mailto:jordant@takumo.com?subject=Takumo%20Access%20Request">Request Access</a>
</p>

---

You paste code into Claude. That code has your database password, your API keys, your production credentials.

Now Claude has them too.

**Takumo fixes this.**

```typescript
// What you have (example)
const db = connect("postgres://admin:examplepass@prod.internal:5432/app");

// What Claude sees
const db = connect("__TAKUMO_v1_CONN_a1b2c3__");

// What you get back
const db = connect("postgres://admin:examplepass@prod.internal:5432/app");
```

Secrets are tokenized before they leave your machine. When the AI responds, tokens are swapped back to real values. The AI never sees your actual credentials.

## How it works

**Aegis Shield** — Outbound. Scans your code, finds secrets, replaces them with tokens. Sends safe code to AI. Restores real values in the response.

**Sentinel** — Inbound. Validates AI-generated code before it enters your codebase. Catches security vulnerabilities, license violations, deprecated patterns. *(Coming soon)*

## Documentation

This repo powers [docs.takumo.com](https://docs.takumo.com).

| Section | What you'll find |
|---------|------------------|
| [Quickstart](https://docs.takumo.com/quickstart) | Zero to protected in 5 minutes |
| [How It Works](https://docs.takumo.com/concepts/how-it-works) | The tokenization flow explained |
| [CLI Reference](https://docs.takumo.com/cli/overview) | `scan`, `tokenize`, `shield` commands |
| [API Reference](https://docs.takumo.com/api/overview) | Use Takumo in your own code |
| [Supported Patterns](https://docs.takumo.com/patterns/supported) | Everything we detect |

## Local preview

```bash
npx mintlify dev
```

## Status

Private alpha. [Request access](mailto:jordant@takumo.com?subject=Takumo%20Access%20Request) to join.

---

<p align="center">
  <sub>Copyright © 2025 Takumo. All rights reserved.</sub>
</p>
