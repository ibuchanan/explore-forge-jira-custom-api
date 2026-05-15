/**
 * Agent Connector Module
 *
 * This module defines TypeScript interfaces and types for integrating remote agents
 * with Jira through the Agent Connector pattern (rovo:agentConnector). It includes
 * task lifecycle management, message handling, and Agent2Agent (A2A) protocol types.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/|Forge rovo:agentConnector Module}
 * @see {@link https://a2a.dev|Agent2Agent Protocol}
 */

// Re-export JSON-RPC types for convenience
export type { JsonRpcRequest, JsonRpcResponse } from "../util/jsonrpc";
export { isJsonRpcError } from "../util/jsonrpc";

/**
 * Task state enumeration for Jira Remote Agent tasks
 */
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "rejected"
  | "canceled"
  | "failed"
  | "unknown";

/**
 * A part of a message, either text or data
 */
export interface MessagePart {
  kind: "text" | "data";
  text?: string;
  data?: unknown;
}

/**
 * Message structure for communication between Jira and agents
 */
export interface Message {
  role: "user" | "agent";
  parts: MessagePart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  kind: "message";
}

/**
 * Task object representing work assigned to an agent
 */
export interface Task {
  id: string; // taskId
  contextId: string;
  status: {
    state: TaskState;
    message: Message;
    timestamp: string;
  };
  kind: "task";
}

/**
 * Active task states that Jira will poll for updates
 */
export const ACTIVE_TASK_STATES: readonly TaskState[] = [
  "submitted",
  "working",
  "auth-required",
  "unknown",
] as const;

/**
 * Terminal task states that cannot be transitioned from
 */
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "completed",
  "rejected",
  "canceled",
  "failed",
] as const;

/**
 * Valid state transitions for task lifecycle
 */
export const TASK_STATE_TRANSITIONS: Readonly<
  Record<TaskState, readonly TaskState[]>
> = {
  submitted: ["working", "rejected", "completed", "failed"],
  working: [
    "input-required",
    "auth-required",
    "completed",
    "failed",
    "canceled",
  ],
  "input-required": ["working", "completed", "failed", "canceled"],
  "auth-required": ["working", "completed", "failed", "canceled"],
  completed: [],
  rejected: [],
  canceled: [],
  failed: [],
  unknown: ["working", "completed", "failed"],
} as const;

/**
 * Check if a task state is terminal (cannot transition to another state)
 */
export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

/**
 * Check if a task state is active (Jira will poll for updates)
 */
export function isActiveState(state: TaskState): boolean {
  return ACTIVE_TASK_STATES.includes(state);
}

/**
 * Validate if a state transition is allowed
 * @param fromState - Current task state
 * @param toState - Desired task state
 * @returns true if transition is valid, false otherwise
 */
export function isValidTransition(
  fromState: TaskState,
  toState: TaskState,
): boolean {
  const allowedTransitions = TASK_STATE_TRANSITIONS[fromState];
  return allowedTransitions.includes(toState);
}

/**
 * Get allowed transitions from a given state
 * @param state - Current task state
 * @returns Array of valid next states
 */
export function getAllowedTransitions(state: TaskState): readonly TaskState[] {
  return TASK_STATE_TRANSITIONS[state];
}

/**
 * Parameters for the message/send JSON-RPC method
 * Called when a user sends a message to the agent or assigns a work item
 */
export interface SendMessageParams {
  message: Message;
}

/**
 * Parameters for the tasks/get JSON-RPC method
 * Called by Jira to poll for task updates
 */
export interface GetTaskParams {
  id?: string; // Note: Jira sends 'id' instead of documented 'taskId'
  taskId?: string; // Fallback for documented parameter name
  historyLength?: number;
}

/**
 * Parameters for the tasks/cancel JSON-RPC method
 * Called when a user cancels a task
 */
export interface CancelTaskParams {
  id?: string; // Note: Jira sends 'id' instead of documented 'id'
  taskId?: string; // Fallback for documented parameter name
}

/**
 * A status update event emitted during SSE streaming.
 * Communicates changes in the task's lifecycle state and provides
 * intermediate messages from the agent.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/#streaming--optional-|Streaming docs}
 */
export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: {
    state: TaskState;
    timestamp?: string;
  };
  /** Optional message accompanying the status update */
  message?: Message;
  kind: "status-update";
  /** Whether this is the final event in the stream (true when task reaches terminal state) */
  final: boolean;
}

