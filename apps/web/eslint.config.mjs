import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// Next's recommended rules: React, hooks, accessibility (jsx-a11y) and Core Web Vitals.
const config = [
  { ignores: [".next/**", "next-env.d.ts", "coverage/**"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  prettier,
];

export default config;
