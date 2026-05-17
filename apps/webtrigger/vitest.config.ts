import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    alias: {
      // @forge/api is a Forge runtime package not available locally.
      // Tests that import it (directly or transitively) use this stub.
      "@forge/api": new URL("./tests/__mocks__/@forge/api.ts", import.meta.url)
        .pathname,
      // forge-ahead is a local workspace package built to dist/. Point vitest
      // directly at source so tests don't require a prior build step.
      "forge-ahead/api": new URL(
        "../../packages/forge-ahead/src/api/index.ts",
        import.meta.url,
      ).pathname,
      "forge-ahead/config": new URL(
        "../../packages/forge-ahead/src/config/index.ts",
        import.meta.url,
      ).pathname,
      "forge-ahead/errors": new URL(
        "../../packages/forge-ahead/src/util/errors.ts",
        import.meta.url,
      ).pathname,
      "forge-ahead/rovo": new URL(
        "../../packages/forge-ahead/src/rovo/index.ts",
        import.meta.url,
      ).pathname,
      "forge-ahead/remote": new URL(
        "../../packages/forge-ahead/src/forge/remote/index.ts",
        import.meta.url,
      ).pathname,
      "forge-ahead/remote/jwt": new URL(
        "../../packages/forge-ahead/src/forge/remote/jwt.ts",
        import.meta.url,
      ).pathname,
      // Main entry must come last (subpaths above take priority)
      "forge-ahead": new URL(
        "../../packages/forge-ahead/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
