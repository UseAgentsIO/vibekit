# Security & Permission Boundary

VibeKit provides robust, defense-in-depth security for agent execution. Unlike conventional agent frameworks that rely exclusively on LLM system prompt instructions, VibeKit enforces strict capability boundaries at the code-level runtime boundary.

---

## 1. The Permission Intersection Formula

Whenever an agent attempts an action (invoking a tool, reading/writing files, executing shell commands, or delegating tasks), the Host evaluates effective permission using the intersection formula:

$$\text{Effective Permission} = \text{Capability} \cap \text{Policy} \cap \text{Agent Grant} \cap \text{Task Scope} \cap \text{Current Authorization}$$

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Tool Capability (What the tool technically allows)       │
│    ∩                                                        │
│ 2. Project Policies (e.g., policy:least-privilege)          │
│    ∩                                                        │
│ 3. Agent Definition Grants (tools, write-path scopes)       │
│    ∩                                                        │
│ 4. Task Scope (constraints declared on the specific task)   │
│    ∩                                                        │
│ 5. Current Human Authorization (pending approval gates)     │
│    =                                                        │
│    EFFECTIVE RUNTIME PERMISSION                             │
└─────────────────────────────────────────────────────────────┘
```

If **any** layer denies or omits the permission, the operation is immediately blocked with an actionable error.

---

## 2. File Target Safety & Path Sandboxing

File write and edit operations are subjected to strict path validation:
- **Relative Paths Only**: All target paths must be relative to the project root or worktree root.
- **Traversal Prevention**: Path segments containing `..`, absolute paths (e.g., `/etc/passwd`), null bytes (`\0`), or Windows device names (`CON`, `PRN`) are unconditionally rejected.
- **Path Grants**: Agents declare allowed write prefixes in `agent.yaml`:
  ```yaml
  permissions:
    paths:
      allow:
        - "src/**"
        - "tests/**"
      deny:
        - ".vibekit/**"
        - ".git/**"
        - "package.json"
  ```
- **Exclusive Workspace Locks**: Parallel worker runs operate inside dedicated Git worktrees to prevent race conditions and cross-agent filesystem corruption.

---

## 3. Secret Reference Model

VibeKit guarantees that sensitive secrets (API keys, personal tokens) never leak into project files, version control, or execution logs.

### Rules of Secret Handling
1. **References, Never Values**: YAML and JSON contracts store only the environment variable *name* and *source*, never the actual credential value:
   ```yaml
   secrets:
     - name: OPENAI_API_KEY
       source: environment
   ```
2. **No Secret Serializing**: The state serialization engine strips and filters environment variables before persisting `TaskDocument`, `ResultDocument`, and `EventDocument` records.
3. **Targeted Ingestion**: Worker sessions only receive the specific environment variables referenced by their configured provider and tool modules.

---

## 4. Untrusted Source Segregation

Data entering the agent loop from external origins (user-supplied issue descriptions, retrieved web content, tool command stdout/stderr) is categorized as **untrusted data**.

In `.vibekit/project.yaml`, sources are partitioned:

```yaml
sources:
  canonical:
    - "docs/spec/**"
    - "README.md"
  derived:
    - "dist/**"
  untrusted:
    - "issues/**"
    - "inbound/**"
```

- **Prompt Injection Defense**: Untrusted content is wrapped in clear data delimiters and accompanied by system instructions emphasizing that user/external text cannot override project policies or elevate capabilities.
- **Reviewer Isolation**: The `agent:reviewer` agent has no `source.write` permissions by default, preventing compromised review agents from injecting malicious modifications.
