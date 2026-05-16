import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    actiontypes: "./src/actiontypes.ts",
    "util/errors": "./src/util/errors.ts",
    "config/index": "./src/config/index.ts",
    "rovo/index": "./src/rovo/index.ts",
    "forge/remote/index": "./src/forge/remote/index.ts",
    "forge/remote/jwt": "./src/forge/remote/jwt.ts",
    "jira/platform-2": "./src/jira/platform-2/types.ts",
    "jira/platform-3": "./src/jira/platform-3/types.ts",
    "jira/servicedesk": "./src/jira/servicedesk/types.ts",
    "jira/software": "./src/jira/software/types.ts",
  },
  format: ["esm"],
  sourcemap: true,
  target: "node20",
  deps: {
    external: ["typescript", "yaml"],
  },
});
