/**
 * Shared types for the forge-ahead configuration utility.
 *
 * These types are used across the schema builder, the core resolution logic,
 * and any storage adapters (e.g. the Forge KVS adapter).
 */

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

/** The only supported field type for now – all config values are strings. */
export type FieldType = "string";

/** Metadata about a single configuration field. */
export interface SchemaField {
  type: FieldType;
  /** When true the value should be masked in UIs and stored carefully. */
  isSecret: boolean;
}

/** A complete configuration schema: a named set of fields. */
export interface Schema {
  fields: Record<string, SchemaField>;
}

// ---------------------------------------------------------------------------
// Resolution types
// ---------------------------------------------------------------------------

/**
 * Where a configuration value was found during resolution.
 *
 * - `"kv-store"`      – value was read from persistent (KV) storage
 * - `"environment"`   – value was read from an environment variable
 * - `"not-configured"` – no value was found anywhere
 */
export type ConfigSource = "kv-store" | "environment" | "not-configured";

/** A resolved configuration value together with its source. */
export interface ConfigValueWithSource {
  value: string | null;
  source: ConfigSource;
}

/** Metadata about a schema field, suitable for driving UIs. */
export interface SchemaFieldMetadata {
  name: string;
  type: FieldType;
  isSecret: boolean;
}

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * A simple read/write/delete interface that the resolution layer depends on.
 *
 * Implement this to plug any backing store into the config utility.
 * The Forge KVS adapter (`forge-kvs-store.ts`) is the canonical implementation
 * for apps running on the Forge platform.
 */
export interface ConfigStore {
  /**
   * Return the stored string for `key`, or `undefined` when absent.
   * The implementation is responsible for stripping any internal prefixes or
   * encoding that it uses; callers receive a plain string value.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Persist `value` under `key`.
   * @param isSecret - Implementations may use this hint to apply additional
   *   protection (e.g. a storage prefix), but MUST NOT rely on it as the sole
   *   security boundary.
   */
  set(key: string, value: string, isSecret: boolean): Promise<void>;

  /** Remove the stored value for `key`.  No-ops if the key does not exist. */
  delete(key: string): Promise<void>;
}
