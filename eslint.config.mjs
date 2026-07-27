import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.nodeBuiltin
      }
    },
    plugins: {
      "@next/next": next,
      "react-hooks": reactHooks
    },
    rules: {
      ...next.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat.recommended.rules,
      "@typescript-eslint/no-empty-object-type": "off",
      "no-control-regex": "off",
      "no-empty-pattern": "off",
      "no-unsafe-finally": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "preserve-caught-error": "off"
    }
  },
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
