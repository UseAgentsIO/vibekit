import { describe, expect, it } from "vitest";

import { decideThreeWay, isGeneratedPath } from "@useagentsio/core";

describe("three-way update decisions", () => {
  it("replaces when only upstream changed", () => {
    expect(decideThreeWay("base", "base", "up")).toBe("replace-upstream");
  });

  it("keeps local when only local changed", () => {
    expect(decideThreeWay("base", "local", "base")).toBe("keep-local");
  });

  it("marks current when local already matches upstream", () => {
    expect(decideThreeWay("base", "same", "same")).toBe("mark-current");
    expect(decideThreeWay("base", "base", "base")).toBe("mark-current");
  });

  it("conflicts when both sides changed", () => {
    expect(decideThreeWay("base", "local", "up")).toBe("conflict");
  });

  it("treats a missing local file as keep-local when upstream is unchanged", () => {
    expect(decideThreeWay("base", undefined, "base")).toBe("keep-local");
  });

  it("identifies generated runtime paths", () => {
    expect(isGeneratedPath(".vibekit/runtime/generated/config.yaml")).toBe(true);
    expect(isGeneratedPath(".vibekit/config/policy/sample.yaml")).toBe(false);
  });
});
