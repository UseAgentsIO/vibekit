import { VibeKitError } from "@useagentsio/core";
import {
  prepareIsolatedRun,
  resolveEffectiveConfiguration,
  resolveModel,
} from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { writeRuntimeFixture } from "./helpers.js";

describe("effective configuration and model resolution", () => {
  it("resolves inherit Agent model from Project defaults", () => {
    const fixture = writeRuntimeFixture();
    const model = resolveModel({
      projectRoot: fixture.root,
      project: fixture.project,
      agent: fixture.agent,
      bindingName: "coder",
    });
    expect(model).toEqual({ provider: "openai", id: "gpt-4.1", source: "project" });
  });

  it("prefers a usable Agent model over Project defaults", () => {
    const fixture = writeRuntimeFixture({
      agent: {
        model: {
          provider: "anthropic",
          id: "claude-sonnet",
          allowProjectOverride: true,
          allowTaskOverride: false,
        },
      },
    });
    const model = resolveModel({
      projectRoot: fixture.root,
      project: fixture.project,
      agent: fixture.agent,
      bindingName: "coder",
    });
    expect(model.source).toBe("agent");
    expect(model.provider).toBe("anthropic");
  });

  it("uses an allowed Task override first", () => {
    const fixture = writeRuntimeFixture({
      agent: {
        model: {
          provider: "inherit",
          id: "inherit",
          allowProjectOverride: true,
          allowTaskOverride: true,
        },
      },
    });
    const model = resolveModel({
      projectRoot: fixture.root,
      project: fixture.project,
      agent: fixture.agent,
      bindingName: "coder",
      taskModel: { provider: "openai", id: "gpt-4.1-mini" },
    });
    expect(model).toEqual({
      provider: "openai",
      id: "gpt-4.1-mini",
      source: "task",
    });
  });

  it("rejects a Task override when the Agent forbids it", () => {
    const fixture = writeRuntimeFixture();
    expect(() =>
      resolveModel({
        projectRoot: fixture.root,
        project: fixture.project,
        agent: fixture.agent,
        bindingName: "coder",
        taskModel: { provider: "openai", id: "gpt-4.1-mini" },
      }),
    ).toThrow(VibeKitError);
  });

  it("uses a Project Agent binding model before Agent inherit", () => {
    const fixture = writeRuntimeFixture({
      agentConfig: { model: { provider: "openai", id: "gpt-4.1-nano" } },
    });
    const prepared = prepareIsolatedRun({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
    });
    expect(prepared.configuration.model).toEqual({
      provider: "openai",
      id: "gpt-4.1-nano",
      source: "project-agent-binding",
    });
  });

  it("fails closed when no model can be resolved", () => {
    const fixture = writeRuntimeFixture({
      project: { defaults: undefined },
    });
    expect(() =>
      resolveModel({
        projectRoot: fixture.root,
        project: fixture.project,
        agent: fixture.agent,
        bindingName: "coder",
      }),
    ).toThrow(/No usable model/);
  });

  it("allowlists only granted capability tools", () => {
    const fixture = writeRuntimeFixture();
    const configuration = resolveEffectiveConfiguration({
      projectRoot: fixture.root,
      project: fixture.project,
      agent: fixture.agent,
      bindingName: "coder",
      task: fixture.task,
    });
    expect(configuration.tools).toEqual(
      expect.arrayContaining(["read", "grep", "find", "ls", "write", "edit"]),
    );
    expect(configuration.tools).not.toContain("bash");
    expect(configuration.tools).not.toContain("agent_delegate");
  });

  it("fails closed when required verification policy has no verifiers", () => {
    const fixture = writeRuntimeFixture({
      project: { verification: { default: [] } },
      agent: {
        verification: { required: [], independentReview: false },
      },
    });
    expect(() =>
      resolveEffectiveConfiguration({
        projectRoot: fixture.root,
        project: fixture.project,
        agent: fixture.agent,
        bindingName: "coder",
        task: fixture.task,
      }),
    ).toThrow(/require-verification/);
  });

  it("fails closed when Task authorization is deny", () => {
    const fixture = writeRuntimeFixture({
      task: { authorization: { state: "deny" } },
    });
    expect(() =>
      prepareIsolatedRun({
        projectRoot: fixture.root,
        bindingName: "coder",
        task: fixture.task,
      }),
    ).toThrow(VibeKitError);
    try {
      prepareIsolatedRun({
        projectRoot: fixture.root,
        bindingName: "coder",
        task: fixture.task,
      });
    } catch (error) {
      expect((error as VibeKitError).category).toBe("authorization_required");
    }
  });
});
