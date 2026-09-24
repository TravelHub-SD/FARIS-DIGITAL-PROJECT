// Decides which WhatsApp driver may run. Pure (no server-only import) so it
// can be unit-tested and called from instrumentation at boot.
//
// The dev driver prints OTP codes to the local console. It is allowed ONLY
// when NODE_ENV is "development" or "test" AND the process is not a Vercel
// preview/production deployment. Anything else refuses to start.

export type WhatsAppDriverName = "dev" | "meta";

type Env = Record<string, string | undefined>;

export class WhatsAppDriverRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppDriverRefusedError";
  }
}

export function isLocalDevelopmentRuntime(env: Env): boolean {
  const nodeEnv = env.NODE_ENV;
  const vercelEnv = env.VERCEL_ENV;
  const localNode = nodeEnv === "development" || nodeEnv === "test";
  const notDeployed =
    vercelEnv === undefined || vercelEnv === "" || vercelEnv === "development";
  return localNode && notDeployed;
}

export function resolveWhatsAppDriver(env: Env): WhatsAppDriverName {
  const name = env.WHATSAPP_DRIVER;
  if (name !== "dev" && name !== "meta") {
    throw new WhatsAppDriverRefusedError(
      `WHATSAPP_DRIVER must be "dev" or "meta" (got ${JSON.stringify(name ?? null)}).`,
    );
  }
  if (name === "dev" && !isLocalDevelopmentRuntime(env)) {
    throw new WhatsAppDriverRefusedError(
      `WhatsApp dev driver refused: it prints OTP codes and may only run locally ` +
        `(NODE_ENV=${env.NODE_ENV ?? "unset"}, VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}).`,
    );
  }
  return name;
}
