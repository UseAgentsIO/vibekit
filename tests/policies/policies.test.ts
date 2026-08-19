import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSafeFileTarget, parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packages/core/package.json"),
);
const { parse } = require("yaml") as { parse: (text: string) => unknown };

const registryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../registry");

const POLICIES = [
  {
    id: "policy:interface-pairing",
    name: "interface-pairing",
    capability: "policy.interface-pairing",
    recommended: [] as const,
  },
  {
    id: "policy:untrusted-inbound",
    name: "untrusted-inbound",
    capability: "policy.untrusted-inbound",
    recommended: [] as const,
  },
  {
    id: "policy:memory-write-approval",
    name: "memory-write-approval",
    capability: "policy.memory-write-approval",
    recommended: ["tool:memory"] as const,
  },
  {
    id: "policy:schedule-no-recurse",
    name: "schedule-no-recurse",
    capability: "policy.schedule-no-recurse",
    recommended: ["interface:schedule"] as const,
  },
] as const;

interface PolicyDocument {
  readonly id?: unknown;
  readonly effect?: unknown;
  readonly description?: unknown;
  readonly rules?: unknown;
  readonly gates?: unknown;
}

function policyDir(name: string): string {
  return path.join(registryRoot, "components/policy", name, "1.0.0");
}

function loadPolicyYaml(name: string): PolicyDocument {
  const text = fs.readFileSync(path.join(policyDir(name), "payload/policy.yaml"), "utf8");
  return parse(text) as PolicyDocument;
}

describe("optional policy modules", () => {
  it.each(POLICIES)("$id module.yaml is a valid component", (policy) => {
    const text = fs.readFileSync(path.join(policyDir(policy.name), "module.yaml"), "utf8");
    const validated = parseAndValidateYaml("component", text);
    expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    expect(validated.data?.id).toBe(policy.id);
    expect(validated.data?.providesCapabilities).toEqual([policy.capability]);
    expect(validated.data?.requires.recommended).toEqual([...policy.recommended]);
    expect(validated.data?.license).toBe("MIT");
    expect(validated.data?.compatibility.vibekit).toBe("^1.0.0");
    expect(validated.data?.source.revision).toBe("v1.0.0");
    for (const file of validated.data?.files ?? []) {
      expect(isSafeFileTarget(file.source)).toBe(true);
      expect(isSafeFileTarget(file.target)).toBe(true);
    }
    expect(isSafeFileTarget(validated.data?.configuration.target ?? "")).toBe(true);
  });

  it.each(POLICIES)("$id policy.yaml has id, reduce-authority, and rules", (policy) => {
    const document = loadPolicyYaml(policy.name);
    expect(document.id).toBe(policy.id);
    expect(document.effect).toBe("reduce-authority");
    expect(typeof document.description).toBe("string");
    expect((document.description as string).length).toBeGreaterThan(0);
    expect(Array.isArray(document.rules)).toBe(true);
    expect((document.rules as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(document.gates)).toBe(true);
    expect((document.gates as unknown[]).length).toBeGreaterThan(0);
  });

  it("interface-pairing defaults deny unknown channel senders", () => {
    const document = loadPolicyYaml("interface-pairing") as PolicyDocument & {
      appliesTo?: { channels?: string[] };
      gates?: Array<{ surface?: string; default?: string; allowIf?: string[] }>;
    };
    expect(document.appliesTo?.channels).toEqual(["slack", "telegram", "http"]);
    const inbound = document.gates?.find((gate) => gate.surface === "interface.inbound");
    expect(inbound?.default).toBe("deny");
    expect(inbound?.allowIf).toEqual(expect.arrayContaining(["senderAllowlisted", "senderPaired"]));
  });

  it("memory-write-approval stages writes at a relative path", () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(policyDir("memory-write-approval"), "config.schema.json"), "utf8"),
    ) as { properties?: { stagePath?: { default?: string; pattern?: string } } };
    expect(schema.properties?.stagePath?.default).toBe(".vibekit/runtime/memory-pending.json");
    expect(isSafeFileTarget(schema.properties?.stagePath?.default ?? "")).toBe(true);
    const stagePattern = new RegExp(schema.properties?.stagePath?.pattern ?? "");
    expect(stagePattern.test(".vibekit/runtime/memory-pending.json")).toBe(true);
    expect(stagePattern.test("../escape.json")).toBe(false);
    expect(stagePattern.test("/tmp/memory-pending.json")).toBe(false);
  });

  it("interface-pairing storePath is relative-only", () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(policyDir("interface-pairing"), "config.schema.json"), "utf8"),
    ) as {
      properties?: {
        storePath?: { pattern?: string; default?: string };
        pairingTtlSeconds?: object;
      };
    };
    expect(schema.properties?.pairingTtlSeconds).toBeDefined();
    const storePattern = new RegExp(schema.properties?.storePath?.pattern ?? "");
    expect(storePattern.test(schema.properties?.storePath?.default ?? "")).toBe(true);
    expect(storePattern.test("../pairing.json")).toBe(false);
    expect(storePattern.test("/tmp/pairing.json")).toBe(false);
  });
});
