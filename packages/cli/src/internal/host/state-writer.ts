import type {
  EventDocument,
  RepositoryState,
  ResultDocument,
  TaskDocument,
} from "../core/index.js";

export function persistTurnState(input: {
  state?: RepositoryState;
  task: TaskDocument;
  events: readonly EventDocument[];
  result?: ResultDocument;
}): void {
  const state = input.state;
  if (state === undefined) {
    return;
  }
  if (state.tasks.tryGet(input.task.id) === undefined) {
    state.tasks.create(input.task);
  } else {
    try {
      state.tasks.update(input.task, { expectedRevision: input.task.revision - 1 });
    } catch {
      // Task may already be at this revision after a retry.
    }
  }
  for (const event of input.events) {
    state.events.append(event);
  }
  if (input.result !== undefined && state.results.tryGet(input.result.id) === undefined) {
    state.results.create(input.result);
  }
}
