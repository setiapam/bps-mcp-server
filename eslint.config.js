import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const workerOnlyFiles = [
  "src/worker.ts",
  "src/worker-mcp.ts",
  "src/worker-codemode-proxy.ts",
  "src/worker-rate-limit.ts",
  "src/auth/oauth-handler.ts",
  "src/services/kv-cache.ts",
  "src/services/kv-store.ts",
  "src/api/learning-api.ts",
  "src/config/worker-config.ts",
];

const sharedRules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/no-explicit-any": "warn",
};

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: workerOnlyFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: sharedRules,
  },
  {
    files: workerOnlyFiles,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.worker.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: sharedRules,
  },
  {
    ignores: ["dist/", "dist-worker/", "tests/", "node_modules/"],
  }
);
