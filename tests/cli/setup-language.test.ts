import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETUP_ABILITIES,
  SETUP_ABILITIES,
  abilityRoots,
  connectionItems,
  normalizeWorkspaceSelection,
  restrictProjectAbilities,
} from "../../packages/cli/src/setup-language.js";
import { createDefaultProject } from "@useagentsio/core";

describe("ordinary setup language", () => {
  it("starts with useful abilities and resolves their registry roots internally", () => {
    expect(DEFAULT_SETUP_ABILITIES).toEqual(["files", "commands", "web-search", "memory"]);
    expect(SETUP_ABILITIES.map((item) => item.label)).toEqual([
      "Read and write files",
      "Run approved commands",
      "Enable web search",
      "Remember useful context",
    ]);
    expect(abilityRoots(DEFAULT_SETUP_ABILITIES)).toEqual([
      "tool:filesystem",
      "tool:execution",
      "tool:web",
      "state:memory",
      "tool:memory",
    ]);
  });

  it("uses connection language and keeps workspace selections relative", () => {
    expect(connectionItems([
      { id: "terminal", label: "Terminal" },
      { id: "telegram", label: "Telegram" },
    ]).map((item) => item.label)).toEqual(["Use the terminal", "Connect Telegram"]);
    expect(normalizeWorkspaceSelection("")).toBe(".");
    expect(normalizeWorkspaceSelection("./src\\app")).toBe("src/app");
  });

  it("turns an omitted ability into an explicit runtime denial", () => {
    const project = createDefaultProject({ slug: "ability", name: "Ability" });
    const restricted = restrictProjectAbilities(project, ["files"]);
    expect(restricted.authorization.actions["source.read"]).toBe("standing");
    expect(restricted.authorization.actions["web.search"]).toBe("deny");
    expect(restricted.authorization.actions["memory.write"]).toBe("deny");
  });
});
