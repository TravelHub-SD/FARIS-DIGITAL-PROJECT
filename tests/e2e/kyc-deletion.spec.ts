import { expect, test } from "@playwright/test";

import {
  createKycSubmission,
  createUser,
  signInCookies,
  sql,
  type TestUser,
} from "./helpers";

// A reviewed identity document whose file deletion failed after the verdict:
// listed for reviewers, and after 24 hours a banner on every admin page until
// someone deletes it (decisions.md 2026-09-28).

const BASE = "http://localhost:3100";

async function asStaff(
  browser: import("@playwright/test").Browser,
  user: TestUser,
) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await signInCookies(ctx, user.phone, user.password);
  return { ctx, page: await ctx.newPage() };
}

test("a document pending deletion for over 24 h raises the banner; deleting it clears it", async ({
  browser,
}) => {
  const reviewer = await createUser({
    admin: { permissions: ["kyc"] },
    name: "Reviewer",
  });
  const ordersOnly = await createUser({
    admin: { permissions: ["orders"] },
    name: "Orders staff",
  });
  const customer = await createUser();
  const submission = await createKycSubmission(customer.id);
  const path = submission.storage_path as string;
  // The verdict through the database function alone: the file stays in the
  // bucket, exactly as when the deletion after the review fails.
  const review = await reviewer.client.rpc("review_kyc", {
    p_submission_id: submission.id,
    p_approve: true,
  });
  expect(review.error).toBeNull();
  const objectCount = () =>
    sql(
      `select count(*) from storage.objects where bucket_id = 'kyc-documents' and name = '${path}'`,
    );
  expect(objectCount()).toBe("1");

  const { ctx, page } = await asStaff(browser, reviewer);
  // Fresh: listed on the KYC page, but no alarm yet.
  await page.goto("/en/admin/kyc");
  const item = page
    .getByTestId("kyc-pending-deletion")
    .locator(`li[data-submission-id="${submission.id}"]`);
  await expect(item).toBeVisible();
  await expect(item).not.toContainText("Over 24 hours");
  await expect(page.getByTestId("kyc-deletion-alert")).toHaveCount(0);

  // 25 hours later (clock moved in the database).
  sql(
    `update kyc_submissions set reviewed_at = now() - interval '25 hours' where id = '${submission.id}'`,
  );
  for (const url of ["/en/admin", "/en/admin/kyc"]) {
    await page.goto(url);
    await expect(page.getByTestId("kyc-deletion-alert")).toContainText(
      "1 identity document has waited more than 24 hours for deletion",
    );
  }
  await expect(item).toContainText("Over 24 hours");
  await page.goto("/ar/admin");
  await expect(page.getByTestId("kyc-deletion-alert")).toContainText(
    "مستند هوية واحد ينتظر الحذف منذ أكثر من 24 ساعة",
  );
  await page.screenshot({ path: ".e2e/kyc-deletion-banner-ar.png" });

  // Staff without the kyc permission cannot act on it and do not see it.
  const other = await asStaff(browser, ordersOnly);
  await other.page.goto("/en/admin");
  await expect(other.page.getByTestId("dashboard-card").first()).toBeVisible();
  await expect(other.page.getByTestId("kyc-deletion-alert")).toHaveCount(0);
  await other.ctx.close();

  // The reviewer deletes it: file gone, row marked, banner gone.
  await page.goto("/en/admin/kyc");
  await item.getByRole("button", { name: "Delete file" }).click();
  await expect(page.getByText("File deleted.")).toBeVisible();
  expect(objectCount()).toBe("0");
  expect(
    sql(
      `select (storage_path is null)::text || '/' || (file_deleted_at is not null)::text from kyc_submissions where id = '${submission.id}'`,
    ),
  ).toBe("true/true");
  expect(
    sql(
      `select count(*) from audit_logs where entity_type = 'kyc_submissions' and entity_id = '${submission.id}' and actor_id = '${reviewer.id}' and new_data ? 'file_deleted_at'`,
    ),
  ).toBe("1");
  await page.goto("/en/admin");
  await expect(page.getByTestId("kyc-deletion-alert")).toHaveCount(0);
  await page.goto("/en/admin/kyc");
  await expect(
    page
      .getByTestId("kyc-pending-deletion")
      .getByText("No documents are waiting for deletion."),
  ).toBeVisible();
  console.log(
    `[demo] kyc deletion: fresh → listed, no banner; +25 h → banner (en, ar); deleted by reviewer → object count ${objectCount()}, banner gone`,
  );
  await ctx.close();
});
