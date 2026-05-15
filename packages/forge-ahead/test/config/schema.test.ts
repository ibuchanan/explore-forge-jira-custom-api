import { describe, expect, it } from "vitest";
import {
  fc,
  getFieldNames,
  getSchemaMetadata,
  isSecretField,
} from "../../src/config/schema";

describe("schema builder (fc)", () => {
  describe("fc.string()", () => {
    it("returns a non-secret string field", () => {
      const field = fc.string();
      expect(field).toEqual({ type: "string", isSecret: false });
    });
  });

  describe("fc.secret().string()", () => {
    it("returns a secret-tagged string field", () => {
      const field = fc.secret().string();
      expect(field).toEqual({ type: "string", isSecret: true });
    });
  });

  describe("fc.object()", () => {
    it("wraps fields into a Schema", () => {
      const schema = fc.object({
        apiKey: fc.secret().string(),
        baseUrl: fc.string(),
      });
      expect(schema.fields).toHaveProperty("apiKey");
      expect(schema.fields).toHaveProperty("baseUrl");
      expect(schema.fields.apiKey?.isSecret).toBe(true);
      expect(schema.fields.baseUrl?.isSecret).toBe(false);
    });

    it("preserves all declared fields", () => {
      const schema = fc.object({
        a: fc.string(),
        b: fc.string(),
        c: fc.secret().string(),
      });
      expect(Object.keys(schema.fields)).toHaveLength(3);
    });
  });
});

describe("getFieldNames()", () => {
  it("returns all field names in declaration order", () => {
    const schema = fc.object({
      apiKey: fc.secret().string(),
      baseUrl: fc.string(),
      timeout: fc.string(),
    });
    expect(getFieldNames(schema)).toEqual(["apiKey", "baseUrl", "timeout"]);
  });

  it("returns an empty array for an empty schema", () => {
    const schema = fc.object({});
    expect(getFieldNames(schema)).toEqual([]);
  });
});

describe("isSecretField()", () => {
  const schema = fc.object({
    apiKey: fc.secret().string(),
    baseUrl: fc.string(),
  });

  it("returns true for a secret field", () => {
    expect(isSecretField(schema, "apiKey")).toBe(true);
  });

  it("returns false for a non-secret field", () => {
    expect(isSecretField(schema, "baseUrl")).toBe(false);
  });

  it("returns false for an unknown field (does not throw)", () => {
    expect(isSecretField(schema, "nonExistent")).toBe(false);
  });
});

describe("getSchemaMetadata()", () => {
  it("returns metadata for all fields", () => {
    const schema = fc.object({
      apiKey: fc.secret().string(),
      baseUrl: fc.string(),
    });
    const meta = getSchemaMetadata(schema);
    expect(meta).toHaveLength(2);
    expect(meta).toContainEqual({
      name: "apiKey",
      type: "string",
      isSecret: true,
    });
    expect(meta).toContainEqual({
      name: "baseUrl",
      type: "string",
      isSecret: false,
    });
  });

  it("returns an empty array for an empty schema", () => {
    expect(getSchemaMetadata(fc.object({}))).toEqual([]);
  });
});
