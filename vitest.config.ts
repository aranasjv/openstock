import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws unless resolved with the react-server condition, which
      // vitest does not apply. Alias it to an empty module so server modules under test
      // can be imported normally while the guard still protects real client bundles.
      "server-only": path.resolve(__dirname, "__tests__/stubs/server-only.ts"),
    },
  },
});
