/**
 * forge-ahead API route module.
 *
 * Shared types and utilities for Forge App REST API (apiRoute) handlers.
 * Import via the `forge-ahead/api` entry point:
 *
 *   import { ApiRouteRequest, ApiRouteResponse, json, problemJson, logApiRouteRequest } from "forge-ahead/api";
 */

export {
  buildErrorResponse,
  buildSuccessResponse,
  logApiRouteRequest,
} from "./apiRoute";

export type {
  ApiRouteFunction,
  ApiRouteRequest,
  ApiRouteResponse,
} from "./apiRoute";
