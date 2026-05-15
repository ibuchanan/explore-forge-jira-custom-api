/**
 * Tests for the Forge KVS storage adapter.
 *
 * @forge/kvs is a Forge runtime module not available in Node test environments,
 * so we mock it entirely with vi.mock() and verify that our adapter applies
 * the correct internal key/value prefixes before calling through to KVS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @forge/kvs before any imports that use it.
//
// vi.hoisted() ensures the mock object is created BEFORE the vi.mock() factory
// runs (vi.mock calls are hoisted to the top of the file by Vitest's transform,
// so any variables they reference must also be hoisted).
// ---------------------------------------------------------------------------

const mockKvs = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@forge/kvs", () => ({
  kvs: mockKvs,
  WhereConditions: {
    beginsWith: (prefix: string) => ({ type: "beginsWith", prefix }),
  },
}));

// Import after mock is set up
import {
  createForgeKvsStore,
  listStoredConfigKeys,
} from "../../src/config/forge-kvs-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createForgeKvsStore – get()
// ---------------------------------------------------------------------------

describe("ForgeKvsStore.get()", () => {
  it("namespaces the key with 'config:' prefix when reading", async () => {
    mockKvs.get.mockResolvedValue("hello");
    const store = createForgeKvsStore();
    await store.get("baseUrl");
    expect(mockKvs.get).toHaveBeenCalledWith("config:baseUrl");
  });

  it("returns the plain value for non-secret entries", async () => {
    mockKvs.get.mockResolvedValue("https://example.com");
    const store = createForgeKvsStore();
    const result = await store.get("baseUrl");
    expect(result).toBe("https://example.com");
  });

  it("strips the 'secret:' prefix when returning a secret value", async () => {
    mockKvs.get.mockResolvedValue("secret:my-api-key");
    const store = createForgeKvsStore();
    const result = await store.get("apiKey");
    expect(result).toBe("my-api-key");
  });

  it("returns undefined when KVS returns undefined", async () => {
    mockKvs.get.mockResolvedValue(undefined);
    const store = createForgeKvsStore();
    const result = await store.get("missing");
    expect(result).toBeUndefined();
  });

  it("returns undefined when KVS returns null (not a string)", async () => {
    mockKvs.get.mockResolvedValue(null);
    const store = createForgeKvsStore();
    const result = await store.get("missing");
    expect(result).toBeUndefined();
  });

  it("returns undefined when KVS returns a number (not a string)", async () => {
    mockKvs.get.mockResolvedValue(42);
    const store = createForgeKvsStore();
    const result = await store.get("numericValue");
    expect(result).toBeUndefined();
  });

  it("handles a secret value that itself contains 'secret:' in the actual value", async () => {
    // Value stored is "secret:secret:actual" — only the outer prefix is stripped
    mockKvs.get.mockResolvedValue("secret:secret:actual");
    const store = createForgeKvsStore();
    const result = await store.get("nested");
    expect(result).toBe("secret:actual");
  });
});

// ---------------------------------------------------------------------------
// createForgeKvsStore – set()
// ---------------------------------------------------------------------------

describe("ForgeKvsStore.set()", () => {
  it("namespaces the key with 'config:' prefix when writing", async () => {
    mockKvs.set.mockResolvedValue(undefined);
    const store = createForgeKvsStore();
    await store.set("baseUrl", "https://example.com", false);
    expect(mockKvs.set).toHaveBeenCalledWith(
      "config:baseUrl",
      "https://example.com",
    );
  });

  it("stores plain values without a prefix when isSecret=false", async () => {
    mockKvs.set.mockResolvedValue(undefined);
    const store = createForgeKvsStore();
    await store.set("timeout", "5000", false);
    expect(mockKvs.set).toHaveBeenCalledWith("config:timeout", "5000");
  });

  it("prepends 'secret:' prefix to values when isSecret=true", async () => {
    mockKvs.set.mockResolvedValue(undefined);
    const store = createForgeKvsStore();
    await store.set("apiKey", "my-secret", true);
    expect(mockKvs.set).toHaveBeenCalledWith(
      "config:apiKey",
      "secret:my-secret",
    );
  });

  it("round-trips a secret value correctly (set then get)", async () => {
    // Simulate KVS storing what set() writes and returning it on get()
    let stored: unknown;
    mockKvs.set.mockImplementation((_key: string, val: unknown) => {
      stored = val;
      return Promise.resolve();
    });
    mockKvs.get.mockImplementation(() => Promise.resolve(stored));

    const store = createForgeKvsStore();
    await store.set("apiKey", "top-secret", true);
    const result = await store.get("apiKey");
    expect(result).toBe("top-secret");
  });

  it("round-trips a plain value correctly (set then get)", async () => {
    let stored: unknown;
    mockKvs.set.mockImplementation((_key: string, val: unknown) => {
      stored = val;
      return Promise.resolve();
    });
    mockKvs.get.mockImplementation(() => Promise.resolve(stored));

    const store = createForgeKvsStore();
    await store.set("baseUrl", "https://api.example.com", false);
    const result = await store.get("baseUrl");
    expect(result).toBe("https://api.example.com");
  });
});

// ---------------------------------------------------------------------------
// createForgeKvsStore – delete()
// ---------------------------------------------------------------------------

describe("ForgeKvsStore.delete()", () => {
  it("namespaces the key with 'config:' prefix when deleting", async () => {
    mockKvs.delete.mockResolvedValue(undefined);
    const store = createForgeKvsStore();
    await store.delete("apiKey");
    expect(mockKvs.delete).toHaveBeenCalledWith("config:apiKey");
  });
});

// ---------------------------------------------------------------------------
// listStoredConfigKeys()
// ---------------------------------------------------------------------------

describe("listStoredConfigKeys()", () => {
  it("returns field names stripped of the 'config:' prefix", async () => {
    mockKvs.query.mockReturnValue({
      where: () => ({
        getMany: () =>
          Promise.resolve({
            results: [
              { key: "config:apiKey", value: "secret:s3cr3t" },
              { key: "config:baseUrl", value: "https://example.com" },
            ],
          }),
      }),
    });

    const keys = await listStoredConfigKeys();
    expect(keys).toEqual(["apiKey", "baseUrl"]);
  });

  it("returns an empty array when no config keys are stored", async () => {
    mockKvs.query.mockReturnValue({
      where: () => ({
        getMany: () => Promise.resolve({ results: [] }),
      }),
    });

    const keys = await listStoredConfigKeys();
    expect(keys).toEqual([]);
  });

  it("only returns keys that begin with the 'config:' prefix", async () => {
    // The WhereConditions filter is applied by KVS itself; we verify our
    // adapter calls query().where() with the correct prefix argument
    let capturedCondition: unknown;
    mockKvs.query.mockReturnValue({
      where: (field: string, condition: unknown) => {
        capturedCondition = { field, condition };
        return {
          getMany: () => Promise.resolve({ results: [] }),
        };
      },
    });

    await listStoredConfigKeys();
    expect(capturedCondition).toMatchObject({
      field: "key",
      condition: { type: "beginsWith", prefix: "config:" },
    });
  });
});
