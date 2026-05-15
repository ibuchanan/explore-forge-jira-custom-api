/**
 * Schema builder for the forge-ahead configuration utility.
 *
 * Provides a Zod-like fluent API for defining typed configuration schemas.
 * All values are strings (Forge environment variables and KV storage are
 * both string-based), but fields can be tagged as secrets so that UIs and
 * storage adapters can handle them appropriately.
 *
 * Usage:
 *
 *   import { fc } from "forge-ahead/config";
 *
 *   export const myConfig = fc.object({
 *     apiKey:  fc.secret().string(),   // masked in UI, stored with secret hint
 *     baseUrl: fc.string(),            // plain text field
 *   });
 */

import type { Schema, SchemaField, SchemaFieldMetadata } from "./types";

// ---------------------------------------------------------------------------
// Builder classes
// ---------------------------------------------------------------------------

/**
 * Terminal builder that produces a {@link SchemaField}.
 * Instantiated by {@link SchemaBuilder.string} or {@link SecretBuilder.string}.
 */
class StringBuilder {
  private readonly _isSecret: boolean;

  constructor(isSecret = false) {
    this._isSecret = isSecret;
  }

  /** Build and return the field descriptor. */
  string(): SchemaField {
    return { type: "string", isSecret: this._isSecret };
  }
}

/**
 * Intermediate builder returned by `fc.secret()`.
 * Calling `.string()` on it produces a secret-tagged field.
 */
class SecretBuilder {
  string(): SchemaField {
    return { type: "string", isSecret: true };
  }
}

/**
 * Top-level schema builder, exported as the `fc` constant.
 */
class SchemaBuilder {
  /**
   * Wrap a map of fields into a {@link Schema} object.
   *
   * TypeScript will infer the exact keys from the record you pass in, giving
   * you compile-time checking when you look up field names later.
   */
  object<T extends Record<string, SchemaField>>(
    fields: T,
  ): Schema & { fields: T } {
    return { fields };
  }

  /** Create a plain (non-secret) string field. */
  string(): SchemaField {
    return new StringBuilder(false).string();
  }

  /**
   * Begin building a secret field.
   * Chain `.string()` to complete: `fc.secret().string()`.
   */
  secret(): SecretBuilder {
    return new SecretBuilder();
  }
}

// ---------------------------------------------------------------------------
// Singleton builder – the public API
// ---------------------------------------------------------------------------

/**
 * **fc** – Forge Config schema builder.
 *
 * Create configuration schemas with a fluent, Zod-inspired API:
 *
 * ```ts
 * import { fc } from "forge-ahead/config";
 *
 * export const appConfig = fc.object({
 *   apiKey:  fc.secret().string(),
 *   baseUrl: fc.string(),
 *   timeout: fc.string(),
 * });
 * ```
 */
export const fc = new SchemaBuilder();

// ---------------------------------------------------------------------------
// Schema inspection helpers
// ---------------------------------------------------------------------------

/**
 * Return all field names declared in a schema.
 *
 * ```ts
 * getFieldNames(appConfig); // ["apiKey", "baseUrl", "timeout"]
 * ```
 */
export function getFieldNames(schema: Schema): string[] {
  return Object.keys(schema.fields);
}

/**
 * Return `true` when `fieldName` is marked as a secret in `schema`.
 * Returns `false` for unknown field names rather than throwing.
 */
export function isSecretField(schema: Schema, fieldName: string): boolean {
  return schema.fields[fieldName]?.isSecret ?? false;
}

/**
 * Return a serialisable array of field metadata suitable for driving a
 * configuration UI component.
 *
 * ```ts
 * getSchemaMetadata(appConfig);
 * // [
 * //   { name: "apiKey",  type: "string", isSecret: true  },
 * //   { name: "baseUrl", type: "string", isSecret: false },
 * //   { name: "timeout", type: "string", isSecret: false },
 * // ]
 * ```
 */
export function getSchemaMetadata(schema: Schema): SchemaFieldMetadata[] {
  return Object.entries(schema.fields).map(([name, field]) => ({
    name,
    type: field.type,
    isSecret: field.isSecret,
  }));
}
