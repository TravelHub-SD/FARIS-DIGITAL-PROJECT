// Fake Meta Graph API (WhatsApp Cloud API) for automated tests. TEST CODE
// ONLY: the app runs its real Meta driver against this server, pointed here
// by WHATSAPP_API_BASE_URL. Behaviour follows Meta's documented contract:
//   POST /{version}/{phone-number-id}/messages   → { messages: [{ id }] } or
//        { error: { code, message, type, fbtrace_id } } with Meta's codes
//   webhooks: signed with the app secret (X-Hub-Signature-256), Meta's
//        payload shape (object / entry / changes / value.statuses[]).
// Control endpoints (/__*) exist only here, for tests.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_META_PORT ?? 3199);
const TOKEN = process.env.FAKE_META_TOKEN ?? "e2e-fake-access-token-0000000000";
const PHONE_ID = process.env.FAKE_META_PHONE_NUMBER_ID ?? "100000000000001";
const APP_SECRET =
  process.env.FAKE_META_APP_SECRET ?? "e2e-app-secret-0123456789abcdef";
const WEBHOOK_URL =
  process.env.FAKE_META_WEBHOOK_URL ??
  "http://localhost:3100/api/whatsapp/webhook";
const { templates } = JSON.parse(
  readFileSync(new URL("./meta-templates.json", import.meta.url), "utf8"),
);

let inbox = []; // accepted messages
let requests = []; // every send attempt (accepted or not)
let script = []; // scripted responses consumed one per request
let offline = false; // drop every connection
const undeliverable = new Set(); // recipients (digits) that fail with 131026
let seq = 0;

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const metaError = (res, http, code, message, type = "OAuthException") =>
  json(res, http, {
    error: {
      message,
      type,
      code,
      fbtrace_id: randomBytes(8).toString("base64url"),
    },
  });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export function sign(raw) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(raw).digest("hex");
}

/** Meta webhook payload for one status of one message. */
function statusPayload({
  id,
  status,
  to,
  category,
  billable = true,
  errorCode,
  extra,
}) {
  const value = {
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: "249900000000",
      phone_number_id: extra?.phoneNumberId ?? PHONE_ID,
    },
    statuses: [
      {
        id,
        status,
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: to,
        ...(status !== "failed" && category
          ? {
              conversation: {
                id: randomBytes(8).toString("hex"),
                origin: { type: category },
              },
              pricing: {
                billable,
                pricing_model: "PMP",
                category,
                type: "regular",
              },
            }
          : {}),
        ...(errorCode
          ? {
              errors: [
                {
                  code: errorCode,
                  title: "Message undeliverable.",
                  message: "Message undeliverable.",
                  error_data: {
                    details: extra?.errorDetails ?? "Message Undeliverable.",
                  },
                },
              ],
            }
          : {}),
      },
    ],
    ...(extra?.incomingText
      ? {
          contacts: [
            { profile: { name: extra.contactName ?? "Customer" }, wa_id: to },
          ],
          messages: [
            {
              from: to,
              id: "wamid.IN" + randomBytes(6).toString("hex"),
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text",
              text: { body: extra.incomingText },
            },
          ],
        }
      : {}),
  };
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "102290129340398", changes: [{ value, field: "messages" }] }],
  };
}

