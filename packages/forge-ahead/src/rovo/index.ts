/**
 * forge-ahead Rovo module.
 *
 * Barrel that re-exports all Rovo action and Agent Connector types and utilities.
 *
 * Available as `forge-ahead/rovo`:
 *
 *   import {
 *     RovoActionFunction, RovoEvent, RovoResponse,  // action handler types
 *     ACTIVE_TASK_STATES, isTerminalState,           // task state helpers
 *   } from "forge-ahead/rovo";
 */

// Rovo action types
export type {
  RovoActionFunction,
  RovoContext,
  RovoEvent,
  RovoResponse,
} from "./action";

// Agent Connector A2A protocol types
export type {
  AdvanceTaskRequest,
  AdvanceTaskResponse,
  AgentConnectorDatabaseSchema,
  AgentConnectorRequest,
  AgentConnectorResponse,
  AgentContext,
  CancelTaskParams,
  GetTaskParams,
  JiraInstallation,
  Message,
  MessagePart,
  ResubscribeTaskParams,
  SendMessageParams,
  StreamResponse,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from "./agentConnector";

// Agent Connector A2A protocol utilities
export {
  ACTIVE_TASK_STATES,
  TASK_STATE_TRANSITIONS,
  TERMINAL_TASK_STATES,
  formatAgentConnectorTaskResponse,
  getAllowedTransitions,
  isActiveState,
  isTerminalState,
  isValidAgentConnectorResponse,
  isValidTransition,
} from "./agentConnector";

// JSON-RPC types and utilities (re-exported from agentConnector's dependency)
export type { JsonRpcRequest, JsonRpcResponse } from "../util/jsonrpc";
export { isJsonRpcError } from "../util/jsonrpc";
