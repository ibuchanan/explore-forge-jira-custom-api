/**
 * Forge invocation auth selection tests
 *
 * These tests specify when helpers should use asUser(accountId), asUser(), or
 * asApp() based on the event context provided by Forge trigger invocations.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/apis-reference/fetch-api-product.requestjira/|Product fetch API and authorization}
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/life-cycle/|Lifecycle event payloads}
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/scheduled-trigger/|Scheduled trigger event payloads}
 * @see {@link https://developer.atlassian.com/platform/forge/events-reference/web-trigger/|Web trigger event payloads}
 */

import api, { asApp, asUser } from "@forge/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthForEvent } from "../../src/forge/auth";
import type { CommonEvent } from "../../src/forge/function";
import lifecycle from "../data/event/lifecycle.json";
import product from "../data/event/product.json";
import scheduled from "../data/event/scheduled.json";
import webtrigger from "../data/event/webtrigger.json";

// Mock @forge/api
vi.mock("@forge/api", () => {
  const asApp = vi.fn(() => ({ requestJira: vi.fn() }));
  const asUser = vi.fn(() => ({ requestJira: vi.fn() }));
  return {
    __esModule: true,
    default: {
      asApp,
      asUser,
    },
    asApp,
    asUser,
  };
});

describe("getAuthForEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns asUser(accountId) with diagnostics when installerAccountId is present", () => {
    const event: CommonEvent = {
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
      installerAccountId: "user-123",
    };

    const result = getAuthForEvent(event, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toEqual({
      strategy: "asUserAccount",
      reason: "installerAccountId",
      accountId: "user-123",
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
    });
    expect(asUser).toHaveBeenCalledWith("user-123");
    expect(asApp).not.toHaveBeenCalled();
  });

  it("returns asUser(accountId) with diagnostics when upgraderAccountId is present", () => {
    const event: CommonEvent = {
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
      upgraderAccountId: "user-456",
    };

    const result = getAuthForEvent(event, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toEqual({
      strategy: "asUserAccount",
      reason: "upgraderAccountId",
      accountId: "user-456",
      context: { cloudId: "cloud-1", moduleKey: "mod-1" },
    });
    expect(asUser).toHaveBeenCalledWith("user-456");
    expect(asApp).not.toHaveBeenCalled();
  });

  it("returns asUser() with diagnostics when context.userAccess.enabled is true", () => {
    const event: CommonEvent = {
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: true },
      },
    };

    const result = getAuthForEvent(event, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toEqual({
      strategy: "asUserContext",
      reason: "userAccessEnabled",
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: true },
      },
    });
    expect(asUser).toHaveBeenCalledWith();
    expect(asApp).not.toHaveBeenCalled();
  });

  it("returns asApp() with diagnostics when no user context is available", () => {
    const event: CommonEvent = {
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: false },
      },
    };

    const result = getAuthForEvent(event, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toEqual({
      strategy: "asApp",
      reason: "noUserContext",
      context: {
        cloudId: "cloud-1",
        moduleKey: "mod-1",
        userAccess: { enabled: false },
      },
    });
    expect(asApp).toHaveBeenCalledTimes(1);
    expect(asUser).not.toHaveBeenCalled();
  });

  it("returns asApp() diagnostics from webtrigger events", () => {
    const result = getAuthForEvent(webtrigger, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toMatchObject({
      strategy: "asApp",
      reason: "noUserContext",
    });
    expect(asApp).toHaveBeenCalledTimes(1);
    expect(asUser).not.toHaveBeenCalled();
  });

  it("returns asApp() diagnostics from scheduled events", () => {
    const result = getAuthForEvent(scheduled, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toMatchObject({
      strategy: "asApp",
      reason: "noUserContext",
    });
    expect(asApp).toHaveBeenCalledTimes(1);
    expect(asUser).not.toHaveBeenCalled();
  });

  it("returns asUser(accountId) diagnostics from lifecycle events", () => {
    const result = getAuthForEvent(lifecycle, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toMatchObject({
      strategy: "asUserAccount",
      reason: "installerAccountId",
      accountId: "557057:3d0e64ae-35d3-490d-b6d9-d81c981476d0",
    });
    expect(asUser).toHaveBeenCalledWith(
      "557057:3d0e64ae-35d3-490d-b6d9-d81c981476d0",
    );
    expect(asApp).not.toHaveBeenCalled();
  });

  it("returns asApp() diagnostics from product events without user access", () => {
    const result = getAuthForEvent(product, api);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.detail);
    expect(result.value.diagnostics).toMatchObject({
      strategy: "asApp",
      reason: "noUserContext",
    });
    expect(asApp).toHaveBeenCalledTimes(1);
    expect(asUser).not.toHaveBeenCalled();
  });

  it("returns a diagnostic error when required event context is missing", () => {
    const event = { context: { cloudId: "cloud-1" } } as CommonEvent;

    const result = getAuthForEvent(event, api);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error("Expected auth selection to fail");
    expect(result.error).toMatchObject({
      status: 400,
      title: "Bad Request",
      detail:
        "Forge event context must include cloudId and moduleKey to select an auth strategy",
    });
    expect(asApp).not.toHaveBeenCalled();
    expect(asUser).not.toHaveBeenCalled();
  });
});
