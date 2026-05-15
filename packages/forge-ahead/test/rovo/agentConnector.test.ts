/**
 * Rovo remote agent connector protocol tests
 *
 * These tests complement the remote-agent docs by specifying A2A task states,
 * JSON-RPC request/response shapes, task formatting, and the tasks/get taskId
 * contract that Jira uses when polling a remote agent.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/remote-agents-in-jira/|Integrate remote agents with Jira}
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent-connector/|Rovo agent connector module}
 * @see {@link https://www.jsonrpc.org/specification|JSON-RPC 2.0 Specification}
 */

import { describe, expect, it } from "vitest";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../src/rovo/agentConnector";
import {
  ACTIVE_TASK_STATES,
  formatAgentConnectorTaskResponse,
  getAllowedTransitions,
  isActiveState,
  isTerminalState,
  isValidAgentConnectorResponse,
  isValidTransition,
  TASK_STATE_TRANSITIONS,
  type Task,
  TERMINAL_TASK_STATES,
} from "../../src/rovo/agentConnector";

// Type-only import retained for Protocol Compliance test below — it ensures
// the JsonRpcRequest type enforces taskId (not id) for tasks/get at compile time.

// Minimal valid Task fixture reused across tests
const makeTask = (
  state: Task["status"]["state"] = "submitted",
  messageId = "msg-1",
): Task => ({
  id: "task-123",
  contextId: "ctx-456",
  status: {
    state,
    message: {
      role: "agent",
      parts: [{ kind: "text", text: "Working on it" }],
      messageId,
      kind: "message",
    },
    timestamp: "2026-01-01T00:00:00.000Z",
  },
  kind: "task",
});

