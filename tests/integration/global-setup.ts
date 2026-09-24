import { execFileSync } from "node:child_process";

// Reads URLs/keys of the LOCAL Supabase stack (`npx supabase start`).
// These are the well-known local demo keys, never production credentials.
export default function setup() {
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(raw.slice(raw.indexOf("{")));
  if (!String(status.API_URL).startsWith("http://127.0.0.1")) {
    throw new Error(
      "Integration tests only run against the local Supabase stack.",
    );
  }
  process.env.TEST_SUPABASE_URL = status.API_URL;
  process.env.TEST_ANON_KEY = status.ANON_KEY;
  process.env.TEST_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  process.env.TEST_JWT_SECRET = status.JWT_SECRET;
  process.env.TEST_DB_URL = status.DB_URL;
}
