import {
  err,
  errAsync,
  fromAsyncThrowable,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  ok,
  okAsync,
  type Result,
  ResultAsync,
  safeTry,
} from "neverthrow";

// Re-export neverthrow essentials so consumers don't need dual imports.
// Result instance methods such as map, mapErr, and match remain available on Result values.
export {
  err,
  errAsync,
  fromAsyncThrowable,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  ok,
  okAsync,
  type Result,
  ResultAsync,
  safeTry,
};

/**
 * RFC 9457: Problem Details for HTTP APIs
 * https://www.rfc-editor.org/rfc/rfc9457.html
 *
 * This interface implements RFC 9457, which defines a standard format for
 * HTTP API error responses. Each field serves a specific purpose:
 *
 * - type: A URI reference that identifies the problem type (e.g., https://httpstatuses.io/404)
 * - title: A short, human-readable summary of the problem type (e.g., "Not Found")
 * - status: The HTTP status code (e.g., 404, 500)
 * - detail: A human-readable explanation specific to this occurrence of the problem
 * - timestamp: ISO 8601 timestamp when the problem occurred
 * - instance: (Optional) A URI reference that identifies the specific occurrence of the problem
 *
 * This format allows APIs to provide consistent, machine-readable error responses
 * that can be easily consumed by clients while remaining human-readable.
 */
export interface ProblemDetails {
  type: string; // URI reference identifying the problem type
  title: string; // Human-readable summary of the problem type
  status: number; // HTTP status code
  detail: string; // Human-readable explanation specific to this occurrence
  timestamp: string; // ISO 8601 timestamp
  instance?: string; // Optional URI reference identifying this specific occurrence
}

/**
 * Standard HTTP error class that creates RFC 9457 compliant error responses
 * wrapped in neverthrow Results.
 *
 * This class maintains a registry of standard HTTP error types and provides
 * methods to create error Results with consistent ProblemDetails formatting.
 *
 * @example
 * ```typescript
 * // Create an error Result
 * return StandardError.getOrDefault(404).error("File not found");
 *
 * // Extract ProblemDetails from Result for logging
 * const result = StandardError.getOrDefault(500).error("Server error");
 * console.error(result.error);
 * ```
 */
export class StandardError {
  /**
   * The HTTP status code for this error type (e.g., 404, 500)
   * @readonly
   */
  readonly status: number;

  /**
   * Human-readable title for this error type (e.g., "Not Found", "Internal Server Error")
   * @readonly
   */
  readonly title: string;

  /**
   * Static registry of pre-registered error types mapped by status code
   * @static
   */
  static types = new Map<number, StandardError>();

  /**
   * Create a new StandardError instance
   *
   * @param status - HTTP status code
   * @param title - Human-readable error title
   */
  constructor(status: number, title: string) {
    this.status = status;
    this.title = title;
  }

  /**
   * Register a new error type in the static registry
   *
   * @param status - HTTP status code to register
   * @param title - Human-readable title for this error type
   *
   * @example
   * ```typescript
   * StandardError.add(404, "Not Found");
   * StandardError.add(500, "Internal Server Error");
   * ```
   */
  static add(status: number, title: string) {
    StandardError.types.set(status, new StandardError(status, title));
  }

  /**
   * Get a registered error type by status code, or default to 500 if not found
   *
   * This method is safe to call with any status code. If the code is not
   * registered, it returns a 500 Internal Server Error instance.
   *
   * @param statusCode - HTTP status code to look up
   * @returns StandardError instance for the given code or 500 default
   *
   * @example
   * ```typescript
   * // Get registered error
   * const notFound = StandardError.getOrDefault(404);
   *
   * // Get unregistered error (returns 500)
   * const teapot = StandardError.getOrDefault(418); // Returns 500 error
   * ```
   */
  static getOrDefault(statusCode: number): StandardError {
    return (
      StandardError.types.get(statusCode) ??
      StandardError.types.get(500) ??
      new StandardError(500, "Internal Server Error")
    );
  }