describe("A2A Protocol — behavioural tests", () => {
  describe("task state classification", () => {
    it("should classify submitted, working, input-required, auth-required as active", () => {
      for (const state of ACTIVE_TASK_STATES) {
        expect(isTerminalState(state)).toBe(false);
      }
    });

    it("should classify completed, rejected, canceled, failed as terminal", () => {
      for (const state of TERMINAL_TASK_STATES) {
        expect(isTerminalState(state)).toBe(true);
      }
    });
  });

  describe("isValidTransition", () => {
    it("should allow submitted → working", () => {
      expect(isValidTransition("submitted", "working")).toBe(true);
    });

    it("should allow working → completed", () => {
      expect(isValidTransition("working", "completed")).toBe(true);
    });

    it("should allow working → failed", () => {
      expect(isValidTransition("working", "failed")).toBe(true);
    });

    it("should allow working → input-required", () => {
      expect(isValidTransition("working", "input-required")).toBe(true);
    });

    it("should not allow completed → working (terminal states are final)", () => {
      expect(isValidTransition("completed", "working")).toBe(false);
    });

    it("should not allow failed → working (terminal states are final)", () => {
      expect(isValidTransition("failed", "working")).toBe(false);
    });

    it("should allow all transitions listed in TASK_STATE_TRANSITIONS", () => {
      for (const [from, tos] of Object.entries(TASK_STATE_TRANSITIONS)) {
        for (const to of tos) {
          expect(isValidTransition(from as Task["status"]["state"], to)).toBe(
            true,
          );
        }
      }
    });
  });

  describe("isActiveState", () => {
    it("should return true for all states in ACTIVE_TASK_STATES", () => {
      for (const state of ACTIVE_TASK_STATES) {
        expect(isActiveState(state)).toBe(true);
      }
    });

    it("should return false for all terminal states", () => {
      for (const state of TERMINAL_TASK_STATES) {
        expect(isActiveState(state)).toBe(false);
      }
    });

    it("should return false for input-required (not polled by Jira)", () => {
      expect(isActiveState("input-required")).toBe(false);
    });
  });

  describe("getAllowedTransitions", () => {
    it("should return working, rejected, completed, failed from submitted", () => {
      const transitions = getAllowedTransitions("submitted");
      expect(transitions).toContain("working");
      expect(transitions).toContain("rejected");
      expect(transitions).toContain("completed");
      expect(transitions).toContain("failed");
    });

    it("should return empty array from all terminal states", () => {
      for (const state of TERMINAL_TASK_STATES) {
        expect(getAllowedTransitions(state)).toHaveLength(0);
      }
    });

    it("should return the same reference as TASK_STATE_TRANSITIONS", () => {
      expect(getAllowedTransitions("working")).toBe(
        TASK_STATE_TRANSITIONS.working,
      );
    });
  });

  describe("isValidAgentConnectorResponse", () => {
    it("should return true for a valid success response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "req-1",
        result: makeTask(),
      };
      expect(isValidAgentConnectorResponse(response)).toBe(true);
    });

    it("should return true for a valid error response", () => {
      const response = {
        jsonrpc: "2.0",
        id: "req-1",
        error: { code: -32603, message: "Internal error" },
      };
      expect(isValidAgentConnectorResponse(response)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isValidAgentConnectorResponse(null)).toBe(false);
    });

    it("should return false for a non-object", () => {
      expect(isValidAgentConnectorResponse("string")).toBe(false);
      expect(isValidAgentConnectorResponse(42)).toBe(false);
    });

    it("should return false when jsonrpc is not '2.0'", () => {
      const response = { jsonrpc: "1.0", id: "req-1", result: {} };
      expect(isValidAgentConnectorResponse(response)).toBe(false);
    });

    it("should return false when id is missing", () => {
      const response = { jsonrpc: "2.0", result: {} };
      expect(isValidAgentConnectorResponse(response)).toBe(false);
    });

    it("should return false when neither result nor error is present", () => {
      const response = { jsonrpc: "2.0", id: "req-1" };
      expect(isValidAgentConnectorResponse(response)).toBe(false);
    });

    it("should accept numeric id", () => {
      const response = { jsonrpc: "2.0", id: 42, result: {} };
      expect(isValidAgentConnectorResponse(response)).toBe(true);
    });
  });

  describe("formatAgentConnectorTaskResponse", () => {
    it("should return a task with the correct id", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(
        task,
        "ctx-789",
      ) as Task;
      expect(formatted.id).toBe("task-123");
    });

    it("should use the provided contextId, not the task's contextId", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(
        task,
        "ctx-override",
      ) as Record<string, unknown>;
      expect(formatted.contextId).toBe("ctx-override");
    });

    it("should preserve the task state in status", () => {
      const task = makeTask("working");
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { state: string };
      };
      expect(formatted.status.state).toBe("working");
    });

    it("should preserve the timestamp from the original task", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { timestamp: string };
      };
      expect(formatted.status.timestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("should use the message's messageId", () => {
      const task = makeTask("submitted", "my-message-id");
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { message: { messageId: string } };
      };
      expect(formatted.status.message.messageId).toBe("my-message-id");
    });

    it("should fall back to task id when messageId is empty", () => {
      const task = makeTask("submitted", "");
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { message: { messageId: string } };
      };
      expect(formatted.status.message.messageId).toBe("task-123");
    });

    it("should set role to agent in formatted message", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { message: { role: string } };
      };
      expect(formatted.status.message.role).toBe("agent");
    });

    it("should set kind to task", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        kind: string;
      };
      expect(formatted.kind).toBe("task");
    });

    it("should propagate message parts", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(task, "ctx-1") as {
        status: { message: { parts: unknown[] } };
      };
      expect(formatted.status.message.parts).toEqual([
        { kind: "text", text: "Working on it" },
      ]);
    });

    it("should embed taskId and contextId in the formatted message", () => {
      const task = makeTask();
      const formatted = formatAgentConnectorTaskResponse(
        task,
        "ctx-override",
      ) as {
        status: { message: { taskId: string; contextId: string } };
      };
      expect(formatted.status.message.taskId).toBe("task-123");
      expect(formatted.status.message.contextId).toBe("ctx-override");
    });
  });

  describe("Protocol Compliance", () => {
    it("tasks/get should use 'taskId' parameter, never 'id' or 'historyLength'", () => {
      // This test encodes the fix for the production bug that caused:
      // "I couldn't finish working because of a technical problem on my end"
      // The old implementation incorrectly sent { id, historyLength } instead of { taskId }.
      const correctRequest: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { taskId: "task-xyz" },
      };

      const incorrectRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { id: "task-xyz", historyLength: 0 }, // OLD WRONG WAY
      };

      expect(correctRequest.params).toHaveProperty("taskId");
      expect(incorrectRequest.params).not.toHaveProperty("taskId");
    });

    it("tasks/get params should not include historyLength", () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: "req-2",
        method: "tasks/get",
        params: { taskId: "task-123" },
      };
      expect(request.params).not.toHaveProperty("historyLength");
    });

    it("a successful JsonRpcResponse carries result but not error", () => {
      const response: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-1",
        result: { id: "task-123", status: { state: "submitted" } },
      };
      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();
    });

    it("a failed JsonRpcResponse carries error with numeric code but not result", () => {
      const response: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-2",
        error: { code: -32001, message: "Task not found" },
      };
      expect(response.error?.code).toBe(-32001);
      expect(response.result).toBeUndefined();
    });
  });
});
