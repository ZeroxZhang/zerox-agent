import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**", "dist-electron/**", "dist-native/**", "node_modules/**",
      "release*/**", "archive/**", ".tmp*/**", "eslint.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Unused identifiers are covered by strict tsc compilation; the lint
      // gate focuses on type hygiene and layer boundaries.
      "@typescript-eslint/no-unused-vars": "off",
      // Legacy codebase noise rules (pre-existing patterns).
      "no-useless-escape": "off",
      "no-console": "off",
      "no-control-regex": "off",
      "no-case-declarations": "off",
      "no-sparse-arrays": "off",
      "no-regex-spaces": "off",
      "no-extra-boolean-cast": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-require-imports": "off",
      "prefer-const": "off",
      "require-yield": "off",
    },
  },
  // Layer boundaries (mirrors the tsconfig include allowlists as rules).
  // Test files may import any layer by design (tsconfig.tests.json).
  {
    files: ["src/shared/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          { group: ["../main/**", "../renderer/**", "../preload/**"], message: "shared must not import main/renderer/preload" },
        ],
      }],
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          { group: ["../main/**", "../preload/**"], message: "renderer must not import main/preload" },
        ],
      }],
    },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          { group: ["../renderer/**"], message: "main/preload must not import renderer" },
        ],
      }],
    },
  },
);
