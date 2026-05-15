/**
 * forge-ahead configuration utility – public API.
 *
 * Re-exports everything needed to define schemas, resolve values, and
 * wire up a storage backend.  Import via the `forge-ahead/config` entry point:
 *
 *   import { fc, getConfigValue, createForgeKvsStore } from "forge-ahead/config";
 *
 * The Forge KVS adapter is co-located here but MUST only be used from
 * backend (resolver) code, not from frontend bundles.
 */

// Forge KVS storage adapter
export { createForgeKvsStore, listStoredConfigKeys } from "./forge-kvs-store";

// Core resolution functions (storage-agnostic)
export {
  deleteConfigValue,
  getAllConfigValues,
  getAllConfigValuesWithSource,
  getConfigValue,
  getConfigValueWithSource,
  setConfigValues,
} from "./resolver";
// Schema builder and inspection helpers
export { fc, getFieldNames, getSchemaMetadata, isSecretField } from "./schema";

// Shared types
export type {
  ConfigSource,
  ConfigStore,
  ConfigValueWithSource,
  Schema,
  SchemaField,
  SchemaFieldMetadata,
} from "./types";
