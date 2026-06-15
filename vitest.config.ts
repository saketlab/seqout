import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // Default to the fast `node` environment for pure-logic tests.
    // Component tests opt into jsdom with a `// @vitest-environment jsdom`
    // docblock at the top of the file (see Phase 4 tests).
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "public"],
  },
});
