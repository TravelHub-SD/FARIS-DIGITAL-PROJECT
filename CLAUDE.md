# CLAUDE.md — Faris Digital

Production marketplace for digital products/services in the Sudanese market.
Read `docs/spec.md` (requirements), `docs/roadmap.md` (phases), `docs/decisions.md` (decision log) before doing anything.

## Role
You are a senior engineering partner, not a code generator. I (Hassan Tariq) am the developer and reviewer.
Work in supervised phases. Do not attempt to build the whole app in one pass.

## Stack (do not change without asking)
- Next.js (App Router) + TypeScript, Server Components / Server Actions where appropriate
- Tailwind CSS + shadcn/ui, dark mode, RTL + LTR
- Supabase: Postgres, Auth, Storage, RLS
- Zod + React Hook Form (schemas shared between client and server)
- next-intl with `/ar` and `/en`
- Vercel + GitHub
- WhatsApp Cloud API (Meta direct)

Next.js here is v16: APIs differ from older versions (e.g. `proxy.ts` replaces middleware). Check `AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next-specific code.

No extra dependencies without a stated reason. Prefer simple, maintainable code over abstraction layers. This is an MVP, not an enterprise banking system: no microservices, event buses, CQRS.

## Brand
- Primary blue: `#005CFF`
- Accent orange: `#FF7A00`
- Working product name: **Faris Digital** (temporary)
- Locale defaults: Arabic first, timezone `Africa/Khartoum`, phone numbers Sudanese format `+249…` (normalize before storing)

## Hard rules — never break these
1. **Nothing fake.** No mock APIs, fake auth, fake KYC approval, fake payment verification, simulated WhatsApp delivery in production code, or hardcoded order states presented as working features.
2. **Server is the authority.** Price, KYC threshold, order state transitions, permissions, invoice numbers, and any money-related value are computed and validated on the server. Never trust a value from the browser.
3. **RLS everywhere.** Every table with user data has RLS enabled and tested. Frontend route guards are never the only protection.
4. **Identity documents are private.** Private Supabase Storage bucket, short-lived signed URLs for authorized admins only, validate MIME type + extension + size, strip EXIF where feasible. Never a public URL.
5. **OTP safety.** Store hashed, short expiry, max attempts, per-phone cooldown, rate limiting, IP protection where practical. Assume someone will try to burn the WhatsApp budget.
6. **Secrets.** `service_role` key and WhatsApp credentials are server-only. Never in client code, never committed. Keep `.env.example` up to date.
7. **Migrations only.** Every schema change is a reproducible Supabase migration (tables, indexes, constraints, RLS policies, functions, triggers, storage policies). Never mutate the database by hand.
8. **Never run destructive commands** against a production database or storage bucket. Seed data lives separately from production data.
9. **Logs** never contain passwords, plaintext OTPs, identity document contents, or tokens.

## Definition of done (every task)
- `tsc --noEmit`, lint, and `build` all pass
- Migrations applied and reversible in a fresh environment
- RLS policies covering any new table
- Tests for anything touching money, permissions, order state, or file access
- Short summary of what changed and what I should review manually

## Verification is the agent's job (standing rule, 2026-09-23)
Hassan reviews the output, not the codebase. In every phase:
- Run `npm run check` yourself and paste the real output, not a summary.
- Run the browser tests and the database/API tests yourself and paste the results.
- For any guard, policy or test that can be proven by planting a violation, plant it and show both the failure and the pass after the fix/revert.
- Never report something as working unless you executed it and pasted the output.
- If something cannot be verified in the current environment, say so explicitly instead of implying it passed.

## Testing focus
Do not chase coverage. Test the paths where a bug costs money or leaks data:
pricing and order creation, price tampering attempts, KYC enforcement, order state transitions, admin permission boundaries, customer data isolation (RLS), OTP verification and rate limits, KYC document access, duplicate transfer receipts.

## Working style
- One roadmap phase per session. Start by restating the phase goal and the files you plan to touch.
- On real ambiguity (architecture, cost, security, UX): state the ambiguity, the consequence, your recommended default, then ask me. On trivial details: decide and move on.
- Record every meaningful architectural decision in `docs/decisions.md` (what, why, alternatives rejected).
- Update `docs/roadmap.md` checkboxes as work completes.
- External blockers (Meta template approval, Google OAuth setup, client content) must never stop progress: hide them behind an interface with a local development driver (e.g. a WhatsApp driver that logs the OTP to the console in dev only, never in production).
