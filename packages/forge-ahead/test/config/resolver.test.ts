import { afterEach, describe, expect, it, vi } from "vitest";
import { fc } from "../../src/config/schema";
import {
  deleteConfigValue,
  getAllConfigValues,
  getAllConfigValuesWithSource,
  getConfigValue,
  getConfigValueWithSource,
  setConfigValues,
} from "../../src/config/resolver";
import type { ConfigStore } from "../../src/config/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an in-memory ConfigStore for testing – no Forge runtime needed. */
function makeMemoryStore(
  initial: Record<string, string> = {},
): ConfigStore & { _data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    _data: data,
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

const testSchema = fc.object({
  apiKey: fc.secret().string(),
  baseUrl: fc.string(),
  timeout: fc.string(),
});

// ---------------------------------------------------------------------------
// getConfigValue
// ---------------------------------------------------------------------------

describe("getConfigValue()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns value from store when present", async () => {
    const store = makeMemoryStore({ apiKey: "secret-value" });
    const result = await getConfigValue(testSchema, "apiKey", store);
    expect(result).toBe("secret-value");
  });

  it("prefers store over environment variable", async () => {
    vi.stubEnv("FORGE_API_KEY", "env-value");
    const store = makeMemoryStore({ apiKey: "store-value" });
    const result = await getConfigValue(testSchema, "apiKey", store);
    expect(result).toBe("store-value");
  });

  it("falls back to environment variable when store is empty", async () => {
    vi.stubEnv("FORGE_BASE_URL", "https://example.com");
    const store = makeMemoryStore();
    const result = await getConfigValue(testSchema, "baseUrl", store);
    expect(result).toBe("https://example.com");
  });

  it("returns undefined when neither store nor env var is set", async () => {
    const store = makeMemoryStore();
    const result = await getConfigValue(testSchema, "timeout", store);
    expect(result).toBeUndefined();
  });

  it("throws for an unknown field name", async () => {
    const store = makeMemoryStore();
    await expect(
      // @ts-expect-error – deliberate invalid field name
      getConfigValue(testSchema, "nonExistent", store),
    ).rejects.toThrow("Field 'nonExistent' not found in schema");
  });

  it("converts camelCase field names to FORGE_ env vars correctly", async () => {
    vi.stubEnv("FORGE_API_KEY", "converted");
    const store = makeMemoryStore();
    const result = await getConfigValue(testSchema, "apiKey", store);
    expect(result).toBe("converted");
  });
});

// ---------------------------------------------------------------------------
// getConfigValueWithSource
// ---------------------------------------------------------------------------

describe("getConfigValueWithSource()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports source as 'kv-store' when value is in store", async () => {
    const store = makeMemoryStore({ apiKey: "s3cr3t" });
    const result = await getConfigValueWithSource(testSchema, "apiKey", store);
    expect(result).toEqual({ value: "s3cr3t", source: "kv-store" });
  });

  it("reports source as 'environment' when value is in env var only", async () => {
    vi.stubEnv("FORGE_BASE_URL", "https://api.example.com");
    const store = makeMemoryStore();
    const result = await getConfigValueWithSource(testSchema, "baseUrl", store);
    expect(result).toEqual({
      value: "https://api.example.com",
      source: "environment",
    });
  });

  it("reports source as 'not-configured' when value is absent", async () => {
    const store = makeMemoryStore();
    const result = await getConfigValueWithSource(testSchema, "timeout", store);
    expect(result).toEqual({ value: null, source: "not-configured" });
  });

  it("throws for an unknown field name", async () => {
    const store = makeMemoryStore();
    await expect(
      // @ts-expect-error – deliberate invalid field name
      getConfigValueWithSource(testSchema, "nonExistent", store),
    ).rejects.toThrow("Field 'nonExistent' not found in schema");
  });
});

// ---------------------------------------------------------------------------
// getAllConfigValues
// ---------------------------------------------------------------------------

describe("getAllConfigValues()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns all field values from the store", async () => {
    const store = makeMemoryStore({ apiKey: "key", baseUrl: "https://x.com" });
    const result = await getAllConfigValues(testSchema, store);
    expect(result).toEqual({
      apiKey: "key",
      baseUrl: "https://x.com",
      timeout: null,
    });
  });

  it("returns null for fields with no value anywhere", async () => {
    const store = makeMemoryStore();
    const result = await getAllConfigValues(testSchema, store);
    expect(result).toEqual({ apiKey: null, baseUrl: null, timeout: null });
  });

  it("falls back to env var for missing store values", async () => {
    vi.stubEnv("FORGE_TIMEOUT", "5000");
    const store = makeMemoryStore();
    const result = await getAllConfigValues(testSchema, store);
    expect(result.timeout).toBe("5000");
  });
});

// ---------------------------------------------------------------------------
// getAllConfigValuesWithSource
// ---------------------------------------------------------------------------

