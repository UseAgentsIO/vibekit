# Project Workspace Layout

This guide explains the directory layout created in a VibeKit workspace, including file ownership, source control rules, and runtime directories.

---

## Directory Tree

After initializing a project with `vibekit create` or `vibekit init`, the workspace contains two hidden directories:

```text
my-project/
├── .pi/                          # Pi internal engine settings & extensions
│   ├── extensions/               # Embedded Pi extensions
│   ├── skills/                   # Localized skill definitions
│   └── settings.json             # Pi engine configuration
│
└── .vibekit/                     # VibeKit Project Domain (Owner: User + CLI)
    ├── project.yaml              # Project contract & configuration
    ├── installed.json            # Installed module manifest & file checksums
    │
    ├── agents/                   # Agent recipes (Editable)
    │   └── chief/
    │       ├── agent.yaml        # Agent capabilities & grants
    │       └── instructions.md   # Prompt persona & instructions
    │
    ├── components/               # Installed components (Tools, Skills, etc.)
    │   ├── policies/
    │   └── tools/
    │
    ├── state/                    # Durable Project State (Tracked)
    │   ├── tasks/                # task_*.json records
    │   ├── results/              # result_*.json outcomes
    │   ├── decisions/            # decision_*.json architectural choices
    │   ├── approvals/            # approval_*.json human authorizations
    │   ├── verifications/        # verification_*.json test logs
    │   └── conversations/        # conversation_*.json dialogue turns
    │
    └── runtime/                  # Ephemeral Runtime Locks (GITIGNORED)
        ├── claims/               # Active task claim leases
        ├── worktrees/            # Temporary Git worktree directories
        └── host.status.json      # Host PID and live health heartbeat
```

---

## What to Commit vs. Gitignore

### ✅ Tracked in Source Control
Commit these files to version control so your team shares identical agent definitions, policies, and project memory:
- `.vibekit/project.yaml`
- `.vibekit/installed.json`
- `.vibekit/agents/**` (Agent definitions and instruction prompts)
- `.vibekit/components/**`
- `.vibekit/state/` (When tracking mode is set to `track` in `project.yaml`)
- `.pi/settings.json`

### ❌ Gitignored Runtime Files
Add `.vibekit/runtime/` and environment credentials to your `.gitignore`:

```gitignore
# VibeKit Ephemeral Runtime
.vibekit/runtime/
.vibekit/state/events/

# Secrets and Local Environment
.env
.env.*
```

---

## File Ownership Principles

1. **User Ownership**: All files copied under `.vibekit/agents/` and `.vibekit/components/` belong to you. You can customize them freely.
2. **Three-Way Safety**: When running `vibekit update`, your edits are protected by the three-way merge engine.
3. **No Hidden State**: VibeKit does not rely on hidden cloud databases. All state lives as transparent JSON documents right in your repository.
