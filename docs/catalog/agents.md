# Official Agents

The official registry provides six core Agent recipes tailored for multi-agent software engineering and personal-coordination workflows.

To add or change an official Agent, follow [Module authoring](../contributing/module-authoring.md) and the root [CONTRIBUTING.md](../../CONTRIBUTING.md). Do not invent an `orchestrator` or `subagent` type — a Chief is an Agent with delegation permission.

---

## 1. Chief Agent (`agent:chief`)

The coordinator agent for high-level user interaction, planning, and task delegation.

- **Module ID**: `agent:chief`
- **Role**: Ingests user objectives, formulates execution plans, creates child tasks, and delegates to specialized workers.
- **Key Capabilities**:
  - `agent_delegate`: Authorized to dispatch tasks to `coder`, `reviewer`, `project-manager`, `researcher`, and `personal`.
  - Max delegation depth: `2`.
- **Default Files**:
  - `.vibekit/agents/chief/agent.yaml`
  - `.vibekit/agents/chief/instructions.md`

---

## 2. Coder Agent (`agent:coder`)

A focused implementation worker designed to write, edit, and refactor code.

- **Module ID**: `agent:coder`
- **Role**: Implements bounded technical tasks within isolated Git worktrees. Returns artifacts, test logs, and structured evidence.
- **Key Capabilities**:
  - Bound to `tool:filesystem` and `tool:execution`.
  - Mutation isolation: `worktree`.
  - Read/write access restricted to project source directories.
- **Guardrails**:
  - `independentReview: false` (Coder cannot approve or verify its own output).
  - Must return execution evidence for all changes.

---

## 3. Reviewer Agent (`agent:reviewer`)

An independent validation and code review agent.

- **Module ID**: `agent:reviewer`
- **Role**: Inspects diffs, verifies test results against requirements, and records findings without modifying code.
- **Key Capabilities**:
  - Bound to `tool:filesystem` (read-only operations).
- **Guardrails**:
  - **No `source.write` grants**: Reviewer cannot edit code.
  - Refuses review tasks if requested to review work it produced.

---

## 4. Project Manager Agent (`agent:project-manager`)

Specialized in project tracking, task decomposition, and milestone coordination.

- **Module ID**: `agent:project-manager`
- **Role**: Breaks complex epics into discrete `TaskDocument` records with explicit acceptance criteria and constraints.
- **Key Capabilities**:
  - `agent_delegate`: Delegates to `coder` and `researcher`.
  - Creates and manages tasks in `.vibekit/state/tasks/`.

---

## 5. Researcher Agent (`agent:researcher`)

Specialized in cited analysis, documentation synthesis, and architectural research.

- **Module ID**: `agent:researcher`
- **Role**: Conducts literature reviews, codebase exploration, and comparative studies.
- **Key Capabilities**:
  - Bound to `skill:research` and `tool:filesystem` (read-only).
- **Guardrails**:
  - No write grants to source files.
  - Emits findings as structured Decision or Research documents.

---

## 6. Personal Agent (`agent:personal`)

A life-admin worker for schedules, errands, and personal follow-ups.

- **Module ID**: `agent:personal`
- **Role**: Receives bounded personal Tasks from Chief and returns a plan or answer.
- **Key Capabilities**:
  - Read-only Project access (`source.read`).
- **Guardrails**:
  - **No `source.write`**.
  - Stays in the personal domain; other specialties return to Chief.
