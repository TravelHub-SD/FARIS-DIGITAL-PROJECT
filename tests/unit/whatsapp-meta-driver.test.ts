// The real Meta driver against a stubbed fetch: request shape per template,
// error classification, and that nothing sensitive leaves the driver.
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  classifyMetaError,
  createMetaDriver,
  readMetaConfig,
} from "@/server/whatsapp/meta-driver";
import type { OutgoingMessage } from "@/server/whatsapp/types";
import { parseStatuses, verifySignature } from "@/server/whatsapp/webhook";

const TOKEN = "EAAG-secret-token-should-never-leak";
const config = readMetaConfig({
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: "100000000000001",
  WHATSAPP_API_BASE_URL: "https://graph.example.test",
  WHATSAPP_API_VERSION: "v23.0",
});

function stub(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: {
    url: string;
    init: RequestInit;
    body: Record<string, unknown>;
  }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { calls, driver: createMetaDriver(config, fetchImpl) };
}
const ok = () => Response.json({ messages: [{ id: "wamid.ABC" }] });
const otp: OutgoingMessage = {
  to: "+249912345678",
  template: "otp_code",
  language: "ar",
  params: { code: "482913" },
};

describe("Meta driver: requests", () => {
  it("OTP → authentication template with the code in body and copy-code button", async () => {
    const { calls, driver } = stub(ok);
    expect(await driver.send(otp)).toEqual({
      ok: true,
      providerMessageId: "wamid.ABC",
    });
    expect(calls[0].url).toBe(
      "https://graph.example.test/v23.0/100000000000001/messages",
    );
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "249912345678",
      type: "template",
      template: {
        name: "otp_code",
        language: { code: "ar" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482913" }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "482913" }],
          },
        ],
      },
    });
  });

  it("order status → 3 body parameters; newlines/tabs collapsed, empty note becomes a dash", async () => {
    const { calls, driver } = stub(ok);
    await driver.send({
      to: "+249912345678",
      template: "order_status_update",
      language: "en",
      params: {
        reference: "FD-1234567",
        status: "Processing",
        note: "line one\n\tline    two",
      },
    });
    await driver.send({
      to: "+249912345678",
      template: "order_status_update",
      language: "ar",
      params: { reference: "FD-1234567", status: "مكتمل", note: "" },
    });
    const texts = (i: number) =>
      (
        calls[i].body.template as {
          components: { parameters: { text: string }[] }[];
        }
      ).components[0].parameters.map((p) => p.text);
    expect(texts(0)).toEqual(["FD-1234567", "Processing", "line one line two"]);
    expect(texts(1)).toEqual(["FD-1234567", "مكتمل", "—"]);
  });

  it("KYC approved → no components at all", async () => {
    const { calls, driver } = stub(ok);
    await driver.send({
      to: "+249912345678",
      template: "kyc_approved",
      language: "ar",
      params: {},
    });
    expect(calls[0].body.template).toEqual({
      name: "kyc_approved",
      language: { code: "ar" },
    });
  });
});

