#!/usr/bin/env node
import type { Result } from "neverthrow";
import { parseManifestResult } from "./forge/manifest";
import {
  generateTypeScript,
  readActionsResult,
  writeActionPayloadResult,
} from "./rovo/action";
import { type ProblemDetails, StandardError } from "./util/errors";

/**
 * Handle a Result by exiting on error, or returning the value
 *
 * This reduces the repetitive if/error/exit pattern throughout the CLI handler.
 * On error, it logs the ProblemDetails and exits with an appropriate code based
 * on the HTTP status (4xx errors exit with 0, 5xx errors exit with 1).
 *
 * @param result - The Result to unwrap
 * @returns The success value if Result is Ok
 * @throws Never returns on error - calls process.exit() instead
 */
function unwrapOrExit<T>(result: Result<T, ProblemDetails>): T {
  if (result.isErr()) {
    console.error(result.error);
    process.exit(StandardError.toExitCode(result.error.status));
  }
  return result.value;
}

/**
 * CLI Handler for generating TypeScript action payloads
 *
 * This demonstrates the neverthrow pattern in a CLI context where:
 * - Different error types should be handled differently
 * - Manifest/validation errors (4xx) → exit with 0 after logging
 * - Server errors (5xx) → exit with 1
 * - Success → exit with 0
 */
async function main(): Promise<void> {
  // Parse manifest with Result pattern
  const manifest = unwrapOrExit(parseManifestResult());

  // Read actions with Result pattern
  const actions = unwrapOrExit(readActionsResult(manifest));

  // Handle empty actions case
  if (!actions || actions.length === 0) {
    console.log("ℹ No actions found in manifest");
    console.log("ℹ No types generated");
    process.exit(0);
  }

  // Generate TypeScript (pure function, no Result needed)
  const actionpayload = generateTypeScript(actions);

  // Write output with Result pattern
  unwrapOrExit(
    writeActionPayloadResult(
      actionpayload,
      "./src/actionpayload.ts",
      actions.length,
    ),
  );

  // Success!
  process.exit(0);
}

// Execute the CLI handler
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const result = StandardError.getOrDefault(500).error(
    `Unexpected error: ${message}`,
  );
  if (result.isErr()) {
    console.error(result.error);
  }
  process.exit(1);
});
