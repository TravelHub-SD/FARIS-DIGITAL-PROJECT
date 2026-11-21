import { expect, test } from "@playwright/test";

import {
  completeOrderWithInvoice,
  createOrder,
  createUser,
  sql,
} from "./helpers";

// The brand is "Fast Store" (client feedback round 1): page titles, Open
// Graph, JSON-LD, header and footer, in both languages; new invoices name
// the seller "Fast Store"; issued invoices keep their snapshot.

test("brand: Fast Store everywhere a visitor sees it; never the old name", async ({
  request,
}) => {
  for (const path of [
    "/ar",
    "/en",
    "/ar/login",
    "/en/p/pubg-uc",
    "/ar/categories",
  ]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("Fast Store");
    expect(html, path).not.toMatch(/Faris Digital|فارس ديجيتال/);
    expect(html, path).toMatch(/<title>[^<]*Fast Store[^<]*<\/title>/);
    expect(html, path).toMatch(
      /<meta property="og:site_name" content="Fast Store"/,
    );
  }
  const home = await (await request.get("/en")).text();
  const ld = [
    ...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g),
  ].flatMap((m) => JSON.parse(m[1]));
  expect(
    ld.find((x: { "@type": string }) => x["@type"] === "Organization"),
  ).toMatchObject({
    name: "Fast Store",
  });
  const og = await request.get("/og.png");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
});

test("brand: new invoices name the seller Fast Store; an issued one keeps its name", async () => {
  expect(
    sql(
      "select business_name_ar || ' | ' || business_name_en from app_settings where id",
    ),
  ).toBe("Fast Store | Fast Store");
  const customer = await createUser();
  const { invoice } = await completeOrderWithInvoice(
    await createOrder(customer.id),
  );
  const seller = () =>
    sql(
      `select snapshot #>> '{seller,name_en}' from invoices where invoice_number = '${invoice.invoice_number}'`,
    );
  expect(seller()).toBe("Fast Store");
  sql(`update app_settings set business_name_en = 'Renamed Later' where id`);
  try {
    expect(seller(), "issued invoice unchanged").toBe("Fast Store");
  } finally {
    sql(`update app_settings set business_name_en = 'Fast Store' where id`);
  }
});
