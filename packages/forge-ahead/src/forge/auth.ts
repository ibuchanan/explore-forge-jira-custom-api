/**
 * Authentication Module
 *
 * This module provides utilities for determining the correct authentication strategy
 * for Forge events. It automatically selects between user-level (asUser) and
 * app-level (asApp) authentication based on the event context.
 *
 * Key Features:
 * - Automatic auth strategy selection
 * - Support for lifecycle events (install, upgrade)
 * - Support for user-context events (UI actions, custom UI)
 * - Fallback to app-level auth when no user context is available
 * - Debug logging for troubleshooting auth issues
 *
 * Authentication Strategies:
 * 1. **asUser(accountId)** - For installation/upgrade events with known user
 * 2. **asUser()** - For events with user context (UI actions, custom UI)
 * 3. **asApp()** - For scheduled triggers, webtriggers, and background tasks
 *
 * @example
 * ```typescript
 * import { getAuthForEvent } from "./auth";
 *
 * export const handler = async (event, context) => {
 *   const auth = getAuthForEvent(event);
 *
 *   // Use auth to make API calls
 *   const response = await auth.requestJira("/rest/api/3/myself");
 *
 *   return { user: response.data };
 * };
 * ```
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/authorization/ | Forge Authorization}
 */

import { asApp, asUser } from "@forge/api";
import type { ProblemDetails, Result } from "../util/errors";
import { ok, StandardError } from "../util/errors";
import type { CommonEvent } from "./function";
import { truncateEvents } from "./logging";
import type { JSONValue } from "./types";

/**
 * API module interface for Forge authentication
 *
 * Defines the shape of the Forge API module used by getAuthForEvent.
 * This interface captures the two functions needed for authentication strategy selection.
 *
 * @internal
 */
interface ForgeAuth {
  /** Create an app-level authenticated API client */
  asApp: typeof asApp;
  /** Create a user-level authenticated API client */
  asUser: typeof asUser;
}

type ForgeAuthClient = ReturnType<typeof asApp> | ReturnType<typeof asUser>;

export type AuthStrategy = "asUserAccount" | "asUserContext" | "asApp";

export type AuthDiagnosticReason =
  | "installerAccountId"
  | "upgraderAccountId"
  | "userAccessEnabled"
  | "noUserContext";

export interface AuthDiagnostics {
  strategy: AuthStrategy;
  reason: AuthDiagnosticReason;
  context: JSONValue;
  accountId?: string;
}

export interface AuthForEvent {
  auth: ForgeAuthClient;
  diagnostics: AuthDiagnostics;
}

/**
 * Type guard to check if an event has an installerAccountId
 *
 * Installation lifecycle events include the Atlassian account ID of the user
 * who installed the app. This type guard narrows the event type to include
 * the installerAccountId property.
 *
 * Used with lifecycle events like `avi:forge:installed` to identify which
 * user initiated the installation.
 *
 * @param event - The Forge event to check
 * @returns true if the event has an installerAccountId (installation event)
 *
 * @example
 * ```typescript
 * if (hasInstallerAccountId(event)) {
 *   // TypeScript knows event.installerAccountId exists here
 *   console.log(`App installed by: ${event.installerAccountId}`);
 *   const auth = asUser(event.installerAccountId);
 * }
 * ```
 */
function hasInstallerAccountId(
  event: CommonEvent,
): event is CommonEvent & { installerAccountId: string } {
  return (
    "installerAccountId" in event &&
    typeof event.installerAccountId === "string"
  );
}

/**
 * Type guard to check if an event has an upgraderAccountId
 *
 * Upgrade lifecycle events include the Atlassian account ID of the user
 * who upgraded the app. This type guard narrows the event type to include
 * the upgraderAccountId property.
 *
 * Used with lifecycle events like `avi:forge:updated` to identify which
 * user initiated the upgrade (e.g., after accepting new permissions).
 *
 * @param event - The Forge event to check
 * @returns true if the event has an upgraderAccountId (upgrade event)
 *
 * @example
 * ```typescript
 * if (hasUpgraderAccountId(event)) {
 *   // TypeScript knows event.upgraderAccountId exists here
 *   console.log(`App upgraded by: ${event.upgraderAccountId}`);
 *   const auth = asUser(event.upgraderAccountId);
 * }
 * ```
 */
function hasUpgraderAccountId(
  event: CommonEvent,
): event is CommonEvent & { upgraderAccountId: string } {
  return (
    "upgraderAccountId" in event && typeof event.upgraderAccountId === "string"
  );
}

