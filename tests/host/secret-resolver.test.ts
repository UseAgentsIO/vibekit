import fs from "node:fs";

import {
  SecretResolver,
  deploymentSecretsPath,
  removeDeploymentSecret,
  writeDeploymentSecret,
} from "@useagentsio/host";
import { describe, expect, it } from "vitest";

describe("Project deployment secrets", () => {
  it("prefers the Project store over an inherited environment value", () => {
    const projectId = `project:secret-${Date.now()}`;
    writeDeploymentSecret(projectId, "TELEGRAM_BOT_TOKEN", "project-token");

    expect(new SecretResolver(projectId, { TELEGRAM_BOT_TOKEN: "inherited-token" })
      .resolve("TELEGRAM_BOT_TOKEN")).toBe("project-token");
  });

  it("rotates and removes one owner-only deployment secret without exposing its value", () => {
    const projectId = `project:secret-lifecycle-${Date.now()}`;
    writeDeploymentSecret(projectId, "OPENAI_API_KEY", "first-value");
    const filePath = deploymentSecretsPath(projectId);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    writeDeploymentSecret(projectId, "OPENAI_API_KEY", "rotated-value");
    expect(new SecretResolver(projectId, {}).resolve("OPENAI_API_KEY")).toBe("rotated-value");
    expect(removeDeploymentSecret(projectId, "OPENAI_API_KEY")).toBe(true);
    expect(removeDeploymentSecret(projectId, "OPENAI_API_KEY")).toBe(false);
    expect(() => new SecretResolver(projectId, {}).resolve("OPENAI_API_KEY")).toThrow(/Missing secret/);
  });
});
