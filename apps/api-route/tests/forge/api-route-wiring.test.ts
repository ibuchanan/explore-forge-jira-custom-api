/**
 * Forge apiRoute wiring tests
 *
 * Validates the contract between manifest.yml `apiRoute` entries and the
 * `function` modules they reference:
 *
 *  1. Every `apiRoute` must reference a `function` key that exists in the
 *     manifest `function` list.
 *  2. Every referenced function's handler must resolve to a real exported
 *     symbol in the entry-point source file.
 *  3. Every `apiRoute` must declare at least one accepted content type.
 *  4. Every `apiRoute` must declare at least one custom scope.
 *
 * These tests catch manifest/code drift that would cause silent failures
 * at Forge deploy time or runtime.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/api-route/|API Route module reference}
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { findExportedNames, parseSourceFile } from "./ast-helpers";
import {
  type ApiRouteModule,
  type ManifestFunction,
  loadManifest,
} from "./manifest-helpers";

function parseHandlerReference(handler: string): {
  filePath: string;
  exportName: string;
} {
  // Handler format: "index.functionName" or "path/to/file#functionName"
  if (handler.includes("#")) {
    const [filePath, exportName] = handler.split("#");
    return { filePath, exportName };
  }
  const [modulePath, exportName] = handler.split(".");
  return { filePath: `src/${modulePath}.ts`, exportName };
}

describe("Forge apiRoute wiring", () => {
  it("every apiRoute references a function key declared in the manifest", () => {
    const manifest = loadManifest();
    const routes: ApiRouteModule[] = manifest.modules.apiRoute ?? [];
    const functions: ManifestFunction[] = manifest.modules.function ?? [];
    const functionKeys = new Set(functions.map((f) => f.key));

    const violations: string[] = [];

    for (const route of routes) {
      if (!functionKeys.has(route.function)) {
        violations.push(
          `apiRoute '${route.key}' (${route.operation} ${route.path}) references unknown function key '${route.function}'`,
        );
      }
    }

    expect(
      violations,
      violations.length
        ? `Found apiRoute entries referencing undeclared function keys:\n${violations.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("every apiRoute function handler resolves to a real exported symbol", () => {
    const manifest = loadManifest();
    const routes: ApiRouteModule[] = manifest.modules.apiRoute ?? [];
    const functions: ManifestFunction[] = manifest.modules.function ?? [];
    const functionByKey = new Map(functions.map((f) => [f.key, f]));

    const violations: string[] = [];

    for (const route of routes) {
      const fn = functionByKey.get(route.function);
      if (!fn) continue; // covered by the previous test

      const { filePath, exportName } = parseHandlerReference(fn.handler);
      const absolutePath = path.join(process.cwd(), filePath);

      let exportedNames: Set<string>;
      try {
        exportedNames = findExportedNames(parseSourceFile(absolutePath));
      } catch {
        violations.push(
          `apiRoute '${route.key}': could not parse handler file '${filePath}'`,
        );
        continue;
      }

      if (!exportedNames.has(exportName)) {
        violations.push(
          `apiRoute '${route.key}' (${route.operation} ${route.path}): handler '${fn.handler}' references missing export '${exportName}' in ${filePath}`,
        );
      }
    }

    expect(
      violations,
      violations.length
        ? `Found apiRoute handlers that do not resolve to exported symbols:\n${violations.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("every apiRoute declares at least one accepted content type", () => {
    const manifest = loadManifest();
    const routes: ApiRouteModule[] = manifest.modules.apiRoute ?? [];

    const violations = routes
      .filter((route) => !route.accept || route.accept.length === 0)
      .map(
        (route) =>
          `apiRoute '${route.key}' (${route.operation} ${route.path}) has no accepted content types`,
      );

    expect(
      violations,
      violations.length
        ? `Found apiRoute entries with no accepted content types:\n${violations.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("every apiRoute declares at least one custom scope", () => {
    const manifest = loadManifest();
    const routes: ApiRouteModule[] = manifest.modules.apiRoute ?? [];

    const violations = routes
      .filter((route) => !route.scopes || route.scopes.length === 0)
      .map(
        (route) =>
          `apiRoute '${route.key}' (${route.operation} ${route.path}) has no custom scopes declared`,
      );

    expect(
      violations,
      violations.length
        ? `Found apiRoute entries with no custom scopes:\n${violations.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("all apiRoute paths are unique (no duplicate route registrations)", () => {
    const manifest = loadManifest();
    const routes: ApiRouteModule[] = manifest.modules.apiRoute ?? [];

    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const route of routes) {
      const key = `${route.operation} ${route.path}`;
      if (seen.has(key)) {
        duplicates.push(
          `Duplicate route: ${key} declared by both '${seen.get(key)}' and '${route.key}'`,
        );
      } else {
        seen.set(key, route.key);
      }
    }

    expect(
      duplicates,
      duplicates.length
        ? `Found duplicate apiRoute registrations:\n${duplicates.join("\n")}`
        : undefined,
    ).toEqual([]);
  });
});
