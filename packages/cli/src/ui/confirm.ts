import { BACK, submit, type PromptResult } from "./result.js";
import { select } from "./select.js";

export async function confirm(input: {
  readonly message: string;
  readonly initial?: boolean;
}): Promise<PromptResult<boolean>> {
  const result = await select({
    message: input.message,
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
    initial: input.initial === false ? 1 : 0,
    searchable: false,
  });
  if (result.status !== "submit") {
    return result.status === "back" ? BACK : result;
  }
  return submit(result.value === true);
}
