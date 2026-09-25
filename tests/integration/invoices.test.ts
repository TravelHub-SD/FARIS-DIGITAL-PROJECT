import { spawn } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { createPaidOrder, createUser, sql, type TestUser } from "./helpers";

// Phase 8: invoice numbers stay gapless and unique when completions really
// run at the same time. Two kinds of concurrency:
//   1. eight completions fired at once through the API (PostgREST's pool,
//      staff session, change_order_status) — what the dashboard does;
//   2. four raw database sessions that complete an order and keep their
//      transaction open for 1.5 s, one of them rolling back at the end.

const year = () =>
  sql(`select extract(year from now() at time zone 'Africa/Khartoum')::int`);
const counter = () =>
  Number(
    sql(
      `select coalesce((select last_value from private.invoice_counters where year = ${year()}), 0)`,
    ),
  );
const numbersFor = (ids: string[]) =>
  sql(
    `select string_agg(invoice_number, ',' order by invoice_number) from invoices where order_id in (${ids
      .map((i) => `'${i}'`)
      .join(",")}) and status = 'issued'`,
  )
    .split(",")
    .filter(Boolean);
const seq = (n: string) => Number(n.slice(-5));

/** A separate database session, as psql, run asynchronously. */
function session(script: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("psql", [
      process.env.TEST_DB_URL!,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
      "-c",
      script,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

let staff: TestUser;
beforeAll(async () => {
  staff = await createUser({ admin: { permissions: ["orders"] } });
});

describe("invoice numbering under concurrent completions", () => {
  it("8 completions at once through the API: 8 invoices, contiguous, unique", async () => {
    const customers = await Promise.all(
      Array.from({ length: 8 }, () => createUser()),
    );
    const orders = await Promise.all(
      customers.map((c) => createPaidOrder(c.id)),
    );
    const before = counter();
    const results = await Promise.all(
      orders.map((o) =>
        staff.client.rpc("change_order_status", {
          p_order_id: o.id,
          p_to_status: "completed",
        }),
      ),
    );
    expect(results.map((r) => r.error)).toEqual(Array(8).fill(null));
    const numbers = numbersFor(orders.map((o) => o.id));
    console.log(
      `[demo] counter before ${before}; 8 parallel API completions → ${numbers.join(" ")}`,
    );
    expect(numbers).toHaveLength(8);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.map(seq)).toEqual(
      Array.from({ length: 8 }, (_, i) => before + 1 + i),
    );
    expect(counter()).toBe(before + 8);
  });

  it("overlapping transactions, one rolled back: its number is reused, no gap", async () => {
    const customers = await Promise.all(
      Array.from({ length: 4 }, () => createUser()),
    );
    const orders = await Promise.all(
      customers.map((c) => createPaidOrder(c.id)),
    );
    const before = counter();
    const started = Date.now();
    // Each session completes its order (issuing the invoice), holds the
    // transaction open, then commits — except the second, which rolls back.
    const runs = await Promise.all(
      orders.map((o, i) =>
        session(`
          begin;
          update orders set status = 'completed' where id = '${o.id}';
          select 'took ' || invoice_number from invoices where order_id = '${o.id}';
          select pg_sleep(1.5);
          ${i === 1 ? "rollback" : "commit"};
        `),
      ),
    );
    const elapsed = Date.now() - started;
    const taken = runs.map((r) => r.out.trim().split("\n")[0]);
    console.log(
      `[demo] 4 sessions (session 2 rolls back), ${elapsed} ms: ${taken.join(" | ")}`,
    );
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0]);
    // The counter row lock made them wait for each other (≈ 4 × 1.5 s, not 1.5 s).
    expect(elapsed).toBeGreaterThan(4 * 1500 - 500);

    const committed = orders.filter((_, i) => i !== 1).map((o) => o.id);
    const numbers = numbersFor(committed);
    expect(numbers.map(seq)).toEqual([before + 1, before + 2, before + 3]);
    expect(numbersFor([orders[1].id])).toEqual([]);
    expect(sql(`select status from orders where id = '${orders[1].id}'`)).toBe(
      "processing",
    );
    expect(counter()).toBe(before + 3);

    // The rolled-back order completes later and simply gets the next number.
    const late = await staff.client.rpc("change_order_status", {
      p_order_id: orders[1].id,
      p_to_status: "completed",
    });
    expect(late.error).toBeNull();
    expect(numbersFor([orders[1].id]).map(seq)).toEqual([before + 4]);
  });

  it("the whole year has no gaps and no duplicates", () => {
    const stats = sql(
      `select count(*) || '/' || count(distinct invoice_number) || '/' || max(right(invoice_number, 5)::int)
         from invoices where invoice_number like 'INV-${year()}-%'`,
    );
    const [count, distinct, max] = stats.split("/").map(Number);
    console.log(
      `[demo] year ${year()}: ${count} invoices, ${distinct} distinct, highest ${max}`,
    );
    expect(distinct).toBe(count);
    expect(max).toBe(count);
  });
});
