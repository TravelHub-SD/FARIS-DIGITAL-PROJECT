// KYC documents: who can submit, who can read the file, signed-URL expiry,
// review rules, and deletion after review. Files are placed exactly where the
// server ingest pipeline puts them ({user_id}/{uuid}.jpg, service role).
import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { KYC_SIGNED_URL_TTL_SECONDS } from "@/server/kyc/constants";

import { anon, createUser, service, sql, type TestUser } from "./helpers";

let alice: TestUser; // customer who submits
let bob: TestUser; // another customer
let reviewer: TestUser; // admin with `kyc`
let ordersAdmin: TestUser; // admin WITHOUT `kyc`
let jpeg: Buffer;
let path: string;
let submissionId: string;

async function ingest(userId: string) {
  const id = randomUUID();
  const p = `${userId}/${id}.jpg`;
  const up = await service()
    .storage.from("kyc-documents")
    .upload(p, jpeg, { contentType: "image/jpeg" });
  if (up.error) throw new Error(up.error.message);
  return { id, path: p };
}
const objectExists = (p: string) =>
  sql(
    `select count(*) from storage.objects where bucket_id = 'kyc-documents' and name = '${p}'`,
  ) === "1";

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#005CFF" },
  })
    .jpeg()
    .toBuffer();
  [alice, bob, reviewer, ordersAdmin] = await Promise.all([
    createUser(),
    createUser(),
    createUser({ admin: { permissions: ["kyc"] } }),
    createUser({ admin: { permissions: ["orders"] } }),
  ]);
  ({ id: submissionId, path } = await ingest(alice.id));
});

describe("KYC submission rules (submit_kyc)", () => {
  it("a customer cannot register a file in someone else's folder", async () => {
    const res = await bob.client.rpc("submit_kyc", {
      p_doc_type: "passport",
      p_storage_path: path,
      p_file_sha256: "0".repeat(64),
    });
    expect(res.error?.message).toMatch(/KYC_INVALID_PATH/);
  });

  it("a customer cannot register a file that was never uploaded by the server", async () => {
    const res = await alice.client.rpc("submit_kyc", {
      p_doc_type: "passport",
      p_storage_path: `${alice.id}/${randomUUID()}.jpg`,
      p_file_sha256: "0".repeat(64),
    });
    expect(res.error?.message).toMatch(/KYC_FILE_NOT_FOUND/);
  });

  it("the owner registers the uploaded file; status becomes pending", async () => {
    const res = await alice.client.rpc("submit_kyc", {
      p_doc_type: "national_id",
      p_storage_path: path,
      p_file_sha256: "a".repeat(64),
    });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    expect(
      sql(
        `select status from public.kyc_submissions where id = '${submissionId}'`,
      ),
    ).toBe("pending");
    expect(
      sql(`select kyc_status from public.profiles where id = '${alice.id}'`),
    ).toBe("pending");
  });

  it("only one open submission at a time", async () => {
    const second = await ingest(alice.id);
    const res = await alice.client.rpc("submit_kyc", {
      p_doc_type: "passport",
      p_storage_path: second.path,
      p_file_sha256: "b".repeat(64),
    });
    expect(res.error?.message).toMatch(/KYC_ALREADY_PENDING/);
  });
});

