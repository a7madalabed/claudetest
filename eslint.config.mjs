// Shared ESLint "flat config" for every TypeScript package except the Next.js
// app (which extends this with Next-specific rules in apps/web).
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Unused variables are usually bugs; allow an underscore prefix for intentional ones.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Forces `import type` for type-only imports, which keeps runtime bundles lean.
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "warn",
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Command-line scripts talk to a human through the terminal; console is their UI.
    files: ["**/src/cli/**"],
    rules: { "no-console": "off" },
  },
  // Must be last: turns off any rules that would fight with Prettier's formatting.
  prettier,
);
