import { timingSafeEqual } from "node:crypto";

import { dispatchDue } from "@/server/whatsapp";

// Called every minute by the database scheduler (pg_cron → pg_net) while
// messages are due, with `Authorization: Bearer WHATSAPP_DISPATCH_SECRET`.
// Sends due notifications and retries; safe to call concurrently (leases).

export const dynamic = "force-dynamic";
// dispatchDue() stops claiming after 25 s; worst case one more batch of
// three 10-second Meta timeouts (~55 s). 60 s fits every Vercel plan.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("unauthorized", { status: 401 });
  }
  return Response.json(await dispatchDue(50));
}
