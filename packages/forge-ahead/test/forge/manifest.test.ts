/**
 * Forge manifest parsing tests
 *
 * These tests complement the manifest reference by specifying how forge-ahead
 * detects, parses, and reports errors for manifest.yml content.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/manifest-reference/|Forge manifest reference}
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifestExists, parseManifestResult } from "../../src/forge/manifest";

describe("manifest module", () => {
  const testDir = "test/tmp";
  const testManifestPath = path.join(testDir, "test-manifest.yml");
  const testOutputPath = path.join(testDir, "test-output.ts");

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testManifestPath)) {
      fs.unlinkSync(testManifestPath);
    }
    if (fs.existsSync(testOutputPath)) {
      fs.unlinkSync(testOutputPath);
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmdirSync(testDir);
      } catch {
        // Directory might not be empty
      }
    }
  });

  describe("manifestExists", () => {
    it("should return true if manifest file exists", () => {
      const manifestContent = "modules:\n  action: []";
      fs.writeFileSync(testManifestPath, manifestContent);

      const exists = manifestExists(testManifestPath);
      expect(exists).toBe(true);
    });

    it("should return false if manifest file does not exist", () => {
      const exists = manifestExists(testManifestPath);
      expect(exists).toBe(false);
    });

    it("should check default manifest.yml path", () => {
      const exists = manifestExists();
      expect(typeof exists).toBe("boolean");
    });
  });

  describe("parseManifestResult (file-based)", () => {
    it("should read and parse valid manifest file", () => {
      const manifestContent = `modules:
  action:
    - key: test
      name: Test`;
      fs.writeFileSync(testManifestPath, manifestContent);

      const result = parseManifestResult(testManifestPath);

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveProperty("modules");
      expect(result.value.modules).toHaveProperty("action");
    });

    it("should return error for non-existent file", () => {
      const result = parseManifestResult(testManifestPath);

      expect(result.isErr()).toBe(true);
      expect(result.error.detail).toContain("Manifest file not found");
    });

    it("should return error for invalid YAML", () => {
      const invalidYaml = "this is not: [valid yaml";
      fs.writeFileSync(testManifestPath, invalidYaml);

      const result = parseManifestResult(testManifestPath);

      expect(result.isErr()).toBe(true);
      expect(result.error.detail).toContain("Invalid manifest YAML");
    });

    it("should return error for non-object YAML", () => {
      fs.writeFileSync(testManifestPath, "just a string");

      const result = parseManifestResult(testManifestPath);

      expect(result.isErr()).toBe(true);
      expect(result.error.detail).toContain("not a valid object");
    });

    it("should parse complex manifest structure", () => {
      const yaml = `app:
  id: test-app
modules:
  action:
    - key: action1
      name: Action 1
  function:
    - key: func1
      handler: index.handler`;
      fs.writeFileSync(testManifestPath, yaml);

      const result = parseManifestResult(testManifestPath);

      expect(result.isOk()).toBe(true);
      expect(result.value.app).toBeDefined();
      expect(result.value.modules).toBeDefined();
      expect(result.value.modules?.action).toHaveLength(1);
      expect(result.value.modules?.function).toHaveLength(1);
    });

    it("should handle manifest with no modules", () => {
      const yaml = `app:
  id: test-app`;
      fs.writeFileSync(testManifestPath, yaml);

      const result = parseManifestResult(testManifestPath);

      expect(result.isOk()).toBe(true);
      expect(result.value.modules).toBeUndefined();
    });

    it("should handle manifest with empty actions", () => {
      const yaml = `modules:
  action: []`;
      fs.writeFileSync(testManifestPath, yaml);

      const result = parseManifestResult(testManifestPath);

      expect(result.isOk()).toBe(true);
      expect(result.value.modules?.action).toEqual([]);
    });
  });
});
