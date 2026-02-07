# Takumo Documentation

Documentation for [Takumo](https://takumo.com) — bidirectional AI code governance.

## What is Takumo?

Takumo protects your secrets when working with AI assistants. It tokenizes sensitive data before it leaves your machine and restores it when responses come back.

- **Aegis Shield** — Outbound protection. Tokenizes secrets before they reach AI.
- **Sentinel** — Inbound validation. Validates AI-generated code before you use it. (Coming soon)

## Local Development

Preview the docs locally:

```bash
npx mintlify dev
```

Opens at `http://localhost:3000`.

## Structure

```
docs/
├── docs.json              # Mintlify configuration
├── introduction.mdx       # Landing page
├── quickstart.mdx         # Getting started guide
├── installation.mdx       # Install options
├── changelog.mdx          # Release history
├── concepts/              # Core concepts
│   ├── how-it-works.mdx
│   ├── aegis-shield.mdx
│   └── sentinel.mdx
├── cli/                   # CLI reference
│   ├── overview.mdx
│   ├── scan.mdx
│   ├── tokenize.mdx
│   └── shield.mdx
├── api/                   # API reference
│   ├── overview.mdx
│   ├── create-session.mdx
│   ├── tokenize.mdx
│   └── rehydrate.mdx
├── patterns/              # Detection patterns
│   └── supported.mdx
└── logo/                  # Brand assets
    ├── takumo-light.svg
    ├── takumo-dark.svg
    └── favicon.svg
```

## Deployment

Connected to Mintlify. Pushes to `main` deploy automatically.

Custom domain: `docs.takumo.com`

## License

Copyright (c) 2025 Takumo. All rights reserved.