  /**
   * Map HTTP status code to appropriate shell exit code
   *
   * Any error (4xx or 5xx) results in exit code 1, indicating the CLI
   * encountered an error condition that prevented successful completion.
   * Success (2xx) should not use this method.
   *
   * @param statusCode - HTTP status code (unused, always returns 1)
   * @returns Shell exit code 1 for any error
   *
   * @example
   * ```typescript
   * const result = StandardError.getOrDefault(404).error("Not found");
   * if (result.isErr()) {
   *   process.exit(StandardError.toExitCode(result.error.status));
   * }
   * ```
   */
  static toExitCode(_statusCode: number): number {
    return 1;
  }

  /**
   * Get the RFC 9457 type URI for this error
   *
   * Returns a URI reference to httpstatuses.io for the error's status code.
   * This provides a stable, machine-readable identifier for the error type.
   *
   * @returns URI string in format `https://httpstatuses.io/{status}`
   *
   * @example
   * ```typescript
   * const error = StandardError.getOrDefault(404);
   * console.log(error.type); // "https://httpstatuses.io/404"
   * ```
   */
  public get type() {
    return `https://httpstatuses.io/${this.status}`;
  }
  /**
   * Create a Result containing an error with RFC 9457 ProblemDetails
   *
   * This is the primary method for creating error Results in this project.
   * It wraps a ProblemDetails object in a neverthrow Result.err().
   *
   * @param message - Human-readable explanation specific to this error occurrence
   * @param timestamp - Optional ISO 8601 timestamp (defaults to current time if not provided)
   * @param instance - Optional URI reference identifying this specific error occurrence
   * @returns Result.err containing ProblemDetails with all error information
   *
   * @example
   * ```typescript
   * // Basic error
   * return StandardError.getOrDefault(404).error("File not found");
   *
   * // Error with instance URI for tracing
   * return StandardError.getOrDefault(404).error(
   *   "User not found",
   *   undefined,
   *   "/api/users/123"
   * );
   *
   * // Error with custom timestamp
   * const customTime = "2024-01-15T10:30:00.000Z";
   * return StandardError.getOrDefault(500).error("Server error", customTime);
   * ```
   */
  error(
    message: string,
    timestamp?: string,
    instance?: string,
  ): Result<never, ProblemDetails> {
    const problemDetails: ProblemDetails = {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: message,
      instance: instance,
      timestamp: timestamp ?? new Date().toISOString(),
    };
    return err(problemDetails);
  }
}

// Create the standard errors needed for this project
StandardError.add(400, "Bad Request"); // Invalid or malformed input
StandardError.add(401, "Unauthorized"); // Invalid or missing authentication token
StandardError.add(404, "Not Found"); // Manifest file not found
StandardError.add(415, "Unsupported Media Type"); // Invalid YAML, Invalid manifest structure
StandardError.add(416, "Range Not Satisfiable"); // Action or Input missing or invalid
StandardError.add(422, "Unprocessable Content"); // Got a null when non-null expected
StandardError.add(500, "Internal Server Error"); // Unexpected
StandardError.add(507, "Insufficient Storage"); // Failed to write output file

/**
 * Standard shell exit codes
 * https://tldp.org/LDP/abs/html/exitcodes.html
 *
 * For our CLI applications:
 * - Exit with 0 on success
 * - Exit with 1 for any error (4xx or 5xx - prevents shell script continuation)
 *
 * This map documents standard POSIX shell exit codes for reference.
 */
export const ShellExitCodes = new Map<number, string>([
  [0, "Success"],
  [1, "Catchall for general errors"],
  [2, "Misuse of shell builtins"],
  [126, "Command invoked cannot execute"],
  [127, "Command not found"],
  [128, "Invalid argument to exit"],
  [130, "Script terminated by Control-C"],
  // 128+n, Fatal error signal "n": $PPID of script returns 137 (128 + 9)
  // 255*, Exit status out of range: exit takes only integer args in the range 0 - 255
]);
