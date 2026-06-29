/**
 * Vitest alias stub for @forge/api.
 *
 * Forge runtime packages are not available outside the Forge platform.
 * This stub provides just enough surface area for unit tests to import
 * modules that depend on @forge/api without crashing.
 *
 * Tests that exercise Jira API calls should mock jira-client.ts directly
 * (as the handler tests do) rather than mocking @forge/api itself.
 */

/** route tagged-template stub — returns the template string as-is */
export const route = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): string => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "");

/** Minimal api stub with asUser/asApp chains */
const makeApiClient = () => ({
  requestJira: async (_path: unknown, _opts?: unknown) => {
    throw new Error("@forge/api stub: use jira-client.ts mock in tests");
  },
  requestConfluence: async (_path: unknown, _opts?: unknown) => {
    throw new Error("@forge/api stub: use jira-client.ts mock in tests");
  },
});

const api = {
  asUser: () => makeApiClient(),
  asApp: () => makeApiClient(),
};

export default api;
