import fs from "node:fs";
import type { Result } from "neverthrow";
import { ok } from "neverthrow";
import YAML from "yaml";
import { type ProblemDetails, StandardError } from "../util/errors";

/**
 * Forge manifest file structure
 *
 * Represents the complete structure of a Forge app's manifest.yml file.
 * The manifest is the central configuration file that defines the app's
 * metadata, modules, permissions, and runtime settings.
 *
 * All top-level properties are based on the official Forge manifest reference.
 * Maximum file size: 200 KB.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/ | Forge Manifest Reference}
 */
export interface Manifest {
  /**
   * App metadata and runtime configuration (required)
   * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/#app | App }
   */
  app: App;
  /** Module definitions - Forge extension points (required unless connectModules is present) */
  modules: Record<string, Module>;
  /** OAuth scopes and API permissions (required) */
  permissions: Permissions;
  /** Legacy Connect modules for incremental migration from Connect to Forge */
  connectModules?: unknown;
  /** Remote endpoints referenced by remote resolver invocations */
  endpoint?: unknown;
  /** Authentication providers used by the app */
  providers?: unknown;
  /** Remote services required by the app (with data residency egress details) */
  remotes?: unknown;
  /**
   * Resources used by the app
   * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/resources/#properties | Resources }
   */
  resources?: Array<ResourceEntry>;
  /** Containerised services used by the app (EAP) */
  services?: unknown;
  /** Environment variables parsed by Forge CLI for field values */
  environment?: unknown;
  /** Translation resources and fallback configurations */
  translations?: unknown;
}

/**
 * App metadata section of the manifest
 *
 * Contains basic information about the Forge app including runtime
 * configuration, licensing, and storage settings.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/#app | App }
 */
export interface App {
  /** Unique identifier for the app (auto-generated, assigned by Forge CLI) */
  id: string;
  /**
   * Runtime configuration (required)
   * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/#runtime | Runtime }
   */
  runtime: unknown;
  /** Connect configuration (required if connectModules is present) */
  connect?: unknown;
  /** Licensing configuration */
  licensing?: unknown;
  /** Packaging configuration */
  package?: unknown;
  /** Custom entities and indexes for app data storage */
  storage?: unknown;
}

/**
 * Base module definition shared by all Forge modules
 *
 * All module types in a Forge manifest (action, function, trigger, etc.)
 * share these common properties.
 * @see {@link https://developer.atlassian.com/platform/forge/modules/#modules | Modules }
 */
export interface Module {
  /** Unique identifier for the module (used in code and configuration) */
  key: string;
}

/**
 * Permissions section of the manifest
 *
 * Defines OAuth scopes and API permissions required by the app.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/permissions/ | Permissions }
 */
export interface Permissions {
  /** OAuth scopes required for Atlassian APIs */
  scopes?: Array<string>;
  /** External network access permissions */
  external?: {
    /** List of external domains the app can access */
    fetch?: {
      /** Remote backend endpoints */
      backend?: Array<string>;
      /** Client-side accessible endpoints */
      client?: Array<string>;
    };
    /** Image resource URLs the app can access */
    images?: Array<string>;
  };
}

/**
 * Resources section of the manifest
 *
 * Controls the configuration of assets that you want to display in your app.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/resources/#properties | Resources }
 */
export interface ResourceEntry {
  key: string; // A key for the resource, which other modules can refer to. Must be unique within the manifest and have a maximum of 23 characters. Regex: ^[a-zA-Z0-9_-]+$
  path: string;
}

