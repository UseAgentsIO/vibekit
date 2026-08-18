import { VibeKitError } from "@useagentsio/core";
import { REQUIRED_RUNTIME_ENV, filterEnvironment, prepareIsolatedRun } from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { writeRuntimeFixture } from "./helpers.js";

describe("environment filtering", () => {
  it("keeps required runtime vars and authorized secret names only", () => {
    const filtered = filterEnvironment({
      secrets: [{ name: "OPENAI_API_KEY", source: "environment", required: true }],
      source: {
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        OPENAI_API_KEY: "sk-test-not-a-real-key-aaaaaaaaaa",
        AWS_SECRET_ACCESS_KEY: "should-not-pass",
        GITHUB_TOKEN: "should-not-pass",
        UNRELATED: "nope",
      },
    });

    expect(filtered.env.PATH).toBe("/usr/bin");
    expect(filtered.env.HOME).toBe("/tmp/home");
    expect(filtered.env.OPENAI_API_KEY).toBe("sk-test-not-a-real-key-aaaaaaaaaa");
    expect(filtered.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(filtered.env.GITHUB_TOKEN).toBeUndefined();
    expect(filtered.env.UNRELATED).toBeUndefined();
    expect(filtered.secretNames).toEqual(["OPENAI_API_KEY"]);
    expect(filtered.runtimeNames.every((name) => REQUIRED_RUNTIME_ENV.includes(name as typeof REQUIRED_RUNTIME_ENV[number]))).toBe(true);
  });

  it("fails closed when a required secret is missing", () => {
    expect(() =>
      filterEnvironment({
        secrets: [{ name: "OPENAI_API_KEY", source: "environment" }],
        source: { PATH: "/usr/bin" },
      }),
    ).toThrow(VibeKitError);
    try {
      filterEnvironment({
        secrets: [{ name: "OPENAI_API_KEY", source: "environment" }],
        source: { PATH: "/usr/bin" },
      });
    } catch (error) {
      expect((error as VibeKitError).category).toBe("configuration_invalid");
      expect((error as VibeKitError).code).toBe("secret_missing");
      expect((error as VibeKitError).message).not.toContain("sk-");
    }
  });

  it("allows a missing optional secret", () => {
    const filtered = filterEnvironment({
      secrets: [{ name: "OPTIONAL_TOKEN", source: "environment", required: false }],
      source: { PATH: "/bin" },
    });
    expect(filtered.secretNames).toEqual([]);
    expect(filtered.env.OPTIONAL_TOKEN).toBeUndefined();
  });

  it("prepares a Run with a stripped environment", () => {
    const fixture = writeRuntimeFixture({
      agent: {
        secrets: [{ name: "OPENAI_API_KEY", source: "environment", required: true }],
      },
    });
    const prepared = prepareIsolatedRun({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      env: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "sk-test-not-a-real-key-bbbbbbbbbb",
        AWS_SECRET_ACCESS_KEY: "leak",
      },
    });
    expect(prepared.environment.env.OPENAI_API_KEY).toBeDefined();
    expect(prepared.environment.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(Object.keys(prepared.environment.env).sort()).toEqual(["OPENAI_API_KEY", "PATH"]);
  });
});
