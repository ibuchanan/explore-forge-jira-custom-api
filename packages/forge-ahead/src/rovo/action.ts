/**
 * Rovo Action module - Type definitions and utilities for Rovo automation actions
 *
 * This module provides comprehensive types and utilities for defining, parsing, and generating
 * TypeScript interfaces for Rovo automation actions. It handles:
 * - Action and input parameter definitions
 * - Manifest parsing and validation
 * - TypeScript code generation for action payloads
 * - Type-safe context and event handling
 *
 * The module follows a Result-based error handling pattern for all major operations,
 * with legacy throw-based versions maintained for backward compatibility.
 *
 * @module rovo/action
 */

import fs from "node:fs";
import path from "node:path";
import type { Result } from "neverthrow";
import { ok } from "neverthrow";
import ts from "typescript";
import type {
  CommonEvent,
  EventContext,
  InstallContext,
} from "../forge/function";
import type { Manifest, Module } from "../forge/manifest";
import { type ProblemDetails, StandardError } from "../util/errors";

/**
 * Rovo Action definition
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/ | Rovo Action }
 */
export interface Action extends Module {
  /** Human-readable display name for the module */
  name: string;
  /** Description of the module's purpose and functionality */
  description: string;
  /** Action verb displayed in automation UI (e.g., "Create", "Update", "Delete") */
  actionVerb: string;
  /** Name of the function handler that implements this action (for hosted functions) */
  function?: string;
  /** Name of the endpoint that implements this action (for remote endpoints) */
  endpoint?: string;
  /** Map of input parameter definitions keyed by input key */
  inputs: Record<string, Input>;
}

/**
 * Input parameter definition for an automation action
 *
 * Defines a single input that an action can accept. Inputs are specified
 * in the manifest and used to generate TypeScript interfaces.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/automation-action/#the-inputs-property | Forge Input Types}
 */
export interface Input {
  /** Unique identifier for the input within the action */
  key: string;
  /** Display title shown in the automation UI */
  title: string;
  /** Description of what this input parameter does */
  description: string;
  /** Whether this input is required (true) or optional (false) */
  required: boolean;
  /** Input type: "string", "number", "integer", or "boolean" */
  type: string;
}

/**
 * Array of action definitions
 */
export type Actions = Array<Action>;

/**
 * Product detail information for Rovo context
 *
 * Contains metadata about the Atlassian product resource that triggered the action.
 /**
 * @internal
 */
interface RovoProductDetail {
  /** URL of the product resource */
  url: string;
  /** Type of the resource (e.g., "issue", "page", "project") */
  resourceType: string;
}

/**
 * Rovo action execution context
 *
 * Extends the base EventContext with additional properties that may be present
 * in Rovo action invocations. This interface allows for flexible context data
 * while maintaining type safety for the core EventContext properties.
 *
 * Core properties (from EventContext):
 * - `cloudId`: The Atlassian cloud instance ID
 * - `moduleKey`: The module key from the manifest
 * - `userAccess`: Optional user access control information
 *
 * Additional properties are inherited from EventContext's index signature.
 *
 * @see {@link EventContext}
 */
export interface RovoContext extends EventContext {
  // Inherits all properties from EventContext including index signature
}

/**
 * Input parameters for a Rovo action
 *
 * Represents the dynamic input values passed to an action when invoked.
 * Values can be strings, numbers (including bigint for large integers), or booleans.
 *
 * @internal
 */
type ActionInput = Record<string, string | bigint | number | boolean>;

/**
 * Event structure with Rovo-specific context
 *
 * @internal
 */
interface RovoContextedEvent extends CommonEvent {
  context: RovoContext;
}

/**
 * Complete Rovo action event payload
 *
 * Represents the full event object passed to a Rovo action function.
 * Combines action inputs with the common event structure and Rovo-specific context.
 *
 * @example
 * ```typescript
 * export const myAction: RovoActionFunction = (event, context) => {
 *   // Access input parameters
 *   const taskName = event.taskName; // From action inputs
 *
 *   // Access event context
 *   const cloudId = event.context.cloudId;
 *   const moduleKey = event.context.moduleKey;
 *
 *   return "Action completed successfully";
 * };
 * ```
 */
