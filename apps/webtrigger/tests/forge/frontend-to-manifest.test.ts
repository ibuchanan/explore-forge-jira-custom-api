/**
 * Frontend-to-Manifest validation tests
 *
 * Validates the contract between frontend code and manifest declarations:
 * - All frontend invoke() calls correspond to manifest-declared functions or resolver definitions
 * - Manifest handlers have matching exports in backend entry points
 * - Handler functions follow correct export patterns
 * - Queue consumers and extensions are properly declared
 * - Module resolver configuration is correct
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/|Manifest reference}
 * @see {@link https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/invoke/|Forge bridge invoke}
 * @see {@link https://developer.atlassian.com/platform/forge/runtime-reference/forge-resolver/|Forge resolver}
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  findCallExpressions,
  findExportedNames,
  getLiteralText,
  parseSourceFile,
} from "./ast-helpers";
import { directoryExists, getAllTypeScriptFiles } from "./filesystem-helpers";
import {
  getManifestHandlerReferences,
  getModuleResolvers,
  getProjectPaths,
  loadManifest,
} from "./manifest-helpers";

const INVOKE_FUNCTION_NAME = "invoke";
const RESOLVER_DEFINE_FUNCTION_NAME = "define";
const RESOLVER_GET_DEFINITIONS_NAME = "getDefinitions";

type InvokeCall = {
  functionName: string;
  line: number;
};

function findInvokeCalls(sourceFile: ts.SourceFile): InvokeCall[] {
  return findCallExpressions(sourceFile, (callName, node) => {
    if (callName !== INVOKE_FUNCTION_NAME) return false;
    const firstArg = node.arguments[0];
    return firstArg !== undefined && ts.isStringLiteral(firstArg);
  }).map(({ node, line }) => ({
    functionName: (node.arguments[0] as ts.StringLiteral).text,
    line,
  }));
}

function findResolverDefinitions(sourceFile: ts.SourceFile): Set<string> {
  const results = new Set<string>();
  for (const { node } of findCallExpressions(
    sourceFile,
    (callName) => callName === RESOLVER_DEFINE_FUNCTION_NAME,
  )) {
    const firstArg = node.arguments[0];
    const text = firstArg ? getLiteralText(firstArg) : null;
    if (text !== null) results.add(text);
  }
  return results;
}

function isResolverDefinitionsExport(
  sourceFile: ts.SourceFile,
  exportName: string,
): boolean {
  const exportedNames = findExportedNames(sourceFile);
  if (!exportedNames.has(exportName)) return false;

  // Verify the export is initialised with a getDefinitions() call
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = Boolean(
      ts.getCombinedModifierFlags(statement as ts.Declaration) &
        ts.ModifierFlags.Export,
    );
    if (!isExported) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== exportName) continue;

      const init = declaration.initializer;
      if (init && ts.isCallExpression(init)) {
        const name = ts.isIdentifier(init.expression)
          ? init.expression.text
          : ts.isPropertyAccessExpression(init.expression)
            ? init.expression.name.text
            : null;
        if (name === RESOLVER_GET_DEFINITIONS_NAME) return true;
      }
    }
  }
  return false;
}

function findExportedFunctionNames(sourceFile: ts.SourceFile): string[] {
  return Array.from(findExportedNames(sourceFile));
}

describe("Frontend Invoke Validation", () => {
  const projectRoot = process.cwd();

  it("should declare all invoked functions in manifest.yml or module resolver", () => {
    const frontendPath = join(projectRoot, "src/frontend");

    // Skip test if no frontend code exists (backend-only apps)
    if (!directoryExists(frontendPath)) {
      expect(true).toBe(true); // No frontend = test passes by definition
      return;
    }

    const manifest = loadManifest();

    // Get the function definitions from manifest (under modules.function)
    const functions = manifest.modules.function || [];
    expect(functions).toBeDefined();

    const declaredFunctions = functions.map((f) => f.key);

    // Also check if functions are defined in the module's resolver
    const resolversPath = join(projectRoot, "src/resolvers/index.ts");
    const resolverDefinitions: Set<string> = existsSync(resolversPath)
      ? findResolverDefinitions(parseSourceFile(resolversPath))
      : new Set();

    // Get invoked functions from all frontend files
    const frontendFiles = getAllTypeScriptFiles(frontendPath);
    const invokeCalls = frontendFiles.flatMap((frontendPath) =>
      findInvokeCalls(parseSourceFile(frontendPath)),
    );

    // Check that all invoked functions are either:
    // 1. Declared as standalone functions in manifest.yml
    // 2. Defined in a resolver that's used by the module
    const missingFunctions: string[] = [];

    for (const invoked of invokeCalls) {
      const inManifest = declaredFunctions.includes(invoked.functionName);
      const inResolver = resolverDefinitions.has(invoked.functionName);

      if (!inManifest && !inResolver) {
        missingFunctions.push(`${invoked.functionName} (line ${invoked.line})`);
      }
    }

    expect(
      missingFunctions,
      `Frontend invokes the following functions that are NOT declared in manifest.yml or in a resolver: ${missingFunctions.join(", ")}. ` +
        `Manifest functions: ${declaredFunctions.join(", ")}`,
    ).toEqual([]);
  });

  it("should validate that all manifest-referenced backend functions are exported from src/index.ts", () => {
    const paths = getProjectPaths();
    const manifest = loadManifest();
    const exportedFunctionNames = new Set(
      findExportedFunctionNames(parseSourceFile(paths.srcIndex)),
    );

    const missingExports: string[] = [];

    // webtrigger.function is a key into the function table; getManifestHandlerReferences
    // silently skips webtriggers whose key is not found, so check for that explicitly.
    const functionTable = manifest.modules.function || [];
    for (const trigger of manifest.modules.webtrigger || []) {
      if (!functionTable.find((f) => f.key === trigger.function)) {
        missingExports.push(
          `Web trigger "${trigger.key}" references undefined function key "${trigger.function}" in manifest`,
        );
      }
    }

    for (const ref of getManifestHandlerReferences(manifest)) {
      const handlerName = ref.handler.includes("#")
        ? ref.handler.split("#")[1]
        : ref.handler.split(".")[1];
      if (!exportedFunctionNames.has(handlerName)) {
        missingExports.push(
          `${ref.moduleType} "${ref.key}" (handler: ${ref.handler}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    expect(
      missingExports,
      missingExports.length > 0
        ? `The following manifest-declared functions are missing exports:\n${missingExports.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("should validate module resolver configuration", () => {
    const paths = getProjectPaths();
    const manifest = loadManifest();

    // Check if there are any modules with a 'resolver' property
    // These are special cases that expect Resolver instances
    const assetsImportTypes = getModuleResolvers(manifest);

    if (assetsImportTypes && assetsImportTypes.length > 0) {
      const resolversSource = parseSourceFile(paths.resolversIndex);

      for (const module of assetsImportTypes) {
        if (module.resolver) {
          const resolverFunction = module.resolver.function;

          // This function should be exported as a Resolver instance
          expect(
            isResolverDefinitionsExport(resolversSource, resolverFunction),
            `Module resolver '${resolverFunction}' should be exported as a Resolver instance (e.g., export const ${resolverFunction} = resolver.getDefinitions()). ` +
              `Module resolvers are different from invoke() handlers and require Resolver instances.`,
          ).toBe(true);
        }
      }
    }
  });
});
