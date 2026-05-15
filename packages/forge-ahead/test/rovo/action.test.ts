/**
 * Rovo action manifest and type-generation tests
 *
 * These tests complement the Rovo action manifest docs by specifying how action
 * modules are parsed and converted into TypeScript payload interfaces.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/|Rovo action module}
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/|Rovo agent module}
 */

import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "../../src/forge/manifest";
import {
  type Actions,
  generateTypeScript,
  getInputTypeSyntaxKind,
  normalizeOutputPathResult,
  readActionsResult,
} from "../../src/rovo/action";

function parseManifestString(yaml: string): Manifest {
  try {
    const YAML = require("yaml");
    const parsed = YAML.parse(yaml, { mapAsMap: false });
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid manifest");
    }
    return parsed;
  } catch {
    throw new Error("Failed to parse YAML");
  }
}

describe("actiontypes", () => {
  let validManifest: string;
  let noActionsManifest: string;
  let emptyActionsManifest: string;

  let docsHostedFunctionManifest: string;
  let docsRemoteEndpointManifest: string;

  beforeAll(() => {
    validManifest = fs.readFileSync(
      "test/data/manifest/manifest-valid.yml",
      "utf-8",
    );
    noActionsManifest = fs.readFileSync(
      "test/data/manifest/manifest-no-actions.yml",
      "utf-8",
    );
    emptyActionsManifest = fs.readFileSync(
      "test/data/manifest/manifest-empty-actions.yml",
      "utf-8",
    );
    docsHostedFunctionManifest = fs.readFileSync(
      "test/data/manifest/docs-hosted-function.yml",
      "utf-8",
    );
    docsRemoteEndpointManifest = fs.readFileSync(
      "test/data/manifest/docs-remote-endpoint.yml",
      "utf-8",
    );
  });

  describe("readActionsResult", () => {
    it("should parse valid manifest with multiple actions", () => {
      const manifest = parseManifestString(validManifest);
      const result = readActionsResult(manifest);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const actions = result.value;
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
          key: "create_task",
          name: "Create Task",
          function: "createTask",
        });
        expect(actions[1]).toMatchObject({
          key: "complete_task",
          name: "Complete Task",
          function: "completeTask",
        });
      }
    });

    it("should parse action inputs correctly", () => {
      const result = readActionsResult(parseManifestString(validManifest));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const actions = result.value;
        const createTaskAction = actions[0];

        // Inputs should be a Record/Map with 3 entries
        const inputKeys = Object.keys(createTaskAction.inputs);
        expect(inputKeys).toHaveLength(3);

        expect(createTaskAction.inputs.title).toMatchObject({
          title: "Task Title",
          type: "string",
          required: true,
        });
        expect(createTaskAction.inputs.description).toMatchObject({
          title: "Description",
          type: "string",
          required: false,
        });
        expect(createTaskAction.inputs.priority).toMatchObject({
          title: "Priority",
          type: "number",
          required: false,
        });
      }
    });

    it("should return error when manifest has no action modules", () => {
      const result = readActionsResult(parseManifestString(noActionsManifest));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.detail).toMatch(
          /No action modules found in manifest/,
        );
        expect(result.error.status).toBe(416);
      }
    });

    it("should handle manifest with empty actions array", () => {
      const result = readActionsResult(
        parseManifestString(emptyActionsManifest),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe("generateTypeScript", () => {
    it("should generate valid TypeScript with imports", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain(
          "import type { CommonEvent, EventContext }",
        );
        expect(typescript).toContain('from "forge-ahead"');
      }
    });

    it("should generate interface for each action", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("export interface CreateTaskPayload");
        expect(typescript).toContain("export interface CompleteTaskPayload");
      }
    });

    it("should extend CommonEvent in generated interfaces", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("extends CommonEvent");
      }
    });

    it("should include context property in interfaces", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("context: EventContext");
      }
    });

    it("should generate required properties without question mark", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("taskId: string");
      }
    });

    it("should generate optional properties with question mark", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("description?: string");
        expect(typescript).toContain("priority?: number");
        expect(typescript).toContain("notify?: boolean");
      }
    });

    it("should handle all input types correctly", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        // Check for string type
        expect(typescript).toContain("title: string");
        // Check for number type
        expect(typescript).toContain("priority?: number");
        // Check for boolean type
        expect(typescript).toContain("notify?: boolean");
      }
    });

    it("should capitalize first letter of function name for interface", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        // createTask -> CreateTaskPayload
        expect(typescript).toContain("CreateTaskPayload");
        // completeTask -> CompleteTaskPayload
        expect(typescript).toContain("CompleteTaskPayload");
      }
    });

    it("should include generation header comment", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("Generated by npm run actiontypes");
        expect(typescript).toContain("Payload interfaces are kept in sync");
      }
    });

    it("should generate valid code for single action", () => {
      const singleAction: Actions = [
        {
          key: "test_action",
          name: "Test Action",
          description: "A test action",
          actionVerb: "test",
          function: "testAction",
          inputs: {
            message: {
              key: "message",
              title: "Message",
              description: "A message",
              required: true,
              type: "string",
            },
          },
        },
      ];

      const typescript = generateTypeScript(singleAction);

      expect(typescript).toContain("export interface TestActionPayload");
      expect(typescript).toContain("message: string");
      expect(typescript).toContain("context: EventContext");
    });

    it("should generate valid code with no inputs", () => {
      const actionNoInputs: Actions = [
        {
          key: "ping",
          name: "Ping",
          description: "A ping action",
          actionVerb: "ping",
          function: "ping",
          inputs: {},
        },
      ];

      const typescript = generateTypeScript(actionNoInputs);

      expect(typescript).toContain("export interface PingPayload");
      expect(typescript).toContain("context: EventContext");
      expect(typescript).not.toContain("?: ");
    });

    it("should handle mixed required and optional inputs", () => {
      const mixedAction: Actions = [
        {
          key: "update_profile",
          name: "Update Profile",
          description: "Update user profile",
          actionVerb: "update",
          function: "updateProfile",
          inputs: {
            userId: {
              key: "userId",
              title: "User ID",
              description: "User ID",
              required: true,
              type: "string",
            },
            name: {
              key: "name",
              title: "Name",
              description: "User name",
              required: false,
              type: "string",
            },
            age: {
              key: "age",
              title: "Age",
              description: "User age",
              required: false,
              type: "number",
            },
            isActive: {
              key: "isActive",
              title: "Is Active",
              description: "User status",
              required: true,
              type: "boolean",
            },
          },
        },
      ];

      const typescript = generateTypeScript(mixedAction);

      expect(typescript).toContain("userId: string");
      expect(typescript).toContain("isActive: boolean");
      expect(typescript).toContain("name?: string");
      expect(typescript).toContain("age?: number");
    });
  });

  describe("normalizeOutputPathResult", () => {
    it("should normalize a relative path", () => {
      const inputPath = "./src/actionpayload.ts";
      const result = normalizeOutputPathResult(inputPath);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(path.resolve(inputPath));
        expect(path.isAbsolute(result.value)).toBe(true);
      }
    });

    it("should resolve . and .. in paths", () => {
      const inputPath = "./src/../src/actionpayload.ts";
      const result = normalizeOutputPathResult(inputPath);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(path.resolve("./src/actionpayload.ts"));
        expect(result.value.includes("..")).toBe(false);
      }
    });

    it("should accept absolute paths", () => {
      const absolutePath = path.resolve("./src/actionpayload.ts");
      const result = normalizeOutputPathResult(absolutePath);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(absolutePath);
      }
    });

    it("should accept .ts extension", () => {
      const inputPath = "./src/actionpayload.ts";
      const result = normalizeOutputPathResult(inputPath);
      expect(result.isOk()).toBe(true);
    });

    it("should accept .mts extension", () => {
      const inputPath = "./src/actionpayload.mts";
      const result = normalizeOutputPathResult(inputPath);
      expect(result.isOk()).toBe(true);
    });

    it("should accept .cts extension", () => {
      const inputPath = "./src/actionpayload.cts";
      const result = normalizeOutputPathResult(inputPath);
      expect(result.isOk()).toBe(true);
    });

    it("should reject paths without TypeScript extension", () => {
      const result1 = normalizeOutputPathResult("./src/actionpayload.js");
      expect(result1.isErr()).toBe(true);
      if (result1.isErr()) {
        expect(result1.error.detail).toMatch(
          /must have a TypeScript extension/,
        );
      }

      const result2 = normalizeOutputPathResult("./src/actionpayload");
      expect(result2.isErr()).toBe(true);
      if (result2.isErr()) {
        expect(result2.error.detail).toMatch(
          /must have a TypeScript extension/,
        );
      }

      const result3 = normalizeOutputPathResult("./src/actionpayload.txt");
      expect(result3.isErr()).toBe(true);
      if (result3.isErr()) {
        expect(result3.error.detail).toMatch(
          /must have a TypeScript extension/,
        );
      }
    });

    it("should reject paths with null bytes", () => {
      const maliciousPath = "./src/actionpayload\0.ts";
      const result = normalizeOutputPathResult(maliciousPath);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.detail).toMatch(/null byte character/);
      }
    });

    it("should reject path traversal attempts that escape project", () => {
      const traversalPath = "../../../etc/passwd.ts";
      const result = normalizeOutputPathResult(traversalPath);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.detail).toMatch(/path traversal detected/i);
      }
    });

    it("should allow deep nested paths within project", () => {
      const deepPath = "./src/deeply/nested/path/to/actionpayload.ts";
      const result = normalizeOutputPathResult(deepPath);
      expect(result.isOk()).toBe(true);
    });

    it("should normalize path separators", () => {
      const mixedPath = "./src\\actionpayload.ts".replace(/\\/g, path.sep);
      const result = normalizeOutputPathResult(mixedPath);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(path.isAbsolute(result.value)).toBe(true);
      }
    });

    it("should allow absolute paths even if they appear to escape", () => {
      const cwd = process.cwd();
      const absolutePath = path.join(cwd, "src", "actionpayload.ts");
      const result = normalizeOutputPathResult(absolutePath);
      expect(result.isOk()).toBe(true);
    });

    it("should return consistent results for same input", () => {
      const inputPath = "./src/actionpayload.ts";
      const result1 = normalizeOutputPathResult(inputPath);
      const result2 = normalizeOutputPathResult(inputPath);
      expect(result1.isOk()).toBe(result2.isOk());
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value).toBe(result2.value);
      }
    });
  });

  describe("getInputTypeSyntaxKind", () => {
    it("should return StringKeyword for 'string' type", () => {
      const syntaxKind = getInputTypeSyntaxKind("string");
      expect(syntaxKind).toBe(ts.SyntaxKind.StringKeyword);
    });

    it("should return NumberKeyword for 'number' type", () => {
      const syntaxKind = getInputTypeSyntaxKind("number");
      expect(syntaxKind).toBe(ts.SyntaxKind.NumberKeyword);
    });

    it("should return BigIntKeyword for 'integer' type", () => {
      const syntaxKind = getInputTypeSyntaxKind("integer");
      expect(syntaxKind).toBe(ts.SyntaxKind.BigIntKeyword);
    });

    it("should return BooleanKeyword for 'boolean' type", () => {
      const syntaxKind = getInputTypeSyntaxKind("boolean");
      expect(syntaxKind).toBe(ts.SyntaxKind.BooleanKeyword);
    });

    it("should default to StringKeyword for unknown types", () => {
      const syntaxKind = getInputTypeSyntaxKind("unknown_type");
      expect(syntaxKind).toBe(ts.SyntaxKind.StringKeyword);
    });

    it("should default to StringKeyword for empty string", () => {
      const syntaxKind = getInputTypeSyntaxKind("");
      expect(syntaxKind).toBe(ts.SyntaxKind.StringKeyword);
    });

    it("should default to StringKeyword for array type", () => {
      const syntaxKind = getInputTypeSyntaxKind("array");
      expect(syntaxKind).toBe(ts.SyntaxKind.StringKeyword);
    });

    it("should default to StringKeyword for object type", () => {
      const syntaxKind = getInputTypeSyntaxKind("object");
      expect(syntaxKind).toBe(ts.SyntaxKind.StringKeyword);
    });

    it("should be case-sensitive and default for wrong case", () => {
      const syntaxKind1 = getInputTypeSyntaxKind("String");
      const syntaxKind2 = getInputTypeSyntaxKind("NUMBER");
      expect(syntaxKind1).toBe(ts.SyntaxKind.StringKeyword);
      expect(syntaxKind2).toBe(ts.SyntaxKind.StringKeyword);
    });
  });

  describe("Forge documentation examples", () => {
    it("should parse hosted function example from Forge docs", () => {
      const result = readActionsResult(
        parseManifestString(docsHostedFunctionManifest),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const actions = result.value;
        expect(actions).toHaveLength(1);

        const action = actions[0];
        expect(action.key).toBe("fetch-timesheet-by-date");
        expect(action.name).toBe("Fetch timesheet by date");
        expect(action.function).toBe("getTimesheetByDate");
        expect(action.actionVerb).toBe("GET");

        // Verify inputs structure
        const inputKeys = Object.keys(action.inputs);
        expect(inputKeys).toHaveLength(1);
        expect(action.inputs.timesheetDate).toMatchObject({
          title: "Timesheet Date",
          type: "string",
          required: true,
          description: "The date that the user wants a timesheet for",
        });
      }
    });

    it("should parse remote endpoint example from Forge docs", () => {
      const result = readActionsResult(
        parseManifestString(docsRemoteEndpointManifest),
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const actions = result.value;
        expect(actions).toHaveLength(1);

        const action = actions[0];
        expect(action.key).toBe("log-time");
        expect(action.name).toBe("Log time");
        // Note: Remote endpoints use 'endpoint' instead of 'function'
        expect(action).toHaveProperty("endpoint");
        expect(action.actionVerb).toBe("CREATE");

        // Verify inputs structure
        const inputKeys = Object.keys(action.inputs);
        expect(inputKeys).toHaveLength(2);
        expect(action.inputs.issueKey).toMatchObject({
          title: "Jira Issue Key",
          type: "string",
          required: true,
          description: "The jira issue to log time against",
        });
        expect(action.inputs.time).toMatchObject({
          title: "Time to log in minutes",
          type: "integer",
          required: true,
          description: "The number of minutes to log",
        });
      }
    });

    it("should generate TypeScript for hosted function example", () => {
      const result = readActionsResult(
        parseManifestString(docsHostedFunctionManifest),
      );
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        // Interface name is based on the function name (getTimesheetByDate -> GetTimesheetByDatePayload)
        expect(typescript).toContain(
          "export interface GetTimesheetByDatePayload",
        );
        expect(typescript).toContain("timesheetDate: string");
        expect(typescript).toContain("context: EventContext");
      }
    });

    it("should generate TypeScript for remote endpoint example", () => {
      const result = readActionsResult(
        parseManifestString(docsRemoteEndpointManifest),
      );
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const typescript = generateTypeScript(result.value);

        expect(typescript).toContain("export interface LogTimePayload");
        expect(typescript).toContain("issueKey: string");
        expect(typescript).toContain("time: bigint");
        expect(typescript).toContain("context: EventContext");
      }
    });
  });

  describe("integration", () => {
    it("should parse manifest and generate valid TypeScript", () => {
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const actions = result.value;
        expect(actions.length).toBeGreaterThan(0);

        const typescript = generateTypeScript(actions);
        expect(typescript).toBeTruthy();
        expect(typescript.length).toBeGreaterThan(0);

        // Verify it contains expected patterns
        expect(typescript).toMatch(/import type \{/);
        expect(typescript).toMatch(/export interface \w+Payload/);
        expect(typescript).toContain("extends CommonEvent");
      }
    });

    it("should handle unknown input types by defaulting to string", () => {
      const actionWithUnknownType: Actions = [
        {
          key: "test_unknown",
          name: "Test Unknown Type",
          description: "Test action with unknown input type",
          actionVerb: "test",
          function: "testUnknown",
          inputs: {
            field1: {
              key: "field1",
              title: "Field 1",
              description: "A field with unknown type",
              required: true,
              type: "uuid", // Unknown type
            },
            field2: {
              key: "field2",
              title: "Field 2",
              description: "Another unknown type",
              required: false,
              type: "date", // Unknown type
            },
          },
        },
      ];

      const typescript = generateTypeScript(actionWithUnknownType);

      // Should default to string for unknown types
      expect(typescript).toContain("field1: string");
      expect(typescript).toContain("field2?: string");
      expect(typescript).not.toContain("undefined");
    });

    it("should generate TypeScript code that compiles without errors", () => {
      // Generate TypeScript from a valid manifest
      const result = readActionsResult(parseManifestString(validManifest));
      expect(result.isOk()).toBe(true);

      if (!result.isOk()) {
        throw new Error("Failed to read actions from manifest");
      }

      const generatedCode = generateTypeScript(result.value);

      // Load actual source files from the repo
      const forgeTypesSource = fs.readFileSync("src/forge/types.ts", "utf-8");
      const forgeFunctionSource = fs.readFileSync(
        "src/forge/function.ts",
        "utf-8",
      );
      const rovoActionSource = fs.readFileSync("src/rovo/action.ts", "utf-8");
      const forgeManifestSource = fs.readFileSync(
        "src/forge/manifest.ts",
        "utf-8",
      );

      // Create a TypeScript program with the generated code
      const fileName = "generated-test.ts";
      const sourceFile = ts.createSourceFile(
        fileName,
        generatedCode,
        ts.ScriptTarget.ES2022,
        true,
      );

      // Create source files from actual repo sources
      const fileMap = new Map<string, ts.SourceFile>([
        [
          "./forge/types.ts",
          ts.createSourceFile(
            "./forge/types.ts",
            forgeTypesSource,
            ts.ScriptTarget.ES2022,
            true,
          ),
        ],
        [
          "./forge/function.ts",
          ts.createSourceFile(
            "./forge/function.ts",
            forgeFunctionSource,
            ts.ScriptTarget.ES2022,
            true,
          ),
        ],
        [
          "./rovo/action.ts",
          ts.createSourceFile(
            "./rovo/action.ts",
            rovoActionSource,
            ts.ScriptTarget.ES2022,
            true,
          ),
        ],
        [
          "./forge/manifest.ts",
          ts.createSourceFile(
            "./forge/manifest.ts",
            forgeManifestSource,
            ts.ScriptTarget.ES2022,
            true,
          ),
        ],
        [fileName, sourceFile],
      ]);

      // Create a simple in-memory compiler host
      const compilerOptions: ts.CompilerOptions = {
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
      };

      const host = ts.createCompilerHost(compilerOptions);
      const originalGetSourceFile = host.getSourceFile;
      const originalResolveModuleNames = host.resolveModuleNames;

      // Map of module names to their file paths
      const moduleMap = new Map<string, string>([
        ["./forge/types", "./forge/types.ts"],
        ["./forge/function", "./forge/function.ts"],
        ["./rovo/action", "./rovo/action.ts"],
        ["./forge/manifest", "./forge/manifest.ts"],
        ["forge-ahead", "./forge/function.ts"],
      ]);

      // Override module resolution
      host.resolveModuleNames = (
        moduleNames: string[],
        containingFile: string,
      ) => {
        return moduleNames.map((moduleName) => {
          const resolvedFileName = moduleMap.get(moduleName);
          if (resolvedFileName) {
            return {
              resolvedFileName,
              isExternalLibraryImport: false,
            };
          }
          // Fall back to default resolution
          if (originalResolveModuleNames) {
            const resolved = originalResolveModuleNames(
              [moduleName],
              containingFile,
              undefined,
              undefined,
              compilerOptions,
            );
            return resolved?.[0];
          }
          return undefined;
        });
      };

      // Override getSourceFile to provide our generated code and actual sources
      host.getSourceFile = (name: string, languageVersion: ts.ScriptTarget) => {
        const cachedFile = fileMap.get(name);
        if (cachedFile) {
          return cachedFile;
        }
        return originalGetSourceFile(name, languageVersion);
      };

      // Create program and get diagnostics
      const program = ts.createProgram([fileName], compilerOptions, host);
      const diagnostics = ts.getPreEmitDiagnostics(program);

      // Filter out diagnostics from imported modules (we only care about generated code)
      const generatedCodeDiagnostics = diagnostics.filter(
        (d) => d.file?.fileName === fileName,
      );

      // If there are errors, format them nicely for the test output
      if (generatedCodeDiagnostics.length > 0) {
        const errorMessages = generatedCodeDiagnostics.map((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          );
          if (diagnostic.file && diagnostic.start !== undefined) {
            const { line, character } =
              diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            return `${fileName}:${line + 1}:${character + 1} - ${message}`;
          }
          return message;
        });

        throw new Error(
          `Generated TypeScript has compilation errors:\n${errorMessages.join("\n")}`,
        );
      }

      // Success! The generated code compiles without errors
      expect(generatedCodeDiagnostics).toHaveLength(0);
    });
  });
});
