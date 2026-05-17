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

    const indexSource = parseSourceFile(paths.srcIndex);
    const exportedFunctionNames = findExportedFunctionNames(indexSource);

    const missingExports: string[] = [];

    // Check regular function declarations
    const declaredFunctions = manifest.modules.function || [];
    for (const func of declaredFunctions) {
      const handlerName = func.handler.split(".")[1]; // Extract "functionName" from "index.functionName"

      if (!exportedFunctionNames.includes(handlerName)) {
        missingExports.push(
          `Function "${func.key}" (handler: ${func.handler}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check consumer (queue) module functions
    const consumers = manifest.modules.consumer || [];
    for (const consumer of consumers) {
      const functionName = consumer.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Consumer "${consumer.key}" (queue: ${consumer.queue}, function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check scheduled trigger module functions
    const scheduledTriggers = manifest.modules.scheduledTrigger || [];
    for (const trigger of scheduledTriggers) {
      const functionName = trigger.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Scheduled trigger "${trigger.key}" (interval: ${trigger.interval}, function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check web trigger module functions
    // webtrigger.function is a key reference into the function: table
    const functionTable = manifest.modules.function || [];
    const webTriggers = manifest.modules.webtrigger || [];
    for (const trigger of webTriggers) {
      const funcDef = functionTable.find((f) => f.key === trigger.function);
      if (!funcDef) {
        missingExports.push(
          `Web trigger "${trigger.key}" references undefined function key "${trigger.function}" in manifest`,
        );
        continue;
      }
      const handlerName = funcDef.handler.split(".")[1];
      if (!exportedFunctionNames.includes(handlerName)) {
        missingExports.push(
          `Web trigger "${trigger.key}" (function: ${trigger.function}, handler: ${funcDef.handler}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check trigger (event) module functions
    const triggers = manifest.modules.trigger || [];
    for (const trigger of triggers) {
      // Skip triggers that use remote endpoints instead of local functions
      if (trigger.function) {
        const functionName = trigger.function;
        if (!exportedFunctionNames.includes(functionName)) {
          missingExports.push(
            `Trigger "${trigger.key}" (function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
          );
        }
      }
    }

    // Check Rovo action module functions
    const actions = manifest.modules.action || [];
    for (const action of actions) {
      const functionName = action.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Rovo action "${action.key}" (name: ${action.name}, function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check Jira workflow validator functions
    const workflowValidators = manifest.modules["jira:workflowValidator"] || [];
    for (const validator of workflowValidators) {
      const functionName = validator.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Jira workflow validator "${validator.key}" (function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check Jira workflow condition functions
    const workflowConditions = manifest.modules["jira:workflowCondition"] || [];
    for (const condition of workflowConditions) {
      const functionName = condition.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Jira workflow condition "${condition.key}" (function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check Jira workflow post function functions
    const workflowPostFunctions =
      manifest.modules["jira:workflowPostFunction"] || [];
    for (const postFunction of workflowPostFunctions) {
      const functionName = postFunction.function;
      if (!exportedFunctionNames.includes(functionName)) {
        missingExports.push(
          `Jira workflow post function "${postFunction.key}" (function: ${functionName}) is declared in manifest but not exported from src/index.ts`,
        );
      }
    }

    // Check module resolvers (e.g., jiraServiceManagement:assetsImportType)
    const moduleResolvers = getModuleResolvers(manifest);
    for (const module of moduleResolvers) {
      if (module.resolver) {
        const functionName = module.resolver.function;
        if (!exportedFunctionNames.includes(functionName)) {
          missingExports.push(
            `Module resolver "${functionName}" (from module "${module.key}") is declared in manifest but not exported from src/index.ts`,
          );
        }
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
