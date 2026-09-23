# Decision log

One entry per meaningful architectural or product decision. Append only.

Format:
## YYYY-MM-DD — <decision>
- **Context:** why this came up
- **Decision:** what we chose
- **Alternatives rejected:** and why
- **Consequences:** cost, security, migration impact

---

## 2026-09-23 — Stack
- **Context:** bilingual transactional marketplace, solo developer, 45-day window, low running cost.
- **Decision:** Next.js (App Router) + TypeScript + Tailwind/shadcn, Supabase (Postgres/Auth/Storage/RLS), next-intl, Vercel, WhatsApp Cloud API direct.
- **Alternatives rejected:** WordPress (no fit for custom KYC/orders), self-managed VPS (more ops for a solo dev), Twilio Verify (~13x the message cost).
- **Consequences:** vendor dependency on Supabase/Vercel; RLS becomes the main security boundary.
