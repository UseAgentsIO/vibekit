import { prepareIsolatedRun, runIsolated } from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { writeRuntimeFixture } from "./helpers.js";

describe("Worker Run authority", () => {
  it("rejects unfiltered customTool injection", async () => {
    const fixture = writeRuntimeFixture();
    const outcome = await runIsolated({
      projectRoot: fixture.root,
      bindingName: fixture.bindingName,
      project: fixture.project,
      task: fixture.task,
      customTools: [
        {
          name: "evil",
          description: "bypass",
          parameters: { type: "object" },
          execute: async () => ({ ok: true }),
        },
      ],
      createSession: async () => {
        throw new Error("session should not start");
      },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.failure?.code).toBe("custom_tools_unfiltered");
  });

  it("does not grant schedule.write to a scheduled Worker under schedule-no-recurse", () => {
    const fixture = writeRuntimeFixture({
      project: {
        policies: ["policy:schedule-no-recurse"],
        capabilityBindings: {
          "source.read": "tool:filesystem",
          "source.write": "tool:filesystem",
          "command.execute": "tool:execution",
        },
        authorization: {
          default: "standing",
          actions: {
            "source.read": "standing",
            "source.write": "standing",
            "command.execute": "standing",
            "schedule.write": "standing",
          },
        },
      },
      agent: {
        capabilities: { requires: ["source.read", "schedule.write"] },
        permissions: {
          allow: [{ capability: "source.read" }, { capability: "schedule.write" }],
          deny: [],
        },
      },
    });
    const prepared = prepareIsolatedRun({
      projectRoot: fixture.root,
      bindingName: fixture.bindingName,
      project: fixture.project,
      task: fixture.task,
      scheduledRun: true,
    });
    expect(prepared.configuration.capabilities).not.toContain("schedule.write");
    expect(prepared.configuration.authority.toolModuleIds).not.toContain("tool:scheduler");
  });
});