/**
 * Type guard to check if user access is enabled in the event context
 *
 * Events triggered by user interactions (UI Kit actions, custom UI, Rovo actions)
 * include user context when the triggering user is authenticated. This allows
 * the app to make API calls on behalf of the user.
 *
 * The `context.userAccess.enabled` flag indicates whether user-level auth
 * (asUser without accountId) will work for this event.
 *
 * Common scenarios:
 * - UI Kit button clicked by authenticated user → true
 * - Custom UI iframe with authenticated user → true
 * - Scheduled trigger → false
 * - WebTrigger (external HTTP call) → false
 *
 * @param event - The Forge event to check
 * @returns true if user access is enabled (user context available)
 *
 * @example
 * ```typescript
 * if (hasUserAccessEnabled(event)) {
 *   // Use asUser() without accountId - will use current user's context
 *   const auth = asUser();
 *   const user = await auth.requestJira("/rest/api/3/myself");
 * } else {
 *   // No user context - must use asApp()
 *   const auth = asApp();
 * }
 * ```
 */
function hasUserAccessEnabled(event: CommonEvent): boolean {
  return event.context?.userAccess?.enabled === true;
}

/**
 * Determine the correct authentication strategy for a Forge event
 *
 * This function implements a strategy pattern to automatically select between
 * user-level (asUser) and app-level (asApp) authentication based on the event type
 * and context. It handles all common Forge event types and chooses the most
 * appropriate auth client.
 *
 * **Authentication Strategy Priority:**
 * 1. **Installation event** (`installerAccountId` present) → `asUser(installerAccountId)`
 * 2. **Upgrade event** (`upgraderAccountId` present) → `asUser(upgraderAccountId)`
 * 3. **User context available** (`context.userAccess.enabled === true`) → `asUser()`
 * 4. **Default** (no user context) → `asApp()`
 *
 * **When to use each auth type:**
 *
 * - `asUser(accountId)` - Lifecycle events with specific user
 *   - App installation: installer's permissions
 *   - App upgrade: upgrader's permissions
 *
 * - `asUser()` - Events with authenticated user context
 *   - UI Kit actions (buttons, forms, modals)
 *   - Custom UI interactions
 *   - Rovo actions triggered by users
 *
 * - `asApp()` - Events without user context
 *   - Scheduled triggers (cron jobs)
 *   - WebTriggers (external HTTP calls)
 *   - Background tasks
 *
 * **Security Considerations:**
 *
 * - `asUser()` performs authorization checks - API calls fail if user lacks permissions
 * - `asApp()` bypasses user permissions - always succeeds if app has the scope
 * - When using `asApp()` in user contexts, you MUST implement your own permission checks
 *
 * **Debug Logging:**
 *
 * This function logs the selected auth strategy to help debug authorization issues.
 * Logs include the event context (with sensitive data truncated) and the chosen strategy.
 *
 * @param event - The Forge event (webtrigger, lifecycle, scheduled, etc.)
 * @param api - The Forge API module (default: @forge/api, injected for testability)
 * @returns The appropriate auth client with methods like requestJira, requestConfluence
 *
 * @example
 * ```typescript
 * export const handler = async (event, context) => {
 *   const auth = getAuthForEvent(event);
 *   const response = await auth.requestJira("/rest/api/3/myself");
 *   return { user: response.data };
 * };
 * ```
 *
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/authorization/ | Forge Authorization}
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/user-auth/ | User Authentication}
 */
export function getAuthForEvent(
  event: CommonEvent,
  api: ForgeAuth = { asUser, asApp },
): Result<AuthForEvent, ProblemDetails> {
  const context = truncateEvents(event.context as JSONValue);

  if (!event.context?.cloudId || !event.context?.moduleKey) {
    return StandardError.getOrDefault(400).error(
      "Forge event context must include cloudId and moduleKey to select an auth strategy",
    );
  }

  // Strategy 1: Installation event with installer account
  if (hasInstallerAccountId(event)) {
    return ok({
      auth: api.asUser(event.installerAccountId),
      diagnostics: {
        strategy: "asUserAccount",
        reason: "installerAccountId",
        accountId: event.installerAccountId,
        context,
      },
    });
  }

  // Strategy 2: Upgrade event with upgrader account
  if (hasUpgraderAccountId(event)) {
    return ok({
      auth: api.asUser(event.upgraderAccountId),
      diagnostics: {
        strategy: "asUserAccount",
        reason: "upgraderAccountId",
        accountId: event.upgraderAccountId,
        context,
      },
    });
  }

  // Strategy 3: User context available
  if (hasUserAccessEnabled(event)) {
    return ok({
      auth: api.asUser(),
      diagnostics: {
        strategy: "asUserContext",
        reason: "userAccessEnabled",
        context,
      },
    });
  }

  // Strategy 4: Default to app-level auth
  return ok({
    auth: api.asApp(),
    diagnostics: {
      strategy: "asApp",
      reason: "noUserContext",
      context,
    },
  });
}