export type RovoEvent = ActionInput & RovoContextedEvent;

/**
 * Response type for Rovo action functions
 *
 * Rovo actions return a string response that provides feedback about the action execution.
 * This is typically a success message or error description.
 *
 * @example
 * ```typescript
 * return "Task created successfully";
 * return "Failed to create task: Invalid input";
 * ```
 */
export type RovoResponse = string;

/**
 * Type signature for Rovo action handler functions
 *
 * All Rovo action handlers must conform to this signature. Handlers receive:
 * - `request`: The action event containing inputs and context
 * - `context`: The Forge installation context
 *
 * Handlers can be synchronous or asynchronous and must return a string response.
 *
 * @param request - The Rovo action event with inputs and context
 * @param context - The Forge installation context with cloudId and installation details
 * @returns A string response message or Promise resolving to a string
 *
 * @example
 * ```typescript
 * // Synchronous handler
 * export const createTask: RovoActionFunction = (request, context) => {
 *   const taskName = request.taskName as string;
 *   console.log(`Creating task: ${taskName}`);
 *   return `Task "${taskName}" created successfully`;
 * };
 *
 * // Asynchronous handler
 * export const fetchData: RovoActionFunction = async (request, context) => {
 *   const data = await api.getData(request.id as string);
 *   return `Fetched data for ID: ${request.id}`;
 * };
 * ```
 *
 * @see {@link RovoEvent}
 * @see {@link RovoResponse}
 * @see {@link InstallContext}
 */
