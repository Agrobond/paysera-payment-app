import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Mirrors the `paths` in tsconfig.json. Without these, anything importing
  // `@/...` -- which is every module outside src/modules -- can't be tested at
  // all. Order matters: `@/generated` must be tried before the broader `@/`.
  resolve: {
    alias: [
      {
        find: /^@\/generated\//,
        replacement: fileURLToPath(new URL("./generated/", import.meta.url)),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: {
    passWithNoTests: true,
    environment: "jsdom",
    setupFiles: "./src/setup-tests.ts",
    css: false,
  },
});