describe("KYC files: only an authorized reviewer can read them", () => {
  const who = () =>
    ({
      "the customer who uploaded it": alice,
      "another customer": bob,
      "an admin without kyc permission": ordersAdmin,
    }) as const;

  for (const label of [
    "the customer who uploaded it",
    "another customer",
    "an admin without kyc permission",
  ] as const) {
    it(`${label}: cannot download or sign the file`, async () => {
      const client = who()[label].client;
      const dl = await client.storage.from("kyc-documents").download(path);
      expect(dl.error, "download must fail").not.toBeNull();
      const signed = await client.storage
        .from("kyc-documents")
        .createSignedUrl(path, 60);
      expect(signed.error, "signing must fail").not.toBeNull();
    });
  }

  it("anonymous visitor: cannot download or sign the file", async () => {
    expect(
      (await anon().storage.from("kyc-documents").download(path)).error,
    ).not.toBeNull();
    expect(
      (await anon().storage.from("kyc-documents").createSignedUrl(path, 60))
        .error,
    ).not.toBeNull();
  });

  it("non-reviewers cannot open the document through the RPC either", async () => {
    for (const u of [alice, bob, ordersAdmin]) {
      const res = await u.client.rpc("kyc_open_document", {
        p_submission_id: submissionId,
      });
      expect(res.error?.code).toBe("42501");
    }
  });

  it("control: the kyc reviewer can open it; the view is audited with the reviewer as actor", async () => {
    const opened = await reviewer.client.rpc("kyc_open_document", {
      p_submission_id: submissionId,
    });
    expect(opened.data).toBe(path);
    const signed = await reviewer.client.storage
      .from("kyc-documents")
      .createSignedUrl(path, KYC_SIGNED_URL_TTL_SECONDS);
    expect(signed.error).toBeNull();
    const res = await fetch(signed.data!.signedUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(
      sql(`select actor_id from public.audit_logs
            where action = 'kyc_submissions.document_viewed' and entity_id = '${submissionId}'
            order by id desc limit 1`),
    ).toBe(reviewer.id);
  });

  it("the app signs KYC URLs for 60 seconds", () => {
    expect(KYC_SIGNED_URL_TTL_SECONDS).toBe(60);
  });

  it("a signed URL stops working after it expires (3 s URL, fetched at 0 s and 5 s)", async () => {
    const signed = await reviewer.client.storage
      .from("kyc-documents")
      .createSignedUrl(path, 3);
    const url = signed.data!.signedUrl;
    const before = await fetch(url);
    await new Promise((r) => setTimeout(r, 5000));
    const after = await fetch(url);
    const body = await after.text();
    console.log(
      `[demo] signed URL: t=0s -> HTTP ${before.status}; t=5s -> HTTP ${after.status} ${body}`,
    );
    expect(before.status).toBe(200);
    expect(after.status).toBe(400);
    expect(body).toMatch(/exp/i);
  });
});

describe("KYC review", () => {
  it("a pending document cannot be deleted, not even by a reviewer", async () => {
    await reviewer.client.storage.from("kyc-documents").remove([path]);
    expect(objectExists(path)).toBe(true);
  });

  it("customers cannot review (including their own)", async () => {
    const res = await alice.client.rpc("review_kyc", {
      p_submission_id: submissionId,
      p_approve: true,
    });
    expect(res.error?.code).toBe("42501");
    expect(
      sql(`select kyc_status from public.profiles where id = '${alice.id}'`),
    ).toBe("pending");
  });

  it("a reviewer cannot approve their own submission", async () => {
    const own = await ingest(reviewer.id);
    const sub = await reviewer.client.rpc("submit_kyc", {
      p_doc_type: "passport",
      p_storage_path: own.path,
      p_file_sha256: "c".repeat(64),
    });
    expect(sub.error).toBeNull();
    const res = await reviewer.client.rpc("review_kyc", {
      p_submission_id: own.id,
      p_approve: true,
    });
    expect(res.error?.message).toMatch(/KYC_CANNOT_REVIEW_OWN/);
  });

  it("rejection requires a reason", async () => {
    const res = await reviewer.client.rpc("review_kyc", {
      p_submission_id: submissionId,
      p_approve: false,
      p_reason: " ",
    });
    expect(res.error?.message).toMatch(/KYC_REASON_REQUIRED/);
  });

  it("approve → profile verified; the file is deleted; the row keeps only the verdict", async () => {
    const res = await reviewer.client.rpc("review_kyc", {
      p_submission_id: submissionId,
      p_approve: true,
    });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    expect(
      sql(`select kyc_status from public.profiles where id = '${alice.id}'`),
    ).toBe("verified");

    const early = await reviewer.client.rpc("kyc_mark_file_deleted", {
      p_submission_id: submissionId,
    });
    expect(
      early.error?.message,
      "cannot mark deleted while the file exists",
    ).toMatch(/KYC_FILE_STILL_PRESENT/);

    const removed = await reviewer.client.storage
      .from("kyc-documents")
      .remove([path]);
    expect(removed.error).toBeNull();
    expect(objectExists(path)).toBe(false);
    expect(
      (
        await reviewer.client.rpc("kyc_mark_file_deleted", {
          p_submission_id: submissionId,
        })
      ).error,
    ).toBeNull();

    expect(
      sql(`select status, reviewed_by, storage_path is null, file_deleted_at is not null
             from public.kyc_submissions where id = '${submissionId}'`),
    ).toBe(`accepted|${reviewer.id}|t|t`);
    const signed = await reviewer.client.storage
      .from("kyc-documents")
      .createSignedUrl(path, 60);
    expect(signed.error, "nothing left to sign").not.toBeNull();
  });
});
