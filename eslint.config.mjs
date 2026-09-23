import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The service-role client bypasses RLS. Only these server modules may import
// it (docs/architecture.md §B). Adding a path here is a reviewed decision.
const serviceRoleAllowlist = [
  "src/lib/supabase/admin.ts",
  "src/server/auth/**",
  "src/server/files/**",
  "src/server/whatsapp/**",
  "src/app/api/**",
  "scripts/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: serviceRoleAllowlist,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "Service-role client bypasses RLS. Use @/lib/supabase/server, or add the module to serviceRoleAllowlist with a reason.",
            },
          ],
          patterns: [
            {
              group: ["**/supabase/admin"],
              message:
                "Service-role client bypasses RLS. See eslint.config.mjs.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
