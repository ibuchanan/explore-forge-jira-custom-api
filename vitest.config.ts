import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    alias: {
      // @forge/api is a Forge runtime package not available locally.
      // Tests that import it (directly or transitively) use this stub.
      "@forge/api": new URL("./tests/__mocks__/@forge/api.ts", import.meta.url)
        .pathname,
    },
  },
});
