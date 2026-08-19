# Headquarters — Expandable Life & Operations Coordinator

An always-running personal coordinator and extensible multi-agent blueprint built with [VibeKit](file:///Users/sethrose/Documents/07_Projects/VibeKit-Agents/vibekit/README.md).

> [!TIP]
> **Expandable by Design**: Headquarters starts with just **two agents**—a central **Chief of Staff** (your front door) and a **Personal Director** (your first domain area). It is specifically designed as a starter blueprint that you can incrementally expand to coordinate any domain of your life or work (Health, Finances, Home, Career, Business, Software Engineering, Research, and more).

---

## 🎯 Architecture & Expansion Model

### The Starter Blueprint (Day 1)
You begin with a clean, focused 2-agent composition:

```text
                                Human Operator
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
            Slack Interface                        Terminal Interface
         (interface:slack)                        (interface:terminal)
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      ▼
                                 AGENT HOST
                            (vibekit-host daemon)
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
            Chief of Staff Agent                 Project State
           (Central Intake & Routing)         (.vibekit/state/)
                     │                        - Tasks & Results
                     ▼                        - Decisions & Approvals
          Personal Director Agent             - Scoped Memory
         (Domain Execution & Admin)           - Schedules & Events
```

### Expanding As You Grow (Day 2 and Beyond)
As your needs grow, you simply register new domain agents and grant the Chief delegation authority. No workflow code changes required:

```text
                             Chief of Staff Agent
                           (Central Intake & Routing)
                                      │
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
    Personal        Health        Finance          Home         Business
    Director       Director       Director       Director       Director
   (Day 1 Base)   (Your Add)     (Your Add)     (Your Add)     (Your Add)
                                                                    │
                                                      ┌─────────────┴─────────────┐
                                                      ▼                           ▼
                                                 Coder Agent                Reviewer Agent
                                              (Git Worktrees)             (Diff Verification)
```

---

## 🔑 Core Mental Model

1. **Single Front Door (`chief`)**:
   - You interact with one primary partner: the **Chief of Staff**.
   - The Chief interprets your intent across all life areas, manages ongoing context, decomposes complex requests into discrete **Tasks**, and delegates them to the appropriate domain agent.
2. **Specialized Domain Agents (`personal`, `health`, etc.)**:
   - Each domain agent owns a focused area of responsibility (e.g. personal logistics, medical records, financial planning, household maintenance).
   - Domain agents run bounded worker runs, produce structured **Results**, and report findings back to the Chief.
3. **Explicit Delegation & Boundaries**:
   - Delegation authority is declared in `.vibekit/project.yaml`.
   - The Chief has permission to delegate down to your configured domain agents. Domain agents stay isolated within their granted capabilities.

---

## 👥 Starter Workforce Composition

| Agent Binding | Domain | Role & Scope | Granted Delegation Targets |
| :--- | :--- | :--- | :--- |
| **`chief`** | Central | Conversational front door, intent parsing, task decomposition, progress narration, decision cards | `personal` *(expandable)* |
| **`personal`** | Personal | Personal administration, scheduling, travel logistics, vital records, document preparation | — |

---

## 🛠️ Step-by-Step Guide: Expanding Your Workforce

Adding a new domain area takes just 3 simple configuration steps. Here is how to add a **Health Director** and an autonomous **Coder**:

### Step 1: Install or Define Your New Agent
Install from the official registry or add a custom recipe:
```bash
# Add a coder from the official catalog
vibekit add agent coder --yes

# Or create a custom agent recipe at .vibekit/agents/director-health/agent.yaml
```

### Step 2: Register the Binding in `.vibekit/project.yaml`
Add your new agent to `agentBindings`:
```yaml
agentBindings:
  chief:
    definition: agent:chief-of-staff
  personal:
    definition: agent:director-personal
  health:
    definition: agent:director-health     # <-- Added Health Director
  coder:
    definition: agent:coder               # <-- Added Software Coder
```

### Step 3: Grant Delegation Permission to Chief
Update the `delegation` map to authorize Chief to delegate to your new agents:
```yaml
delegation:
  chief:
    - personal
    - health                              # <-- Chief can now route health tasks
    - coder                               # <-- Chief can now delegate coding tasks
  personal: []
  health: []
  coder: []
```

### Step 4: Verify with `vibekit doctor`
Run diagnostics to ensure schemas, checksums, and delegation graphs are valid:
```bash
vibekit doctor
```

Once verified, you can immediately talk to the Chief about your new domain:
```bash
vibekit msg "Track my recent blood panel results and summarize recommendations"
```

---

## 🚀 Running the Starter Example

### 1. Configure Environment Variables
```bash
export OPENAI_API_KEY="sk-proj-..."
export SLACK_BOT_TOKEN="xoxb-..."      # Optional: for Slack transport
export SLACK_APP_TOKEN="xapp-..."      # Optional: for Slack transport
```

### 2. Start the Host Daemon
```bash
# Runs the always-running Host with active interfaces
vibekit start
```

### 3. Send a Message
```bash
# Test a personal logistics task
vibekit msg "Organize my upcoming travel schedule and verify there are no conflicting appointments"
```

---

## 📖 Related Documents

- [Realization Roadmap & Extension TODOs (TODO.md)](TODO.md)
- [Project Contract Manifest (.vibekit/project.yaml)](.vibekit/project.yaml)
- [VibeKit System Architecture](file:///Users/sethrose/Documents/07_Projects/VibeKit-Agents/vibekit/docs/architecture/overview.md)
- [Multi-Agent Delegation Patterns Guide](file:///Users/sethrose/Documents/07_Projects/VibeKit-Agents/vibekit/docs/patterns/chief-coder-reviewer.md)
