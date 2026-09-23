# Faris Digital

Bilingual (Arabic/English) marketplace for digital products and services in Sudan.
Start with `CLAUDE.md`, then `docs/spec.md`, `docs/roadmap.md`, `docs/decisions.md` and `docs/architecture.md`.

## Requirements

- Node.js ≥ 20.9
- Docker (only for the local Supabase stack)

## Setup

```bash
npm install
cp .env.example .env.local      # fill in the values
npx supabase start              # optional: local Postgres/Auth/Storage
npm run dev                     # http://localhost:3000 → redirects to /ar
```

## Scripts

| Script                            | What it does                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server (Turbopack)                                                                    |
| `npm run typecheck`               | `next typegen` + `tsc --noEmit`                                                           |
| `npm run lint`                    | ESLint (incl. service-role import guard) + RTL logical-CSS check + translation key parity |
| `npm run format` / `format:check` | Prettier (+ Tailwind class order)                                                         |
| `npm run build`                   | Production build                                                                          |
| `npm run check`                   | Everything above, as CI would run it                                                      |

## Tests

Require Docker and the local Supabase stack (`npx supabase start`; if `public.ecr.aws` is blocked, prefix with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`).

| Script                     | What it does                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:integration` | Resets the local DB, then runs Vitest over HTTP with the anon key: acceptance tests 1–3, admin boundaries, audit append-only                   |
| `npm run test:db`          | pgTAP (`supabase/tests`): order/invoice snapshot, KYC threshold, transitions, duplicate receipts, gapless invoice numbers, audit, RLS coverage |
| `npm test`                 | Both                                                                                                                                           |

Tests never run against a hosted project (the harness refuses any API URL that is not `127.0.0.1`).

## Conventions

- Locales: `/ar` (default, RTL) and `/en`. UI strings live in `messages/*.json`; both files must have the same keys.
- Use logical Tailwind utilities (`ms-*`, `pe-*`, `start-*`, `text-start`), never `ml-*`/`left-*`/`text-left`. `npm run lint` enforces it.
- Client components receive translated strings as props from Server Components; only the `Errors` namespace ships to the browser.
- Supabase clients: `lib/supabase/server.ts` by default (RLS applies). `lib/supabase/admin.ts` bypasses RLS and is import-restricted by ESLint.
