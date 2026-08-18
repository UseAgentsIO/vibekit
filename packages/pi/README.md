# @useagentsio/pi

Pi runtime adapter for VibeKit Agents.

VibeKit owns contracts around the Run. Pi owns the model/tool loop. This package loads Project and Agent documents, resolves effective configuration, assembles bounded context, filters the child environment, and starts an isolated Pi session.

```ts
import { prepareIsolatedRun, runIsolated } from "@useagentsio/pi";

const prepared = prepareIsolatedRun({
  projectRoot,
  bindingName: "coder",
  task,
});

const outcome = await runIsolated({
  projectRoot,
  bindingName: "coder",
  task,
  signal,
  createSession, // inject in tests; default talks to Pi
});
// outcome.events and outcome.result are returned, not written
```

The default session factory uses `@earendil-works/pi-coding-agent` (`createAgentSession`, `SessionManager.inMemory()`, `session.abort()`). Pi has no permission system; VibeKit allowlists tools and secrets before the session starts.

Run Events and Results are returned to the caller. This package does not persist Project State.

Build: `tsc -b packages/pi`.