export type RovoActionFunction = (
  request: RovoEvent,
  context: InstallContext,
) => RovoResponse | Promise<RovoResponse>;

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
 *   fs.writeFileSync("file.ts", content);
 * } catch (err) {
 *   const message = getErrorMessage(err);
 *   console.error(`Failed to write file: ${message}`);
 * }
 * ```
 */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const commonImports = [
  createImport(["CommonEvent", "EventContext"], "forge-ahead"),
];

// Interfaces should extend CommonEvent from "./forge/events"
const commonExtendsClause = ts.factory.createHeritageClause(
  ts.SyntaxKind.ExtendsKeyword,
  [
    ts.factory.createExpressionWithTypeArguments(
      ts.factory.createIdentifier("CommonEvent"),
      undefined,
    ),
  ],
);

const commonContextProperty = ts.factory.createPropertySignature(
  undefined,
  ts.factory.createIdentifier("context"),
  undefined,
  ts.factory.createTypeReferenceNode(
    ts.factory.createIdentifier("EventContext"),
    undefined,
  ),
);

/*
Input types are specified:
https://developer.atlassian.com/platform/forge/manifest-reference/modules/automation-action/#the-inputs-property
*/
const forgeInputTypeMap: Map<string, number> = new Map([
  ["string", ts.SyntaxKind.StringKeyword],
  ["integer", ts.SyntaxKind.BigIntKeyword],
  ["number", ts.SyntaxKind.NumberKeyword],
  ["boolean", ts.SyntaxKind.BooleanKeyword],
]);

/**
 * Get the TypeScript syntax kind for a Forge input type
 *
 * Maps Forge manifest input types ("string", "number", "integer", "boolean")
 * to their corresponding TypeScript syntax kinds. Unknown types default to
 * StringKeyword for safety.
 *
 * @param inputType - The input type from the manifest ("string", "number", "integer", "boolean")
 * @returns TypeScript SyntaxKind for the type, or StringKeyword as default
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/automation-action/#the-inputs-property | Forge Input Types}
 */
export function getInputTypeSyntaxKind(inputType: string): number {
  return forgeInputTypeMap.get(inputType) ?? ts.SyntaxKind.StringKeyword;
}

/**
 * Create TypeScript property signatures from action input definitions
 *
 * Converts a map of action inputs into TypeScript PropertySignature nodes.
 * Required inputs are created as mandatory properties, while optional inputs
 * have a question mark.
 *
 * @param inputs - Map/record of input definitions to convert, keyed by input key
 * @returns Array of TypeScript PropertySignature nodes
 *
 * @internal
 */
export function createInputProperties(
  inputs: Record<string, Input>,
): Array<ts.PropertySignature> {
  // Handle both plain objects and Map instances
  // YAML parsing may return Maps for nested objects depending on configuration
  const entries =
    inputs instanceof Map
      ? Array.from(inputs.entries())
      : Object.entries(inputs);

  return entries.map(([key, input]) => {
    return ts.factory.createPropertySignature(
      undefined,
      ts.factory.createIdentifier(key),
      input.required
        ? undefined
        : ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      ts.factory.createKeywordTypeNode(getInputTypeSyntaxKind(input.type)),
    );
  });
}

/**
 * Create a TypeScript import statement
 *
 * Generates an ES6 import statement for named exports from a module.
 * Used to generate import statements for common types like CommonEvent and EventContext.
 *
 * @param classNames - The names of the classes/types to import (as an array)
 * @param moduleReference - The module path to import from
 * @returns TypeScript ImportDeclaration node
 *
 * @internal
 */
export function createImport(classNames: string[], moduleReference: string) {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports(
        classNames.map((className) =>
          ts.factory.createImportSpecifier(
            false,
            undefined,
            ts.factory.createIdentifier(className),
          ),
        ),
      ),
    ),
    ts.factory.createStringLiteral(moduleReference),
    undefined,
  );
}

/**
 * Build TypeScript interface declarations from action definitions
 *
 * Creates a TypeScript interface for each action that extends CommonEvent
 * and includes all the action's input properties plus a context property.
 *
 * Interface naming convention: `{FunctionName}Payload` or `{EndpointName}Payload`
 * (e.g., "createTask" → "CreateTaskPayload" or "logTime" → "LogTimePayload")
 *
 * @param actions - Array of action definitions
 * @returns Array of TypeScript InterfaceDeclaration nodes
 *
 * @internal
 */
export function buildInterfaces(actions: Actions) {
  return actions.map((action) => {
    // Use function name if available, otherwise use endpoint name (for remote endpoints)
    const handlerName = action.function || action.endpoint || "Unknown";

    return ts.factory.createInterfaceDeclaration(
      [ts.factory.createToken(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createIdentifier(
        `${handlerName.charAt(0).toUpperCase()}${handlerName.slice(1)}Payload`,
      ),
      undefined, // typeParameters (optional)
      [commonExtendsClause],
      [...createInputProperties(action.inputs), commonContextProperty],
    );
  });
}

/**
 * Read and extract actions from a Forge manifest (Result-based version)
 *
 * Parses the manifest structure to extract all action module definitions.
 * This function validates that the manifest contains a modules section with
 * at least one action module.
 *
 * **Process:**
 * 1. Extracts the modules section from the manifest (416 error if missing)
 * 2. Extracts the action modules array (416 error if missing)
 * 3. Returns the actions array (may be empty)
 *
 * **Error Status Code:**
 * - `416` - Range not satisfiable (missing expected manifest content)
 *
 * @param manifest - The parsed manifest object
 * @returns Result containing either the Actions array or ProblemDetails error
 *
 * @see {@link Actions}
 */
export function readActionsResult(
  manifest: Manifest,
): Result<Actions, ProblemDetails> {
  // Step 1: Extract modules from manifest
  const manifestAsMap = new Map(Object.entries(manifest));
  console.debug(
    `Manifest keys: [${Array.from(manifestAsMap.keys()).join(",")}]`,
  );

  const modules = manifestAsMap.get("modules");
  if (!modules) {
    // 416 = range not satisfiable (missing expected content)
    return StandardError.getOrDefault(416).error(
      "No modules found in manifest",
    );
  }

  // Step 2: Extract action modules from modules
  const modulesAsMap = new Map(Object.entries(modules));
  console.debug(`Module keys: [${Array.from(modulesAsMap.keys()).join(",")}]`);

  const actions = modulesAsMap.get("action");
  if (!actions) {
    // 416 = range not satisfiable (missing expected content)
    return StandardError.getOrDefault(416).error(
      "No action modules found in manifest",
    );
  }

  // Step 3: Log and return the actions
  const appActions = actions as Actions;
  console.debug(
    `Action keys: [${appActions
      .map((action) => {
        return action.key;
      })
      .join(",")}]`,
  );

  return ok(appActions);
}

/**
 * Generate TypeScript interfaces from action definitions
 *
 * Creates a TypeScript source file containing:
 * - Import statements for CommonEvent and RovoContext
 * - An interface for each action, named `{FunctionName}Payload`
 * - Each interface extends CommonEvent and includes all input properties
 *
 * The generated code can be used for type-safe action event handling.
 *
 * @param actions - Array of action definitions to generate interfaces for
 * @returns TypeScript source code as a string with a header comment
 *
 * @see {@link buildInterfaces}
 * @see {@link createInputProperties}
 */
export function generateTypeScript(actions: Actions): string {
  const draftFile = ts.createSourceFile(
    "actionpayload.ts",
    "",
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ false,
    ts.ScriptKind.TS,
  );
  const tsPrinter = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const code = tsPrinter.printList(
    ts.ListFormat.MultiLine,
    ts.factory.createNodeArray([...commonImports, ...buildInterfaces(actions)]),
    draftFile,
  );

  return `
