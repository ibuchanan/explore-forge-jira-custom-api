/**
 * forge-ahead API route module.
 *
 * Shared types and utilities for Forge App REST API (apiRoute) handlers.
 * Import via the `forge-ahead/api` entry point:
 *
 *   import { ApiRouteRequest, ApiRouteResponse, json, problemJson, logApiRouteRequest } from "forge-ahead/api";
 */

export {
  json,
  logApiRouteRequest,
  problemJson,
} from "./apiRoute";

export type { ApiRouteRequest, ApiRouteResponse } from "./apiRoute";