/**
 * Extract error message from unknown error type
 *
 * Helper function to safely extract error messages from caught exceptions
 * that might be Error objects, strings, or other types. This is useful in
 * catch blocks where the error type is unknown.
 *
 * @param err - The caught error (unknown type)
 * @returns A string representation of the error message
 *
 * @internal
 *
 * @example
 * ```typescript
 * try {
 *   fs.readFileSync("file.txt");
 * } catch (err) {
 *   const message = getErrorMessage(err);
 *   console.error(`Failed to read file: ${message}`);
 * }
 * ```
 */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Validate that a manifest path exists on the filesystem
 *
 * A simple check to determine if a manifest file exists at the given path
 * before attempting to read and parse it.
 *
 * @param manifestPath - Path to the manifest file to check (defaults to "manifest.yml")
 * @returns `true` if the manifest file exists, `false` otherwise
 *
 * @example
 * ```typescript
 * if (manifestExists("forge/manifest.yml")) {
 *   const result = parseManifestResult("forge/manifest.yml");
 *   // Process result...
 * } else {
 *   console.error("Manifest not found");
 * }
 * ```
 *
 * @see {@link parseManifestResult}
 */
export function manifestExists(manifestPath = "manifest.yml"): boolean {
  return fs.existsSync(manifestPath);
}

/**
 * Read and parse a Forge manifest file from the filesystem
 *
 * Reads a YAML manifest file and parses it into a typed Manifest object.
 * This function uses the neverthrow Result pattern for error handling,
 * allowing callers to handle different error scenarios (file not found,
 * read errors, invalid YAML) in a type-safe, composable way.
 *
 * **Process:**
 * 1. Validates the manifest file exists (404 error if not found)
 * 2. Reads the file content from disk (500 error on I/O failure)
 * 3. Parses the YAML content (415 error on invalid YAML)
 * 4. Validates the parsed content is an object (415 error if not)
 *
 * **Error Status Codes:**
 * - `404` - File not found (user error - wrong path)
 * - `500` - File read failed (server error - permissions, I/O)
 * - `415` - Invalid YAML or non-object content (unsupported media type)
 *
 * @param manifestPath - Path to the manifest file (defaults to "manifest.yml")
 * @returns Result containing either the parsed Manifest or ProblemDetails error
 *
 * @example
 * ```typescript
 * // CLI context - exit with appropriate error code
 * const result = parseManifestResult();
 * if (result.isErr()) {
 *   console.error(result.error);
 *   const exitCode = result.error.status >= 500 ? 1 : 0;
 *   process.exit(exitCode);
 * }
 * const manifest = result.value;
 * ```
 *
 * @example
 * ```typescript
 * // API context - return error response
 * const result = parseManifestResult();
 * return result.match(
 *   (manifest) => ({ statusCode: 200, body: manifest }),
 *   (error) => ({ statusCode: error.status, body: error })
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Chain operations with andThen
 * const result = parseManifestResult()
 *   .andThen(readActionsResult)
 *   .map(generateTypeScript);
 * ```
 *
 * @see {@link Manifest}
 * @see {@link ProblemDetails}
 */
export function parseManifestResult(
  manifestPath = "manifest.yml",
): Result<Manifest, ProblemDetails> {
  // Step 1: Validate manifest file exists (404 = user error - file not found)
  if (!fs.existsSync(manifestPath)) {
    return StandardError.getOrDefault(404).error(
      `Manifest file not found: ${manifestPath}`,
    );
  }

  // Step 2: Read manifest file from filesystem
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    // Use 500 for file read errors (server-side issue like permissions)
    return StandardError.getOrDefault(500).error(
      `Failed to read manifest: ${getErrorMessage(err)}`,
    );
  }

  // Step 3: Parse YAML content
  try {
    const parsed = YAML.parse(content, { mapAsMap: false });
    // Validate parsed content is an object (415 = unsupported media type)
    if (typeof parsed !== "object" || parsed === null) {
      return StandardError.getOrDefault(415).error(
        "Invalid manifest: not a valid object",
      );
    }
    return ok(parsed as Manifest);
  } catch (err) {
    // Use 415 for YAML parsing errors (invalid format)
    return StandardError.getOrDefault(415).error(
      `Invalid manifest YAML: ${getErrorMessage(err)}`,
    );
  }
}
