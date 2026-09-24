// Runs once when a Next.js server instance starts, before it serves requests.
// A misconfigured WhatsApp driver (missing, unknown, or the dev driver outside
// local development) stops the server here instead of failing on first use.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resolveWhatsAppDriver } = await import("./server/whatsapp/guard");
    resolveWhatsAppDriver(process.env);
  }
}
