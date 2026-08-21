# Project Workspace Layout

Layout after `vibekit create` or `vibekit init`.

---

## Directory tree

```text
my-project/
├── .pi/                              # Pi engine (skills, extensions)
│   ├── extensions/
│   ├── skills/
│   └── settings.json
│
└── .vibekit/
    ├── project.yaml
    ├── installed.json
    ├── agents/<name>/
    │   ├── agent.yaml
    │   └── instructions.md
    ├── components/                   # providers, policies, interfaces, …
    ├── config/                       # generated/owned config YAML
    ├── state/                        # durable records (YAML)
    │   ├── tasks/                    # task_<uuid>.yaml
    │   ├── results/
    │   ├── decisions/
    │   ├── approvals/
    │   ├── verifications/
    │   ├── events/
    │   └── conversations/            # conversation_<uuid>.yaml (Host)
    └── runtime/                      # gitignored
        ├── host.lock
        ├── host-status.json
        ├── host.sock                 # IPC (POSIX)
        ├── sessions/
        ├── claims/
        └── uploads/
```

Worktrees for mutating Runs live under the Git repo’s worktree directory (managed by the embedded Pi runtime), not as committed Project files.

---

## Commit vs ignore

**Typically commit**
- `.vibekit/project.yaml`
- `.vibekit/installed.json`
- `.vibekit/agents/**`
- `.vibekit/components/**`
- `.vibekit/config/**` (unless generated-only)
- State kinds with `tracking: git` (default: `decisions`)

**Gitignore (create writes `.vibekit/runtime/`)**

```gitignore
.vibekit/runtime/
```

Kinds with `tracking: local` stay on disk but are not the Git-backed history. `runtime: ephemeral` must not be committed.

---

## Ownership

Installed Agent and Component files belong to the Project. `vibekit update` three-way-compares base vs local vs upstream. Conflicts stop; there is no `--force`.
