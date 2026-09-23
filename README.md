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

## Conventions

- Locales: `/ar` (default, RTL) and `/en`. UI strings live in `messages/*.json`; both files must have the same keys.
- Use logical Tailwind utilities (`ms-*`, `pe-*`, `start-*`, `text-start`), never `ml-*`/`left-*`/`text-left`. `npm run lint` enforces it.
- Client components receive translated strings as props from Server Components; only the `Errors` namespace ships to the browser.
- Supabase clients: `lib/supabase/server.ts` by default (RLS applies). `lib/supabase/admin.ts` bypasses RLS and is import-restricted by ESLint.
