import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { orderSignature, ordersSignature } from "@/server/orders/live";

// Polled by the customer's order pages while visible (OrderLive). Answers
// only for the signed-in customer's own orders: another customer's
// reference is the same 404 as one that does not exist. Never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user)
    return NextResponse.json(
      { error: "sign_in" },
      { status: 401, headers: NO_STORE },
    );
  const reference = new URL(request.url).searchParams.get("ref");
  const sig =
    reference === null
      ? await ordersSignature(data.user.id)
      : await orderSignature(data.user.id, reference);
  if (sig === null)
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  return NextResponse.json({ sig }, { headers: NO_STORE });
}
