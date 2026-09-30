// About / Terms / Privacy (site_pages): the FAQ permission model, through
// PostgREST. Anyone reads published pages; settings staff (with their
// authenticator) edit; nobody adds or deletes pages.
import { afterAll, describe, expect, it } from "vitest";

import { anon, createUser, sql } from "./helpers";

afterAll(() => {
  sql(`update site_pages set title_ar = null, title_en = null, body_ar = null,
         body_en = null, is_published = false`);
});

describe("site pages", () => {
  it("drafts are private; settings staff edit and publish; others cannot", async () => {
    sql(`update site_pages set title_ar = null, title_en = null, body_ar = null,
           body_en = null, is_published = false`);
    const settings = await createUser({ admin: { permissions: ["settings"] } });
    const orders = await createUser({ admin: { permissions: ["orders"] } });
    const settingsNoCode = await createUser({
      admin: { permissions: ["settings"] },
      mfa: false,
    });
    const customer = await createUser();

    expect((await anon().from("site_pages").select("slug")).data).toEqual([]);
    expect(
      (await settings.client.from("site_pages").select("slug")).data?.length,
    ).toBe(3);

    // Refused edits: RLS filters them out (0 rows), nothing changes.
    for (const [who, c] of [
      ["orders staff", orders.client],
      ["settings staff without their code (aal1)", settingsNoCode.client],
      ["customer", customer.client],
      ["anon", anon()],
    ] as const) {
      const r = await c
        .from("site_pages")
        .update({ title_en: `by ${who}`, body_en: "x", is_published: true })
        .eq("slug", "terms")
        .select("slug");
      expect(r.data ?? [], who).toEqual([]);
    }
    expect(
      sql("select coalesce(title_en, '') from site_pages where slug = 'terms'"),
    ).toBe("");

    const ok = await settings.client
      .from("site_pages")
      .update({
        title_ar: "الشروط",
        body_ar: "الفقرة الأولى.\n\nالفقرة الثانية.",
        is_published: true,
      })
      .eq("slug", "terms")
      .select("slug");
    expect(ok.data).toEqual([{ slug: "terms" }]);
    const pub = await anon()
      .from("site_pages")
      .select("slug, title_ar, is_published");
    expect(pub.data).toEqual([
      { slug: "terms", title_ar: "الشروط", is_published: true },
    ]);

    // A live page cannot lose its text; pages cannot be added or removed.
    const empty = await settings.client
      .from("site_pages")
      .update({ body_ar: null })
      .eq("slug", "terms")
      .select("slug");
    expect(empty.error?.message).toMatch(/site_pages_check/);
    const add = await settings.client
      .from("site_pages")
      .insert({ slug: "contact" });
    expect(add.error?.message).toMatch(/permission denied/);
    const del = await settings.client
      .from("site_pages")
      .delete()
      .eq("slug", "terms");
    expect(del.error?.message).toMatch(/permission denied/);

    // Every edit is in the audit log, keyed by the page.
    expect(
      sql(`select count(*) from audit_logs where entity_type = 'site_pages'
             and entity_id = 'terms' and actor_id = '${settings.id}'`),
    ).toBe("1");
  });
});
