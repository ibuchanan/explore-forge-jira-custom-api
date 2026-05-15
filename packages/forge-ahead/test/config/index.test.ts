/**
 * Smoke tests for the forge-ahead/config barrel export.
 *
 * These tests don't re-test behaviour (that lives in schema.test.ts,
 * resolver.test.ts, and forge-kvs-store.test.ts). Their purpose is to catch
 * accidental omissions from the index.ts barrel: if a symbol is removed or
 * renamed but the barrel still compiles (e.g. via `export * from`), the
 * import here will fail at runtime and the test will break loudly.
 */

import { describe, expect, it } from "vitest";

import {
  // Schema builder
  fc,
  getFieldNames,
  getSchemaMetadata,
  isSecretField,
  // Resolver functions
  deleteConfigValue,
  getAllConfigValues,
  getAllConfigValuesWithSource,
  getConfigValue,
  getConfigValueWithSource,
  setConfigValues,
  // Forge KVS adapter
  createForgeKvsStore,
  listStoredConfigKeys,
} from "../../src/config/index";

describe("forge-ahead/config barrel exports", () => {
  it("exports the fc schema builder as a function", () => {
    expect(typeof fc.object).toBe("function");
    expect(typeof fc.string).toBe("function");
    expect(typeof fc.secret).toBe("function");
  });

  it("exports schema inspection helpers as functions", () => {
    expect(typeof getFieldNames).toBe("function");
    expect(typeof isSecretField).toBe("function");
    expect(typeof getSchemaMetadata).toBe("function");
  });

  it("exports all resolver functions as async functions", () => {
    expect(typeof getConfigValue).toBe("function");
    expect(typeof getConfigValueWithSource).toBe("function");
    expect(typeof getAllConfigValues).toBe("function");
    expect(typeof getAllConfigValuesWithSource).toBe("function");
    expect(typeof setConfigValues).toBe("function");
    expect(typeof deleteConfigValue).toBe("function");
  });

  it("exports Forge KVS adapter functions", () => {
    expect(typeof createForgeKvsStore).toBe("function");
    expect(typeof listStoredConfigKeys).toBe("function");
  });

  it("fc.object() produces a schema usable by resolver functions", async () => {
    const schema = fc.object({ key: fc.string() });
    const store = {
      async get() {
        return "value";
      },
      async set() {
        /* no-op */
      },
      async delete() {
        /* no-op */
      },
    };
    const result = await getConfigValue(schema, "key", store);
    expect(result).toBe("value");
  });
});
