/**
 * forge-ahead package architecture tests
 *
 * These tests document package-level design constraints that keep generic utility
 * modules independent from Forge-specific modules and keep the source graph
 * acyclic for maintainable public API evolution.
 *
 * @see {@link https://developer.atlassian.com/platform/forge/|Forge developer platform}
 * @see {@link https://github.com/archunit-ts/archunit|ArchUnitTS}
 */

import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("Architecture Rules", () => {
  it("should not have circular dependencies", async () => {
    const rule = projectFiles().inFolder("src/**").should().haveNoCycles();

    await expect(rule).toPassAsync();
  });

  it("should ensure util modules have no dependencies on forge modules", async () => {
    const rule = projectFiles()
      .inFolder("src/util/**")
      .shouldNot()
      .dependOnFiles()
      .inFolder("src/forge/**");

    await expect(rule).toPassAsync();
  });

  //TODO: Some metrics-based rules would be nice too.
});
