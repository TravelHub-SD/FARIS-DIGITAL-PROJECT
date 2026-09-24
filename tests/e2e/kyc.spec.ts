import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { createUser, service, signInCookies, sql } from "./helpers";

test("KYC: upload (EXIF stripped) → reviewer sees it via a signed URL → approve → file deleted", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // A phone photo with GPS + camera model in EXIF.
  const photo = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: "#1d4ed8" },
  })
    .withExif({
      IFD0: { Model: "Secret-Model-9" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "15/1 35/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "32/1 32/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
  writeFileSync(".e2e/id-photo.jpg", photo);

  const customer = await createUser({ name: "صاحب الهوية" });
  const reviewer = await createUser({ admin: { permissions: ["kyc"] } });

  // Customer uploads through the real form.
  const cctx = await browser.newContext();
  await signInCookies(cctx, customer.phone, customer.password);
  const cpage = await cctx.newPage();
  await cpage.goto("http://localhost:3100/ar/account/kyc");
  await cpage.setInputFiles("#file", ".e2e/id-photo.jpg");
  await cpage.getByRole("button", { name: "إرسال للمراجعة" }).click();
  // The page re-renders into its "under review" state (the form is replaced).
  await expect(cpage.getByTestId("kyc-status")).toHaveText("قيد المراجعة");

  const path = sql(
    `select storage_path from public.kyc_submissions where user_id = '${customer.id}'`,
  );
  const stored = await service().storage.from("kyc-documents").download(path);
  const meta = await sharp(
    Buffer.from(await stored.data!.arrayBuffer()),
  ).metadata();
  console.log(
    `[demo] stored file: ${meta.format} ${meta.width}x${meta.height}, exif: ${meta.exif?.length ?? "none"}`,
  );
  expect(meta.exif).toBeUndefined();

  // Reviewer opens the queue and the document.
  const rctx = await browser.newContext();
  await signInCookies(rctx, reviewer.phone, reviewer.password);
  const rpage = await rctx.newPage();
  await rpage.goto("http://localhost:3100/ar/admin/kyc");
  await rpage
    .getByRole("link", { name: "مراجعة", exact: true })
    .first()
    .click();
  const img = rpage.locator("img[alt]");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  const signedUrl = await img.getAttribute("src");
  expect(signedUrl).toMatch(
    /\/storage\/v1\/object\/sign\/kyc-documents\/.+\?token=/,
  );
  const payload = JSON.parse(
    Buffer.from(
      new URL(signedUrl!).searchParams.get("token")!.split(".")[1],
      "base64url",
    ).toString(),
  );
  console.log(
    `[demo] signed URL lifetime from the page: ${payload.exp - payload.iat} s`,
  );
  expect(payload.exp - payload.iat).toBe(60);

  // The customer cannot use that URL's path; a stranger with the URL gets it only until expiry.
  expect((await fetch(signedUrl!)).status).toBe(200);

  await rpage.getByRole("button", { name: "قبول" }).click();
  await expect(rpage).toHaveURL(/\/ar\/admin\/kyc$/);
  expect(
    sql(
      `select count(*) from storage.objects where bucket_id = 'kyc-documents' and name = '${path}'`,
    ),
  ).toBe("0");
  expect(
    (await fetch(signedUrl!)).status,
    "file deleted: even a live URL returns nothing",
  ).toBe(400);

  await cpage.reload();
  await expect(cpage.getByTestId("kyc-status")).toHaveText("موثق");
  await cctx.close();
  await rctx.close();
});

test("the signed URL printed in the review page expires after 60 s", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await createUser();
  const reviewer = await createUser({ admin: { permissions: ["kyc"] } });
  const jpeg = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#999" },
  })
    .jpeg()
    .toBuffer();
  const id = crypto.randomUUID();
  const path = `${customer.id}/${id}.jpg`;
  await service()
    .storage.from("kyc-documents")
    .upload(path, jpeg, { contentType: "image/jpeg" });
  const sub = await customer.client.rpc("submit_kyc", {
    p_doc_type: "passport",
    p_storage_path: path,
    p_file_sha256: "d".repeat(64),
  });
  expect(sub.error).toBeNull();

  const ctx = await browser.newContext();
  await signInCookies(ctx, reviewer.phone, reviewer.password);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3100/ar/admin/kyc/${id}`);
  const src = await page.locator("img[alt]").getAttribute("src");
  const t0 = (await fetch(src!)).status;
  await new Promise((r) => setTimeout(r, 62_000));
  const t62 = await fetch(src!);
  console.log(
    `[demo] review-page URL: t=0s -> ${t0}; t=62s -> ${t62.status} ${await t62.text()}`,
  );
  expect(t0).toBe(200);
  expect(t62.status).toBe(400);
  await ctx.close();
});
