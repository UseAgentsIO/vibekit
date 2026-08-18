import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../../packages/cli/src/args.js";
import { parseKey, releaseTerminal, withRawInput } from "../../packages/cli/src/ui/keys.js";
import { defaultMenuLimit, filterOptions, windowItems, wrapIndex } from "../../packages/cli/src/ui/options.js";
import { BACK, isBack, submit } from "../../packages/cli/src/ui/result.js";
import { runWizard } from "../../packages/cli/src/ui/wizard.js";
import { asMenuOptions, labelFor, SETUP_AGENTS } from "../../packages/cli/src/setup-catalog.js";

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
    const options = asMenuOptions(SETUP_AGENTS);
    expect(filterOptions(options, "rev").map((option) => option.value)).toEqual(["reviewer"]);
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
    ]);
    expect(parsed.command).toBe("init");
    expect(parsed.flags.provider).toBe("openai");
    expect(parsed.flags.skills).toEqual(["research", "software-development"]);
    expect(parsed.flags.tools).toEqual(["filesystem"]);
    expect(parsed.flags.verbose).toBe(true);
    expect(parsed.flags.showFiles).toBe(true);
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
