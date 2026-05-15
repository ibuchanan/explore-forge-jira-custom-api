/**
 * Core configuration resolution logic for the forge-ahead config utility.
 *
 * Resolution priority (highest → lowest):
 *   1. Value from the provided {@link ConfigStore} (e.g. Forge KV storage)
 *   2. Environment variable  (FORGE_<UPPER_SNAKE_CASE_FIELD_NAME>)
 *   3. `undefined` / `null`
 *
 * This module is completely independent of any Forge runtime APIs.
 * All Forge-specific behaviour lives in storage adapters (e.g. `forge-kvs-store.ts`).
 */

import { getFieldNames } from "./schema";
import type { ConfigStore, ConfigValueWithSource, Schema } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase field name to the conventional FORGE_ env-var name.
 *
 * Examples:
 *   apiKey   → FORGE_API_KEY
 *   baseUrl  → FORGE_BASE_URL
 *   timeout  → FORGE_TIMEOUT
 */
function fieldNameToEnvVar(fieldName: string): string {
  return `FORGE_${fieldName.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Single-field resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single configuration value.
 *
 * Priority: KV Store → Environment Variable → `undefined`
 *
 * @param schema    The configuration schema (used to validate `fieldName`).
 * @param fieldName A key that must exist in `schema.fields`.
 * @param store     A {@link ConfigStore} implementation to check first.
 * @returns         The resolved string value, or `undefined` when not found.
 * @throws          When `fieldName` is not declared in `schema`.
 */
export async function getConfigValue(
  schema: Schema,
  fieldName: string,
  store: ConfigStore,
): Promise<string | undefined> {
  if (!schema.fields[fieldName]) {
    throw new Error(`Field '${fieldName}' not found in schema`);
  }

  // 1. Persistent storage wins
  const storedValue = await store.get(fieldName);
  if (storedValue !== undefined) {
    return storedValue;
  }

  // 2. Fall back to environment variable
  const envVar = fieldNameToEnvVar(fieldName);
  const envValue = process.env[envVar];
  if (envValue !== undefined) {
    return envValue;
  }

  return undefined;
}

/**
 * Resolve a single configuration value together with its source.
 * Useful for admin UIs that show where a setting is coming from.
 *
 * @param schema    The configuration schema.
 * @param fieldName A key that must exist in `schema.fields`.
 * @param store     A {@link ConfigStore} implementation.
 */
export async function getConfigValueWithSource(
  schema: Schema,
  fieldName: string,
  store: ConfigStore,
): Promise<ConfigValueWithSource> {
  if (!schema.fields[fieldName]) {
    throw new Error(`Field '${fieldName}' not found in schema`);
  }

  const storedValue = await store.get(fieldName);
  if (storedValue !== undefined) {
    return { value: storedValue, source: "kv-store" };
  }

  const envVar = fieldNameToEnvVar(fieldName);
  const envValue = process.env[envVar];
  if (envValue !== undefined) {
    return { value: envValue, source: "environment" };
  }

  return { value: null, source: "not-configured" };
}

// ---------------------------------------------------------------------------
// Bulk resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all fields in a schema, returning `null` for any that are absent.
 *
 * Fields are resolved concurrently via `Promise.all`.
 *
 * @param schema The configuration schema.
 * @param store  A {@link ConfigStore} implementation.
 * @returns      A record mapping every field name to its value (or `null`).
 */
export async function getAllConfigValues(
  schema: Schema,
  store: ConfigStore,
): Promise<Record<string, string | null>> {
  const fieldNames = getFieldNames(schema);

  const pairs = await Promise.all(
    fieldNames.map(async (name) => {
      const value = await getConfigValue(schema, name, store);
      return [name, value ?? null] as const;
    }),
  );

  return Object.fromEntries(pairs);
}

/**
 * Resolve all fields with source information.
 *
 * @param schema The configuration schema.
 * @param store  A {@link ConfigStore} implementation.
 * @returns      A record mapping every field name to `{ value, source }`.
 */
export async function getAllConfigValuesWithSource(
  schema: Schema,
  store: ConfigStore,
): Promise<Record<string, ConfigValueWithSource>> {
  const fieldNames = getFieldNames(schema);

  const pairs = await Promise.all(
    fieldNames.map(async (name) => {
      const entry = await getConfigValueWithSource(schema, name, store);
      return [name, entry] as const;
    }),
  );

  return Object.fromEntries(pairs);
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Persist one or more configuration values to a store.
 *
 * All field names are validated against the schema before any write is made.
 * Secret status is read from the schema and passed to the store's `set` method,
 * allowing the adapter to apply its own secret-handling strategy.
 *
 * @param schema The configuration schema.
 * @param values A partial record of field-name → string-value pairs to save.
 * @param store  A {@link ConfigStore} implementation.
 * @throws       When a field name in `values` is not declared in `schema`.
 * @throws       When a value is not a string.
 */
export async function setConfigValues(
  schema: Schema,
  values: Record<string, string>,
  store: ConfigStore,
): Promise<void> {
  // Validate all fields before writing anything
  for (const [fieldName, value] of Object.entries(values)) {
    if (!schema.fields[fieldName]) {
      throw new Error(`Field '${fieldName}' not found in schema`);
    }
    if (typeof value !== "string") {
      throw new Error(`Value for field '${fieldName}' must be a string`);
    }
  }

  // Write sequentially to avoid race conditions on the same store
  for (const [fieldName, value] of Object.entries(values)) {
    const isSecret = schema.fields[fieldName]?.isSecret ?? false;
    await store.set(fieldName, value, isSecret);
  }
}

/**
 * Remove a stored configuration value.
 * Has no effect on environment-variable-backed values.
 *
 * @param schema    The configuration schema (used to validate `fieldName`).
 * @param fieldName A key that must exist in `schema.fields`.
 * @param store     A {@link ConfigStore} implementation.
 */
export async function deleteConfigValue(
  schema: Schema,
  fieldName: string,
  store: ConfigStore,
): Promise<void> {
  if (!schema.fields[fieldName]) {
    throw new Error(`Field '${fieldName}' not found in schema`);
  }
  await store.delete(fieldName);
}
