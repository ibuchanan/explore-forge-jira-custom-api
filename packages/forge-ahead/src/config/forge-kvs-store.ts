/**
 * Forge KVS storage adapter for the forge-ahead configuration utility.
 *
 * Wraps `@forge/kvs` to implement the generic {@link ConfigStore} interface.
 *
 * Key design decisions:
 *
 * - All config keys are stored with a `config:` namespace prefix to avoid
 *   collisions with other KVS usage in an app.
 * - Secret values are stored with a `secret:` value prefix so they can be
 *   identified when listed (e.g. to avoid logging them).
 *   NOTE: This is NOT encryption.  Forge KV storage itself provides the
 *   security boundary; the prefix is a convention for identification only.
 * - The prefixes are private to this module; callers always work with plain
 *   field names and plain string values.
 *
 * Usage in a Forge resolver:
 *
 *   import { createForgeKvsStore } from "forge-ahead/config/forge-kvs-store";
 *   import { getConfigValue } from "forge-ahead/config";
 *   import { myConfig } from "./my-schema";
 *
 *   const store = createForgeKvsStore();
 *   const apiKey = await getConfigValue(myConfig, "apiKey", store);
 *
 * IMPORTANT: This module MUST only be imported from backend resolvers (not
 * frontend code) because `@forge/kvs` is a server-side Forge runtime API.
 */

import { kvs, WhereConditions } from "@forge/kvs";
import type { ConfigStore } from "./types";

const CONFIG_KEY_PREFIX = "config:";
const SECRET_VALUE_PREFIX = "secret:";

/**
 * Create a {@link ConfigStore} backed by Forge's built-in KV storage.
 *
 * The returned store uses `.asApp()` scope automatically (Forge KVS always
 * operates with app-level auth).
 *
 * **IMPORTANT:** Your app's `manifest.yml` must declare the `storage:app`
 * scope, or Forge will reject storage calls at runtime with:
 * "Request principal is not authorized to use storage resource".
 *
 * ```yaml
 * permissions:
 *   scopes:
 *     - storage:app
 * ```
 *
 * @returns A `ConfigStore` instance ready for use with the resolver functions.
 */
export function createForgeKvsStore(): ConfigStore {
  return {
    async get(key: string): Promise<string | undefined> {
      const storageKey = `${CONFIG_KEY_PREFIX}${key}`;
      const raw = await kvs.get(storageKey);

      if (typeof raw !== "string") {
        return undefined;
      }

      // Strip the secret prefix if present, returning the plain value
      if (raw.startsWith(SECRET_VALUE_PREFIX)) {
        return raw.substring(SECRET_VALUE_PREFIX.length);
      }

      return raw;
    },

    async set(key: string, value: string, isSecret: boolean): Promise<void> {
      const storageKey = `${CONFIG_KEY_PREFIX}${key}`;
      // Prefix secrets so they can be identified when iterating stored keys
      const storageValue = isSecret ? `${SECRET_VALUE_PREFIX}${value}` : value;
      await kvs.set(storageKey, storageValue);
    },

    async delete(key: string): Promise<void> {
      const storageKey = `${CONFIG_KEY_PREFIX}${key}`;
      await kvs.delete(storageKey);
    },
  };
}

/**
 * List all configuration field names currently persisted in KVS.
 *
 * This is a utility for admin tooling (e.g. showing which fields have stored
 * values). It does NOT include fields that are only set via environment variables.
 *
 * @returns The raw field names (without any internal prefixes).
 */
export async function listStoredConfigKeys(): Promise<string[]> {
  const results = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(CONFIG_KEY_PREFIX))
    .getMany();

  return results.results.map((item) =>
    item.key.substring(CONFIG_KEY_PREFIX.length),
  );
}
