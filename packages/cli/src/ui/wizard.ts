import { clearRenderedLines } from "./theme.js";
import { isBack, isCancel, type PromptResult } from "./result.js";

export async function runWizard<S>(input: {
  readonly initial: S;
  readonly steps: ReadonlyArray<(state: S) => Promise<PromptResult<S>>>;
}): Promise<S | undefined> {
  let state = input.initial;
  let index = 0;
  const commits: number[] = [];

  while (index < input.steps.length) {
    const step = input.steps[index];
    if (step === undefined) {
      break;
    }
    const result = await step(state);
    if (isCancel(result)) {
      return undefined;
    }
    if (isBack(result)) {
      if (index === 0) {
        return undefined;
      }
      index -= 1;
      const lines = commits.pop() ?? 0;
      if (lines > 0) {
        clearRenderedLines(lines);
      }
      continue;
    }
    state = result.value;
    commits.push(result.lines ?? 1);
    index += 1;
  }

  return state;
}
