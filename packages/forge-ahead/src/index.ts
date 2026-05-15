// Atlassian Cloud utilities
export { extractCloudId } from "./cloud/site";

// Re-export apiRoute types and utilities
export type {
  ApiRouteFunction,
  ApiRouteRequest,
  ApiRouteResponse,
} from "./api/apiRoute";
export {
  buildErrorResponse,
  buildSuccessResponse,
  logApiRouteRequest,
} from "./api/apiRoute";

// Re-export authentication utilities
export { getAuthForEvent } from "./forge/auth";

// Re-export common Forge function types
export type {
  CommonEvent,
  EventContext,
} from "./forge/function";

// Re-export logging utilities
export { logContext, logResult, truncateEvents } from "./forge/logging";

// Re-export Forge Remote JWT types and utilities
export type {
  ForgeInvocationTokenPayload,
  JwtHeader,
  JwtPayload,
  JwtToken,
} from "./forge/remote/index";
export {
  createJwksKeyStore,
  fetchAtlassianJwks,
  getKeyIdFromToken,
  isJwtExpired,
  parseJwt,
  validateAuthHeader,
  verifyAndParseJwt,
  verifyJwt,
} from "./forge/remote/index";

// Re-export Forge lifecycle event types
export type {
  InstallationEvent,
  UpgradeEvent,
  LifecycleEvent,
} from "./forge/triggers/lifecycle";

// Re-export JSON type primitives
export type { JSONValue, JSONObject, JSONArray } from "./forge/types";

// Re-export Rovo action types for use in Rovo agent actions
export type {
  RovoActionFunction,
  RovoEvent,
  RovoResponse,
} from "./rovo/action";

// Re-export error handling utilities
export type { ProblemDetails, Result } from "./util/errors";
export { StandardError, err, ok } from "./util/errors";

// Re-export JSON-RPC utilities
export type { JsonRpcRequest, JsonRpcResponse } from "./util/jsonrpc";
export {
  createErrorResponse,
  createSuccessResponse,
  isJsonRpcError,
  validateJsonRpcRequest,
} from "./util/jsonrpc";

// Re-export Agent2Agent (A2A) protocol types
export type {
  CancelTaskParams,
  GetTaskParams,
  Message,
  MessagePart,
  ResubscribeTaskParams,
  SendMessageParams,
  StreamResponse,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
} from "./rovo/agentConnector";

// Re-export Agent2Agent (A2A) protocol utilities
export {
  ACTIVE_TASK_STATES,
  TERMINAL_TASK_STATES,
  TASK_STATE_TRANSITIONS,
  isTerminalState,
  isActiveState,
  isValidTransition,
  getAllowedTransitions,
} from "./rovo/agentConnector";

// Re-export Agent Connector types and utilities
export type {
  AdvanceTaskRequest,
  AdvanceTaskResponse,
  AgentConnectorDatabaseSchema,
  AgentConnectorRequest,
  AgentConnectorResponse,
  AgentContext,
  CancelTaskParams as AgentConnectorCancelTaskParams,
  GetTaskParams as AgentConnectorGetTaskParams,
  JiraInstallation,
  ResubscribeTaskParams as AgentConnectorResubscribeTaskParams,
  SendMessageParams as AgentConnectorSendMessageParams,
} from "./rovo/agentConnector";

export {
  formatAgentConnectorTaskResponse,
  isValidAgentConnectorResponse,
} from "./rovo/agentConnector";

// Re-export config subsystem types and utilities
export {
  createForgeKvsStore,
  listStoredConfigKeys,
} from "./config/forge-kvs-store";
export {
  deleteConfigValue,
  getAllConfigValues,
  getAllConfigValuesWithSource,
  getConfigValue,
  getConfigValueWithSource,
  setConfigValues,
} from "./config/resolver";
export {
  fc,
  getFieldNames,
  getSchemaMetadata,
  isSecretField,
} from "./config/schema";
export type {
  ConfigSource,
  ConfigStore,
  ConfigValueWithSource,
  Schema,
  SchemaField,
  SchemaFieldMetadata,
} from "./config/types";