async function sendMessage(req, res, version, phoneId) {
  const raw = await readBody(req);
  const record = { at: Date.now(), path: req.url, ok: false };
  requests.push(record);
  let peek = {};
  try {
    peek = JSON.parse(raw.toString("utf8"));
  } catch {}
  record.to = typeof peek.to === "string" ? peek.to : undefined;
  record.template = peek.template?.name;
  // Scripted responses apply to the next request (or the next one to `to`).
  const at = script.findIndex((s) => !s.to || s.to === record.to);
  const step = at === -1 ? undefined : script.splice(at, 1)[0];
  if (step?.kind === "delay") {
    // Slow but successful: wait, then handle the request normally.
    await new Promise((r) => setTimeout(r, step.ms ?? 500));
  }
  if (step?.kind === "timeout") {
    record.result = "timeout";
    setTimeout(() => res.destroy(), step.ms ?? 5000);
    return;
  }
  if (step?.kind === "reset") {
    record.result = "reset";
    req.socket.destroy();
    return;
  }
  if (step?.kind === "html") {
    record.result = "html";
    res.writeHead(step.http ?? 502, { "Content-Type": "text/html" });
    res.end("<html><body>Bad Gateway</body></html>");
    return;
  }
  if (step?.kind === "error") {
    record.result = `meta:${step.code}`;
    return metaError(
      res,
      step.http ?? 500,
      step.code,
      step.message ?? "Scripted error",
    );
  }

  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    record.result = "meta:190";
    return metaError(
      res,
      401,
      190,
      "Invalid OAuth access token - Cannot parse access token",
    );
  }
  if (!/^v\d+\.\d+$/.test(version)) {
    record.result = "meta:2500";
    return metaError(res, 400, 2500, "Unknown path components");
  }
  if (phoneId !== PHONE_ID) {
    record.result = "meta:100";
    return metaError(
      res,
      400,
      100,
      "Unsupported post request.",
      "GraphMethodException",
    );
  }
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    record.result = "meta:100";
    return metaError(res, 400, 100, "Invalid parameter");
  }
  if (
    body.messaging_product !== "whatsapp" ||
    body.type !== "template" ||
    !/^\d{8,15}$/.test(body.to ?? "")
  ) {
    record.result = "meta:100";
    return metaError(res, 400, 100, "Invalid parameter");
  }
  const lang = body.template?.language?.code;
  const def = templates.find(
    (t) => t.name === body.template?.name && t.language === lang,
  );
  if (!def) {
    record.result = "meta:132001";
    return metaError(
      res,
      404,
      132001,
      "Template name does not exist in the translation",
    );
  }
  const components = body.template.components ?? [];
  const bodyParams =
    components.find((c) => c.type === "body")?.parameters ?? [];
  const button = components.find((c) => c.type === "button");
  if (
    bodyParams.length !== def.body ||
    bodyParams.some(
      (p) =>
        p.type !== "text" || typeof p.text !== "string" || p.text.length === 0,
    ) ||
    Boolean(button) !== def.button
  ) {
    record.result = "meta:132000";
    return metaError(
      res,
      400,
      132000,
      "Number of parameters does not match the expected number of params",
    );
  }
  if (undeliverable.has(body.to)) {
    // Meta accepts the request, then reports failure through the webhook;
    // tests use /__webhook to deliver that. Here: immediate rejection mode.
    record.result = "meta:131026";
    return metaError(res, 400, 131026, "Message undeliverable");
  }
  const id = "wamid.FAKE" + randomBytes(12).toString("base64url");
  record.ok = true;
  record.result = "accepted";
  record.id = id;
  inbox.push({
    seq: ++seq,
    id,
    at: Date.now(),
    to: body.to,
    template: def.name,
    language: lang,
    category: def.category,
    params: bodyParams.map((p) => p.text),
    buttonParam: button?.parameters?.[0]?.text ?? null,
  });
  return json(res, 200, {
    messaging_product: "whatsapp",
    contacts: [{ input: body.to, wa_id: body.to }],
    messages: [{ id, message_status: "accepted" }],
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (offline && !url.pathname.startsWith("/__")) {
    req.socket.destroy();
    return;
  }
  const m = /^\/(v[^/]+)\/([^/]+)\/messages$/.exec(url.pathname);
  if (req.method === "POST" && m) return sendMessage(req, res, m[1], m[2]);

  if (url.pathname === "/__health") return json(res, 200, { ok: true });
  if (url.pathname === "/__inbox") {
    const to = url.searchParams.get("to");
    const since = Number(url.searchParams.get("since") ?? 0);
    return json(
      res,
      200,
      inbox.filter((i) => (!to || i.to === to) && i.at >= since),
    );
  }
  if (url.pathname === "/__requests") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const to = url.searchParams.get("to");
    return json(
      res,
      200,
      requests.filter((r) => r.at >= since && (!to || r.to === to)),
    );
  }
  if (req.method === "POST" && url.pathname === "/__control") {
    const c = JSON.parse((await readBody(req)).toString() || "{}");
    if (c.reset) {
      script = [];
      offline = false;
      undeliverable.clear();
    }
    if (c.script) script.push(...c.script);
    if (typeof c.offline === "boolean") offline = c.offline;
    for (const n of c.undeliverable ?? []) undeliverable.add(n);
    return json(res, 200, {
      script: script.length,
      offline,
      undeliverable: [...undeliverable],
    });
  }
  if (req.method === "POST" && url.pathname === "/__webhook") {
    // Builds a Meta-shaped status payload, signs it, delivers it to the app,
    // and returns what was sent (so tests can replay or tamper with it).
    const c = JSON.parse((await readBody(req)).toString() || "{}");
    const payload = statusPayload(c);
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = c.badSignature
      ? sign(Buffer.from("something else"))
      : sign(raw);
    const r = await fetch(c.url ?? WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
      },
      body: raw,
    });
    return json(res, 200, {
      appStatus: r.status,
      appBody: await r.text(),
      raw: raw.toString("utf8"),
      signature,
    });
  }
  json(res, 404, { error: { message: "Unknown path", code: 803 } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-meta] listening on http://127.0.0.1:${PORT}`);
});
