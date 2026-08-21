import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEffectiveConfiguration } from "@useagentsio/pi";
import { writeRuntimeFixture } from "./helpers.js";

describe("runtime workspace cwd", () => {
  it("uses the selected workspace as the ordinary run cwd", () => {
    const fixture = writeRuntimeFixture();
    fs.mkdirSync(path.join(fixture.root, "workspace"), { recursive: true });
    const project = { ...fixture.project, workspace: "workspace" };
    const configuration = resolveEffectiveConfiguration({
      projectRoot: fixture.root,
      project,
      agent: fixture.agent,
      bindingName: "coder",
      task: fixture.task,
    });
    expect(configuration.cwd).toBe(path.join(fixture.root, "workspace"));
  });
});