describe("getAllConfigValuesWithSource()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns correct sources for mixed origin values", async () => {
    vi.stubEnv("FORGE_TIMEOUT", "3000");
    const store = makeMemoryStore({ apiKey: "s3cr3t" });
    const result = await getAllConfigValuesWithSource(testSchema, store);
    expect(result.apiKey).toEqual({ value: "s3cr3t", source: "kv-store" });
    expect(result.timeout).toEqual({ value: "3000", source: "environment" });
    expect(result.baseUrl).toEqual({ value: null, source: "not-configured" });
  });
});

// ---------------------------------------------------------------------------
// setConfigValues
// ---------------------------------------------------------------------------

describe("setConfigValues()", () => {
  it("writes values to the store", async () => {
    const store = makeMemoryStore();
    await setConfigValues(testSchema, { baseUrl: "https://new.com" }, store);
    expect(store._data.get("baseUrl")).toBe("https://new.com");
  });

  it("passes isSecret=true for secret fields", async () => {
    const calls: { key: string; value: string; isSecret: boolean }[] = [];
    const store: ConfigStore = {
      async get() {
        return undefined;
      },
      async set(key, value, isSecret) {
        calls.push({ key, value, isSecret });
      },
      async delete() {
        /* no-op */
      },
    };
    await setConfigValues(testSchema, { apiKey: "abc123" }, store);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      key: "apiKey",
      value: "abc123",
      isSecret: true,
    });
  });

  it("passes isSecret=false for non-secret fields", async () => {
    const calls: { key: string; value: string; isSecret: boolean }[] = [];
    const store: ConfigStore = {
      async get() {
        return undefined;
      },
      async set(key, value, isSecret) {
        calls.push({ key, value, isSecret });
      },
      async delete() {
        /* no-op */
      },
    };
    await setConfigValues(testSchema, { baseUrl: "https://x.com" }, store);
    expect(calls[0]?.isSecret).toBe(false);
  });

  it("throws for unknown field names without writing anything", async () => {
    const store = makeMemoryStore();
    await expect(
      // @ts-expect-error – deliberate invalid field name
      setConfigValues(testSchema, { unknownField: "value" }, store),
    ).rejects.toThrow("Field 'unknownField' not found in schema");
    expect(store._data.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteConfigValue
// ---------------------------------------------------------------------------

describe("deleteConfigValue()", () => {
  it("removes the key from the store", async () => {
    const store = makeMemoryStore({ apiKey: "old" });
    await deleteConfigValue(testSchema, "apiKey", store);
    expect(store._data.has("apiKey")).toBe(false);
  });

  it("throws for unknown field names", async () => {
    const store = makeMemoryStore();
    await expect(
      // @ts-expect-error – deliberate invalid field name
      deleteConfigValue(testSchema, "nonExistent", store),
    ).rejects.toThrow("Field 'nonExistent' not found in schema");
  });
});

// ---------------------------------------------------------------------------
// fieldNameToEnvVar conversion (tested via getConfigValue behaviour)
// ---------------------------------------------------------------------------

describe("env var name conversion (fieldNameToEnvVar)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const cases: Array<[string, string]> = [
    ["apiKey", "FORGE_API_KEY"],
    ["baseUrl", "FORGE_BASE_URL"],
    ["timeout", "FORGE_TIMEOUT"],
    ["myFieldName", "FORGE_MY_FIELD_NAME"],
    ["x", "FORGE_X"],
  ];

  const schema = fc.object(
    Object.fromEntries(cases.map(([field]) => [field, fc.string()])) as Record<
      string,
      ReturnType<typeof fc.string>
    >,
  );

  for (const [fieldName, envVar] of cases) {
    it(`maps '${fieldName}' → '${envVar}'`, async () => {
      vi.stubEnv(envVar, "test-value");
      const store = makeMemoryStore();
      const result = await getConfigValue(schema, fieldName, store);
      expect(result).toBe("test-value");
    });
  }
});

// ---------------------------------------------------------------------------
// setConfigValues – atomicity (validation before any write)
// ---------------------------------------------------------------------------

describe("setConfigValues() atomicity", () => {
  it("writes nothing when any field name is invalid", async () => {
    const store = makeMemoryStore();
    await expect(
      setConfigValues(
        testSchema,
        // @ts-expect-error – deliberate mix of valid and invalid field names
        { baseUrl: "https://valid.com", unknownField: "bad" },
        store,
      ),
    ).rejects.toThrow("Field 'unknownField' not found in schema");

    // baseUrl must NOT have been written despite appearing first
    expect(store._data.has("baseUrl")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAllConfigValues – store error propagation
// ---------------------------------------------------------------------------

describe("getAllConfigValues() error propagation", () => {
  it("rejects when the store throws on one of the concurrent reads", async () => {
    const brokenStore: ConfigStore = {
      async get(key) {
        if (key === "apiKey") throw new Error("KVS connection error");
        return undefined;
      },
      async set() {
        /* no-op */
      },
      async delete() {
        /* no-op */
      },
    };

    await expect(getAllConfigValues(testSchema, brokenStore)).rejects.toThrow(
      "KVS connection error",
    );
  });
});