/**
 * The result payload of each SSE event in a streaming response.
 * Each event contains exactly one of: task, statusUpdate, or message.
 *
 * - `task`: returned as the first event in the stream
 * - `statusUpdate`: subsequent progress/state-change events
 * - `message`: for simple one-shot responses that don't require task tracking
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/#streaming--optional-|Streaming docs}
 */
export interface StreamResponse {
  task?: Task;
  statusUpdate?: TaskStatusUpdateEvent;
  message?: Message;
}

/**
 * Parameters for the tasks/resubscribe JSON-RPC method.
 * Called by Jira to re-establish a dropped SSE streaming connection.
 */
export interface ResubscribeTaskParams {
  id: string; // taskId to resubscribe to
}

/**
 * JSON-RPC 2.0 Request structure for Agent Connector
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface AgentConnectorRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "message/send" | "tasks/get" | "tasks/cancel" | "tasks/resubscribe";
  params:
    | SendMessageParams
    | GetTaskParams
    | CancelTaskParams
    | ResubscribeTaskParams;
}

/**
 * JSON-RPC 2.0 Response structure for Agent Connector
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */
export interface AgentConnectorResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: Task;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Task advance request body for manual state transitions
 * Used by the `/tasks/:taskId/advance` REST endpoint
 */
export interface AdvanceTaskRequest {
  state: TaskState;
  message?: string;
}

/**
 * Task advance response body
 */
export interface AdvanceTaskResponse {
  success: boolean;
  task: Task;
}

/**
 * Installation information stored during app installation
 */
export interface JiraInstallation {
  cloudId: string;
  installationId: string;
  baseUrl: string;
  installerAccountId?: string;
  installedAt?: string;
}

/**
 * Context information for an agent conversation with Jira
 * Tracks user, work item, and conversation history
 */
export interface AgentContext {
  id: string;
  userAccountId: string;
  workItemId?: string;
  cloudId: string;
  createdAt: string;
  messages: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: string;
  }>;
}

/**
 * Configuration for agent connector database schema
 * Recommended fields to store for proper agent operation
 */
export interface AgentConnectorDatabaseSchema {
  // jiraInstallations table
  installations: {
    cloudId: string; // Primary key
    installationId: string; // Unique installation ID
    baseUrl: string; // Jira instance base URL
    installerAccountId?: string; // Recommended: for audit purposes
    installedAt?: string; // Recommended: installation timestamp
  };

  // agentContexts table
  contexts: {
    id: string; // Primary key
    cloudId: string; // Foreign key to installations
    userAccountId: string; // User who initiated the conversation
    workItemId?: string; // Associated work item
    createdAt: string; // Context creation timestamp
  };

  // agentTasks table
  tasks: {
    id: string; // Primary key: taskId
    contextId: string; // Foreign key to contexts
    status: {
      state: TaskState;
    };
    message: Message;
    timestamp: string;
    kind: "task";
  };
}

/**
 * Validation helper to check if a response is a valid AgentConnectorResponse
 */
export function isValidAgentConnectorResponse(
  response: unknown,
): response is AgentConnectorResponse {
  if (typeof response !== "object" || response === null) {
    return false;
  }

  const obj = response as Record<string, unknown>;
  return (
    obj.jsonrpc === "2.0" &&
    (typeof obj.id === "string" || typeof obj.id === "number") &&
    (("result" in obj && typeof obj.result === "object") ||
      ("error" in obj && typeof obj.error === "object"))
  );
}

/**
 * Format a Task object according to the A2A protocol specification for JSON-RPC responses
 * This ensures the task is properly structured for Jira to consume
 *
 * @param task - The task object to format
 * @param contextId - The context ID to include in the response
 * @returns Formatted task object ready for JSON-RPC response
 *
 * @example
 * ```typescript
 * const formattedTask = formatAgentConnectorTaskResponse(task, contextId);
 * res.json({ jsonrpc: "2.0", id, result: formattedTask });
 * ```
 */
export function formatAgentConnectorTaskResponse(
  task: Task,
  contextId: string,
): unknown {
  // Get the messageId from the task message
  const messageId = task.status.message.messageId || task.id;

  return {
    id: task.id,
    contextId,
    status: {
      state: task.status.state,
      message: {
        role: "agent",
        parts: task.status.message.parts,
        messageId,
        taskId: task.id,
        contextId,
        kind: "message",
      },
      timestamp: task.status.timestamp,
    },
    kind: "task",
  };
}
