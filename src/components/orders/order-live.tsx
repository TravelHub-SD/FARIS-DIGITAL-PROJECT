"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Keeps a customer's order page current while staff work on the order:
// every 15 s, only while the tab is visible and online, it asks
// /api/orders/status for the page's fingerprint and refreshes the page
// (server-rendered again, under RLS) when it changed. A tab coming back into
// view checks at once. Failures back off up to 2 minutes; 401/404 stop it.
// Polling, not Realtime: no extra library or CSP origin, and plain HTTPS
// copes with weak mobile networks (decisions.md 2026-11-21).
const INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;

export function OrderLive({
  reference,
  signature,
}: {
  /** One order; omit for the order list. */
  reference?: string;
  signature: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const url = `/api/orders/status${reference ? `?ref=${encodeURIComponent(reference)}` : ""}`;
    let known = signature;
    let delay = INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;
    const active = () =>
      !stopped && document.visibilityState === "visible" && navigator.onLine;
    const schedule = () => {
      clearTimeout(timer);
      if (active()) timer = setTimeout(check, delay);
    };
    const check = async () => {
      if (!active() || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (res.status === 401 || res.status === 404) stopped = true;
        else if (!res.ok) delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        else {
          delay = INTERVAL_MS;
          const { sig } = (await res.json()) as { sig: string };
          if (sig !== known) {
            known = sig;
            router.refresh();
          }
        }
      } catch {
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onShow = () => (active() ? void check() : clearTimeout(timer));
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", onShow);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("online", onShow);
    };
  }, [reference, signature, router]);
  return null;
}
