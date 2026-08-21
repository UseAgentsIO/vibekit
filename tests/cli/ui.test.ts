import { describe, expect, it } from "vitest";

import { loadRegistry } from "@useagentsio/core";

import { parseCliArgs } from "../../packages/cli/src/args.js";
import { parseKey, releaseTerminal, withRawInput } from "../../packages/cli/src/ui/keys.js";
import { defaultMenuLimit, filterOptions, windowItems, wrapIndex } from "../../packages/cli/src/ui/options.js";
import { optionLines } from "../../packages/cli/src/ui/render.js";
import { BACK, isBack, submit } from "../../packages/cli/src/ui/result.js";
import { runWizard } from "../../packages/cli/src/ui/wizard.js";
import {
  asMenuOptions,
  deriveDelegation,
  inferDefaultAgent,
  labelFor,
  projectPolicyItems,
  SETUP_AGENTS,
  SETUP_POLICIES,
  setupItemsFromRegistry,
} from "../../packages/cli/src/setup-catalog.js";
import { buildTempRegistry, officialRegistryDir } from "../helpers.js";

describe("cli ui kit", () => {
  it("parses navigation and control keys", () => {
    expect(parseKey("\x1b[A").name).toBe("up");
    expect(parseKey("\x1b[B").name).toBe("down");
    expect(parseKey("\r").name).toBe("enter");
    expect(parseKey("\x1b").name).toBe("escape");
    expect(parseKey(" ").name).toBe("space");
    expect(parseKey("/").name).toBe("slash");
    expect(parseKey("\x03").name).toBe("ctrlc");
    expect(parseKey("\x7f").name).toBe("backspace");
    expect(parseKey("a")).toEqual({ name: "char", sequence: "a" });
    expect(parseKey("\x1b[C").name).toBe("unknown");
  });

  it("filters and windows menu options for reuse", () => {
    const registry = loadRegistry(officialRegistryDir);
    const agentItems = setupItemsFromRegistry(SETUP_AGENTS, registry, "agent");
    const options = asMenuOptions(agentItems);
    expect(options.find((option) => option.value === "reviewer")?.hint).toMatch(/independent review/);
    expect(filterOptions(options, "independent").map((option) => option.value)).toEqual(["reviewer"]);
    expect(filterOptions(options, "bounded software").map((option) => option.value)).toEqual(["coder"]);
    expect(filterOptions(options, "project-manager").map((option) => option.label)).toEqual([
      "Project Manager",
    ]);
    expect(labelFor(SETUP_AGENTS, "reviewer")).toBe("Reviewer");

    const items = ["a", "b", "c", "d", "e", "f"];
    expect(windowItems(items, 0, 3)).toEqual({ items: ["a", "b", "c"], start: 0 });
    expect(windowItems(items, 5, 3)).toEqual({ items: ["d", "e", "f"], start: 3 });
    expect(windowItems(items, 2, 10)).toEqual({ items: items, start: 0 });
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(defaultMenuLimit(24)).toBe(12);
    expect(defaultMenuLimit(8)).toBe(6);
  });

  it("parses repeatable setup flags used by any command", () => {
    const parsed = parseCliArgs([
      "init",
      "--provider",
      "openai",
      "--skill",
      "research",
      "--skill",
      "software-development",
      "--tool",
      "filesystem",
      "--verbose",
      "--show-files",
      "--customize",
    ]);
    expect(parsed.command).toBe("init");
    expect(parsed.flags.provider).toBe("openai");
    expect(parsed.flags.skills).toEqual(["research", "software-development"]);
    expect(parsed.flags.tools).toEqual(["filesystem"]);
    expect(parsed.flags.verbose).toBe(true);
    expect(parsed.flags.showFiles).toBe(true);
    expect(parsed.flags.customize).toBe(true);
  });

  it("parses repeatable --agent flags and infers the default Agent", () => {
    const parsed = parseCliArgs([
      "init",
      "--agent",
      "coder",
      "--agent",
      "reviewer",
      "--agent",
      "chief",
    ]);
    expect(parsed.flags.agents).toEqual(["coder", "reviewer", "chief"]);
    expect(inferDefaultAgent(parsed.flags.agents)).toBe("chief");
    expect(inferDefaultAgent(["coder", "reviewer"])).toBe("coder");
    expect(inferDefaultAgent([])).toBeUndefined();
    expect(deriveDelegation(["chief", "coder", "reviewer"])).toEqual({
      chief: ["coder", "reviewer"],
      coder: [],
      reviewer: [],
    });
    expect(deriveDelegation(["coder", "reviewer"])).toEqual({
      coder: [],
      reviewer: [],
    });
    expect(
      deriveDelegation(["lead", "worker"], { lead: ["worker", "reviewer"], worker: [] }),
    ).toEqual({
      lead: ["worker"],
      worker: [],
    });
  });

  it("does not invent official Agents that a custom registry omitted", () => {
    const registry = loadRegistry(
      buildTempRegistry([
        {
          type: "policy",
          name: "only-policy",
        },
      ]),
    );
    const agents = setupItemsFromRegistry(SETUP_AGENTS, registry, "agent");
    expect(agents.map((item) => item.id)).toEqual([]);
  });

  it("hydrates setup items from registry metadata and keeps project policies small", () => {
    const registry = loadRegistry(officialRegistryDir);
    const agents = setupItemsFromRegistry(SETUP_AGENTS, registry, "agent");
    expect(agents.map((item) => item.id)).toEqual([
      "assistant",
      "chief",
      "coder",
      "reviewer",
      "researcher",
      "project-manager",
      "personal",
    ]);
    expect(agents.find((item) => item.id === "coder")?.description).toMatch(/evidence/);
    expect(agents.find((item) => item.id === "personal")?.label).toBe("Personal");

    const policies = projectPolicyItems(setupItemsFromRegistry(SETUP_POLICIES, registry, "policy"));
    expect(policies.map((item) => item.id)).toEqual(["least-privilege", "require-verification"]);
    expect(policies[0]?.description).toMatch(/Deny by default/);

    const interfaces = setupItemsFromRegistry(
      [{ id: "terminal", label: "Terminal" }],
      registry,
      "interface",
    );
    expect(interfaces.map((item) => item.id)).toEqual(
      expect.arrayContaining(["terminal", "telegram", "slack", "http", "webhook", "schedule"]),
    );
    expect(interfaces.find((item) => item.id === "telegram")?.description).toMatch(/Telegram/);
  });

  it("renders option descriptions below the label when asked", () => {
    const lines = optionLines({
      active: true,
      label: "Chief",
      hint: "Coordinates user intent, decomposes work, and delegates to specialized agents.",
      hintBelow: true,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Chief");
    expect(lines[1]).toMatch(/delegates to specialized agents/);
  });

  it("runWizard goes back to the previous step on esc", async () => {
    const seen: number[] = [];
    const result = await runWizard({
      initial: { n: 0 },
      steps: [
        async () => {
          seen.push(1);
          return submit({ n: 1 }, 0);
        },
        async (state) => {
          seen.push(2);
          if (seen.filter((step) => step === 2).length === 1) {
            return BACK;
          }
          return submit({ n: state.n + 1 }, 0);
        },
        async (state) => {
          seen.push(3);
          return submit({ n: state.n + 1 }, 0);
        },
      ],
    });
    expect(isBack(BACK)).toBe(true);
    expect(result).toEqual({ n: 3 });
    expect(seen).toEqual([1, 2, 1, 2, 3]);
  });

  it("runWizard cancels when the first menu goes back", async () => {
    const result = await runWizard({
      initial: { n: 0 },
      steps: [async () => BACK],
    });
    expect(result).toBeUndefined();
  });

  it("releases stdin after a raw menu session so the process can exit", async () => {
    await withRawInput(async () => "ok");
    releaseTerminal();
    expect(process.stdin.isPaused()).toBe(true);
  });
});
