import { describe, expect, it } from "vitest";

import { createDevDriver } from "@/server/whatsapp/dev-driver";
import { resolveWhatsAppDriver } from "@/server/whatsapp/guard";

describe("WhatsApp dev driver can never run in production", () => {
  const refused: Record<string, string | undefined>[] = [
    { NODE_ENV: "production", WHATSAPP_DRIVER: "dev" },
    {
      NODE_ENV: "production",
      WHATSAPP_DRIVER: "dev",
      VERCEL_ENV: "production",
    },
    { NODE_ENV: "production", WHATSAPP_DRIVER: "dev", VERCEL_ENV: "preview" },
    { NODE_ENV: "development", WHATSAPP_DRIVER: "dev", VERCEL_ENV: "preview" },
    {
      NODE_ENV: "development",
      WHATSAPP_DRIVER: "dev",
      VERCEL_ENV: "production",
    },
    { NODE_ENV: undefined, WHATSAPP_DRIVER: "dev" },
    { NODE_ENV: "staging", WHATSAPP_DRIVER: "dev" },
  ];
  for (const env of refused) {
    it(`refuses dev driver with ${JSON.stringify(env)}`, () => {
      expect(() => resolveWhatsAppDriver(env)).toThrow(/dev driver refused/);
      expect(() => createDevDriver(env)).toThrow(/dev driver refused/);
    });
  }

  it("refuses a missing or unknown driver name", () => {
    expect(() => resolveWhatsAppDriver({ NODE_ENV: "production" })).toThrow(
      /WHATSAPP_DRIVER must be/,
    );
    expect(() =>
      resolveWhatsAppDriver({
        NODE_ENV: "development",
        WHATSAPP_DRIVER: "twilio",
      }),
    ).toThrow(/WHATSAPP_DRIVER must be/);
  });

  it("allows dev locally (development / test, not on Vercel preview/production)", () => {
    expect(
      resolveWhatsAppDriver({
        NODE_ENV: "development",
        WHATSAPP_DRIVER: "dev",
      }),
    ).toBe("dev");
    expect(
      resolveWhatsAppDriver({ NODE_ENV: "test", WHATSAPP_DRIVER: "dev" }),
    ).toBe("dev");
    expect(
      resolveWhatsAppDriver({
        NODE_ENV: "development",
        WHATSAPP_DRIVER: "dev",
        VERCEL_ENV: "development",
      }),
    ).toBe("dev");
  });

  it("allows the meta driver everywhere", () => {
    expect(
      resolveWhatsAppDriver({
        NODE_ENV: "production",
        WHATSAPP_DRIVER: "meta",
      }),
    ).toBe("meta");
  });

  it("a dev driver constructed locally still refuses to send if the runtime becomes production", async () => {
    const driver = createDevDriver({
      NODE_ENV: "test",
      WHATSAPP_DRIVER: "dev",
    });
    const original = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      await expect(
        driver.send({
          type: "otp",
          to: "+249911111111",
          code: "123456",
          locale: "ar",
        }),
      ).rejects.toThrow(/dev driver refused/);
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
    }
  });
});
