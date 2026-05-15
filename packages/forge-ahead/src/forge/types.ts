/**
 * Common Types Module
 *
 * This module provides foundational type definitions used throughout the Forge codebase.
 * These types ensure type safety when working with JSON data and identified entities.
 *
 * Key Types:
 * - **JSONValue** - Recursive type for any JSON-serializable value
 * - **JSONObject** - Type-safe object with JSON values
 * - **JSONArray** - Type-safe array of JSON values
 * - **UniquelyIdentifiedObject** - Interface for entities with string IDs
 *
 * @example
 * ```typescript
 * import type { JSONValue, UniquelyIdentifiedObject } from "./types";
 *
 * // Type-safe JSON handling
 * function processEvent(data: JSONValue) {
 *   // TypeScript ensures data is JSON-serializable
 * }
 *
 * // Entity with ID
 * const user: UniquelyIdentifiedObject = {
 *   id: "user-123",
 *   name: "Alice" // OK - additional properties allowed
 * };
 * ```
 */

/**
 * A union type representing any JSON-serializable value
 *
 * This recursive type definition ensures that values can be safely serialized
 * to JSON and deserialized back without loss of structure. It's used throughout
 * the Forge module for typing event data, request/response payloads, and storage data.
 *
 * **Allowed Types:**
 * - `string` - Text values
 * - `number` - Numeric values (integers and floats)
 * - `boolean` - true or false
 * - `null` - Explicit null value
 * - `JSONObject` - Objects with string keys and JSONValue values
 * - `JSONArray` - Arrays of JSONValue items
 *
 * **Not Allowed:**
 * - `undefined` - Not JSON-serializable (use null instead)
 * - `Function` - Cannot be serialized
 * - `Symbol` - Cannot be serialized
 * - `BigInt` - Not supported in JSON
 * - Circular references - Would cause serialization to fail
 *
 * **Common Use Cases:**
 * - Typing Forge event payloads
 * - Request/response bodies
 * - Storage API values
 * - Configuration objects
 * - Logging data
 *
 * @example
 * ```typescript
 * // Simple values
 * const str: JSONValue = "hello";
 * const num: JSONValue = 42;
 * const bool: JSONValue = true;
 * const nil: JSONValue = null;
 * ```
 *
 * @example
 * ```typescript
 * // Objects and arrays
 * const obj: JSONValue = {
 *   name: "Alice",
 *   age: 30,
 *   active: true,
 *   tags: ["admin", "user"]
 * };
 *
 * const arr: JSONValue = [1, "two", { three: 3 }, [4, 5]];
 * ```
 *
 * @example
 * ```typescript
 * // Type-safe event logging
 * import { truncateEvents } from "./logging";
 *
 * export const handler = (event: JSONValue) => {
 *   // TypeScript ensures event is JSON-serializable
 *   console.log(JSON.stringify(truncateEvents(event)));
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Invalid - would cause TypeScript errors
 * const invalid: JSONValue = undefined; // ❌ undefined not allowed
 * const invalid2: JSONValue = () => {}; // ❌ functions not allowed
 * const invalid3: JSONValue = Symbol(); // ❌ symbols not allowed
 * ```
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;

/**
 * An object with string keys and JSON-serializable values
 *
 * This type represents a plain JavaScript object that can be safely serialized
 * to JSON. All property values must themselves be JSON-serializable (JSONValue).
 *
 * **Characteristics:**
 * - Keys are always strings (per JSON spec)
 * - Values must be JSONValue (recursive structure)
 * - Allows any number of properties
 * - Allows nested objects
 *
 * @example
 * ```typescript
 * const config: JSONObject = {
 *   apiUrl: "https://api.example.com",
 *   timeout: 5000,
 *   retries: 3,
 *   headers: {
 *     "Content-Type": "application/json"
 *   },
 *   enabled: true
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Deeply nested objects
 * const nested: JSONObject = {
 *   user: {
 *     profile: {
 *       name: "Alice",
 *       settings: {
 *         theme: "dark"
 *       }
 *     }
 *   }
 * };
 * ```
 */
export type JSONObject = {
  [key: string]: JSONValue;
};

/**
 * An array of JSON-serializable values
 *
 * This type represents an array where all elements are JSON-serializable.
 * It allows mixed types within the array, as long as each element is a valid JSONValue.
 *
 * **Characteristics:**
 * - Can contain any JSONValue types
 * - Can mix types (e.g., strings and numbers)
 * - Can be nested (arrays of arrays)
 * - Can contain objects
 *
 * @example
 * ```typescript
 * // Homogeneous array
 * const numbers: JSONArray = [1, 2, 3, 4, 5];
 * const strings: JSONArray = ["a", "b", "c"];
 * ```
 *
 * @example
 * ```typescript
 * // Mixed types
 * const mixed: JSONArray = [
 *   "text",
 *   42,
 *   true,
 *   null,
 *   { key: "value" },
 *   [1, 2, 3]
 * ];
 * ```
 *
 * @example
 * ```typescript
 * // Array of objects
 * const users: JSONArray = [
 *   { id: "1", name: "Alice" },
 *   { id: "2", name: "Bob" }
 * ];
 * ```
 */
export type JSONArray = Array<JSONValue>;

/**
 * Interface for objects that have a unique string identifier
 *
 * This is a common pattern in Forge and Atlassian APIs for entities that
 * need unique identification. The interface only requires an `id` property,
 * but allows additional properties to be present.
 *
 * **Common Entities with IDs:**
 * - Jira issues, projects, users
 * - Confluence pages, spaces
 * - Forge app installations
 * - Custom entities in storage
 *
 * **Why string IDs?**
 * - Atlassian APIs use string IDs (e.g., "10000", "PROJ-123")
 * - More flexible than numeric IDs
 * - Supports various ID formats (UUIDs, slugs, composite keys)
 *
 * @example
 * ```typescript
 * // Minimal implementation
 * const entity: UniquelyIdentifiedObject = {
 *   id: "unique-id-123"
 * };
 * ```
 *
 * @example
 * ```typescript
 * // With additional properties
 * interface User extends UniquelyIdentifiedObject {
 *   name: string;
 *   email: string;
 * }
 *
 * const user: User = {
 *   id: "user-456",
 *   name: "Alice",
 *   email: "alice@example.com"
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Jira issue-like object
 * interface Issue extends UniquelyIdentifiedObject {
 *   key: string;
 *   summary: string;
 *   status: string;
 * }
 *
 * const issue: Issue = {
 *   id: "10001",
 *   key: "PROJ-123",
 *   summary: "Fix login bug",
 *   status: "In Progress"
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Generic function working with identified objects
 * function findById<T extends UniquelyIdentifiedObject>(
 *   items: T[],
 *   id: string
 * ): T | undefined {
 *   return items.find(item => item.id === id);
 * }
 *
 * const users: User[] = [...];
 * const user = findById(users, "user-456");
 * ```
 */
export interface UniquelyIdentifiedObject {
  /** Unique string identifier for this object */
  id: string;
}
