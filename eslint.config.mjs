import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["modules/**/*.{ts,tsx}", "db/**/*.ts", "workers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**", "@/components/**"],
              message: "Domain and platform modules cannot depend on UI/runtime adapters."
            }
          ]
        }
      ]
    }
  },
  globalIgnores([
    ".next/**",
    "dist/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts"
  ])
]);