/*
Generated by npm run actiontypes
Using ../scripts/actiontypes.ts
Payload interfaces are kept in sync with Actions & Inputs defined in manifest.yml
*/
${code}`;
}

/**
 * Normalize and validate an output path for writing generated TypeScript files
 *
 * Performs comprehensive path validation and normalization to ensure safe file
 * system operations. This prevents security issues like path traversal and
 * validates that the output is a TypeScript file.
 *
 * **Validation Steps:**
 * 1. Normalizes path separators and resolves `.` and `..`
 * 2. Converts to absolute path based on current working directory
 * 3. Validates no null bytes (security - 400 error)
 * 4. Validates no path traversal outside project (security - 403 error)
 * 5. Validates TypeScript extension: `.ts`, `.mts`, or `.cts` (400 error)
 *
 * **Error Status Codes:**
 * - `400` - Bad request (invalid characters or wrong file extension)
 * - `403` - Forbidden (path traversal attempt outside project)
 *
 * @param outputPath - The path to normalize and validate
 * @returns Result containing either the normalized absolute path or ProblemDetails error
 *
 * @example
 * ```typescript
 * const result = normalizeOutputPathResult("./src/types.ts");
 * if (result.isOk()) {
 *   console.log(result.value); // "/absolute/path/to/src/types.ts"
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Security: Rejects path traversal
 * const result = normalizeOutputPathResult("../../../etc/passwd");
 * // Error: "Output path traversal detected..."
 * ```
 *
 * @example
 * ```typescript
 * // Validation: Rejects non-TypeScript files
 * const result = normalizeOutputPathResult("./output.js");
 * // Error: "Output path must have a TypeScript extension..."
 * ```
 */
export function normalizeOutputPathResult(
  outputPath: string,
): Result<string, ProblemDetails> {
  // Step 1: Normalize the path to handle different path separators and resolve . and ..
  const normalizedPath = path.normalize(outputPath);

  // Step 2: Get absolute path relative to current working directory
  const absolutePath = path.resolve(normalizedPath);

  // Step 3: Validate no null bytes (security issue - 400 = bad request)
  if (absolutePath.includes("\0")) {
    return StandardError.getOrDefault(400).error(
      "Output path contains invalid null byte character",
    );
  }

  // Step 4: Check for path traversal attempts that escape the project
  // Allow paths within the project or explicit absolute paths
  const cwd = process.cwd();
  const relativePath = path.relative(cwd, absolutePath);

  if (relativePath.startsWith("..") && !path.isAbsolute(outputPath)) {
    // 403 = forbidden (security issue - cannot access outside project)
    return StandardError.getOrDefault(403).error(
      `Output path traversal detected: "${outputPath}" resolves outside project directory`,
    );
  }

  // Step 5: Validate file extension is TypeScript (.ts, .mts, or .cts)
  const ext = path.extname(absolutePath);
  if (ext !== ".ts" && ext !== ".mts" && ext !== ".cts") {
    // 400 = bad request (invalid file type)
    return StandardError.getOrDefault(400).error(
      `Output path must have a TypeScript extension (.ts, .mts, or .cts), got: "${ext}"`,
    );
  }

  return ok(absolutePath);
}

/**
 * Write generated action payload TypeScript to a file
 *
 * Safely writes the generated TypeScript interfaces to the filesystem with
 * comprehensive validation and error handling. This is the final step in the
 * action type generation pipeline.
 *
 * **Process:**
 * 1. Normalizes and validates the output path (400/403 errors on validation failure)
 * 2. Creates the output directory if it doesn't exist (507 error on failure)
 * 3. Writes the TypeScript content to the file (507 error on failure)
 * 4. Logs success messages with file path and action count
 *
 * **Error Status Codes:**
 * - `400` - Bad request (invalid output path)
 * - `403` - Forbidden (path traversal attempt)
 * - `416` - Range not satisfiable (invalid path from normalization)
 * - `507` - Insufficient storage (directory creation or file write failure)
 *
 * @param content - TypeScript content to write (from generateTypeScript)
 * @param outputPath - Path to write to (defaults to "./src/actionpayload.ts")
 * @param actionsCount - Number of actions processed (for logging)
 * @returns Result containing either void (success) or ProblemDetails error
 *
 * @example
 * ```typescript
 * // Complete pipeline with error handling
 * const result = parseManifestResult()
 *   .andThen(readActionsResult)
 *   .map(generateTypeScript)
 *   .andThen((ts, actions) =>
 *     writeActionPayloadResult(ts, "./src/actionpayload.ts", actions.length)
 *   );
 *
 * if (result.isErr()) {
 *   console.error(result.error);
 *   process.exit(result.error.status >= 500 ? 1 : 0);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Standalone usage
 * const typescript = generateTypeScript(actions);
 * const result = writeActionPayloadResult(typescript, "./src/types.ts", 3);
 * if (result.isOk()) {
 *   console.log("✓ File written successfully");
 * }
 * ```
 *
 * @see {@link generateTypeScript}
 * @see {@link normalizeOutputPathResult}
 */
export function writeActionPayloadResult(
  content: string,
  outputPath = "./src/actionpayload.ts",
  actionsCount: number,
): Result<void, ProblemDetails> {
  // Step 1: Normalize and validate the output path
  const normalizedPathResult = normalizeOutputPathResult(outputPath);
  if (normalizedPathResult.isErr()) {
    return StandardError.getOrDefault(416).error(
      `Invalid output path: ${normalizedPathResult.error.detail}`,
    );
  }
  const normalizedPath = normalizedPathResult.value;

  // Step 2: Ensure the output directory exists
  const dir = path.dirname(normalizedPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    // Use 507 for storage/filesystem errors (insufficient storage)
    return StandardError.getOrDefault(507).error(
      `Failed to create output directory: ${getErrorMessage(err)}`,
    );
  }

  // Step 3: Write the generated TypeScript content to file
  try {
    fs.writeFileSync(normalizedPath, content);
    console.log(`✓ Generated action payloads: ${normalizedPath}`);
    console.log(`✓ Processed ${actionsCount} action(s)`);
    return ok(undefined);
  } catch (err) {
    // Use 507 for file write errors (insufficient storage or permissions)
    return StandardError.getOrDefault(507).error(
      `Failed to write output file: ${getErrorMessage(err)}`,
    );
  }
}
