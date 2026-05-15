// https://developer.atlassian.com/platform/forge/function-reference/arguments/#function-arguments
// TODO: Entire page seems to be wrong.

import type { JSONValue } from "./types";

export interface EventContext {
  cloudId: string; // The cloud ID.
  moduleKey: string; // The key identifying the module in the manifest that defines the scheduled trigger function and its frequency.
  userAccess?: { enabled: boolean };
  [key: string]: JSONValue | undefined; // Allow additional JSON-serializable properties
}

export interface CommonEvent {
  context: EventContext;
  // Undocumented attributes
  contextToken?: string;
}

export type ForgeFunctionResponse =
  | Promise<{ [key: string]: any } | string | undefined>
  | { [key: string]: any }
  | string
  | undefined;

export interface ForgeFunction {
  functionKey: string;
  cb: (request: CommonEvent, context: InstallContext) => ForgeFunctionResponse;
}

export interface InstallContext {
  installContext: string;
  installation?: {
    ari: { installationId: string };
    contexts: Array<{
      cloudId: string;
      workspaceId: string;
    }>;
  };
}