describe("Meta driver: failures are classified, never thrown, and carry no text", () => {
  const cases: [
    string,
    () => Response | Promise<Response>,
    { errorCode: string; retryable: boolean },
  ][] = [
    [
      "131000 something went wrong",
      () =>
        Response.json(
          { error: { code: 131000, message: "Something went wrong" } },
          { status: 500 },
        ),
      { errorCode: "meta:131000", retryable: true },
    ],
    [
      "130429 throughput",
      () =>
        Response.json(
          { error: { code: 130429, message: "Rate limit hit" } },
          { status: 400 },
        ),
      { errorCode: "meta:130429", retryable: true },
    ],
    [
      "131026 undeliverable",
      () =>
        Response.json(
          { error: { code: 131026, message: "Message undeliverable" } },
          { status: 400 },
        ),
      { errorCode: "meta:131026", retryable: false },
    ],
    [
      "132000 params mismatch (message echoes a value)",
      () =>
        Response.json(
          { error: { code: 132000, message: "Param 482913 invalid" } },
          { status: 400 },
        ),
      { errorCode: "meta:132000", retryable: false },
    ],
    [
      "190 token expired",
      () =>
        Response.json(
          { error: { code: 190, message: `Token ${TOKEN} expired` } },
          { status: 401 },
        ),
      { errorCode: "meta:190", retryable: false },
    ],
    [
      "HTML 502 from a proxy",
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      { errorCode: "http:502", retryable: true },
    ],
    [
      "404 without JSON",
      () => new Response("nope", { status: 404 }),
      { errorCode: "http:404", retryable: false },
    ],
    [
      "200 without a message id",
      () => Response.json({ messages: [] }),
      { errorCode: "http:200", retryable: false },
    ],
  ];
  for (const [label, respond, expected] of cases) {
    it(label, async () => {
      const { driver } = stub(respond);
      const result = await driver.send(otp);
      expect(result).toEqual({ ok: false, ...expected });
      expect(JSON.stringify(result)).not.toMatch(/482913|secret|expired|Param/);
    });
  }

  it("network error and timeout → retryable network codes", async () => {
    const refused = stub(() => {
      throw new TypeError("fetch failed");
    });
    expect(await refused.driver.send(otp)).toEqual({
      ok: false,
      errorCode: "network:error",
      retryable: true,
    });
    const slow = stub(() => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    });
    expect(await slow.driver.send(otp)).toEqual({
      ok: false,
      errorCode: "network:timeout",
      retryable: true,
    });
  });

  it("not configured (credentials pending) → config:not_configured, no request made", async () => {
    let called = false;
    const driver = createMetaDriver(readMetaConfig({}), (async () => {
      called = true;
      return ok();
    }) as unknown as typeof fetch);
    expect(await driver.send(otp)).toEqual({
      ok: false,
      errorCode: "config:not_configured",
      retryable: false,
    });
    expect(called).toBe(false);
  });

  it("unknown codes: 5xx/429 retried, other 4xx not", () => {
    expect(classifyMetaError(503, undefined)).toBe(true);
    expect(classifyMetaError(429, undefined)).toBe(true);
    expect(classifyMetaError(400, undefined)).toBe(false);
    expect(classifyMetaError(400, 999999)).toBe(false);
  });
});

describe("webhook helpers", () => {
  const secret = "app-secret-0123456789abcdef";
  const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const good =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts only the exact HMAC of the exact bytes", () => {
    expect(verifySignature(raw, good, secret)).toBe(true);
    expect(
      verifySignature(
        raw,
        good.toUpperCase().replace("SHA256=", "sha256="),
        secret,
      ),
    ).toBe(true);
    expect(verifySignature(raw, null, secret)).toBe(false);
    expect(verifySignature(raw, "", secret)).toBe(false);
    expect(verifySignature(raw, "sha1=" + "0".repeat(40), secret)).toBe(false);
    expect(verifySignature(raw, good.slice(0, -2) + "00", secret)).toBe(false);
    expect(
      verifySignature(Buffer.concat([raw, Buffer.from(" ")]), good, secret),
    ).toBe(false);
    expect(verifySignature(raw, good, "another-secret-0123456789")).toBe(false);
    expect(verifySignature(raw, good, "")).toBe(false);
  });

  it("extracts statuses for our number only; ignores message text, errors text and junk", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111" },
                statuses: [
                  {
                    id: "wamid.A",
                    status: "delivered",
                    timestamp: "1727000000",
                    pricing: { billable: true, category: "utility" },
                  },
                  {
                    id: "wamid.B",
                    status: "failed",
                    timestamp: "1727000001",
                    errors: [
                      {
                        code: 131026,
                        title: "secret title",
                        message: "secret msg",
                      },
                    ],
                  },
                  { id: "wamid.C", status: "deleted", timestamp: "1727000002" },
                  { id: "", status: "sent", timestamp: "1727000003" },
                ],
                messages: [{ text: { body: "customer private text" } }],
              },
            },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "999" },
                statuses: [
                  { id: "wamid.X", status: "read", timestamp: "1727000000" },
                ],
              },
            },
          ],
        },
      ],
    };
    const out = parseStatuses(payload, "111");
    expect(out).toEqual([
      {
        providerMessageId: "wamid.A",
        status: "delivered",
        occurredAt: "2024-09-22T10:13:20.000Z",
        errorCode: null,
        pricingCategory: "utility",
        billable: true,
      },
      {
        providerMessageId: "wamid.B",
        status: "failed",
        occurredAt: "2024-09-22T10:13:21.000Z",
        errorCode: "meta:131026",
        pricingCategory: null,
        billable: null,
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/secret|private/);
    expect(parseStatuses({ object: "page" }, "111")).toEqual([]);
    expect(parseStatuses(null, "111")).toEqual([]);
  });
});
