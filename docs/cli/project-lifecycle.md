# Project Lifecycle & Diagnostics

VibeKit provides predictable, transactional lifecycle management for installed modules and project state. This document explains the mechanics of three-way merging, ownership rules, safe removal, and project diagnostics.

---

## 1. The Three-Way Merge Engine

When you install a module using `vibekit add`, VibeKit copies the module's template files into your project and records the base version and SHA-256 file hashes in `.vibekit/installed.json`.

You own the files in your project. You can freely customize `agent.yaml`, `instructions.md`, or component configs.

When you later run `vibekit update <module>`, VibeKit evaluates three versions of every file:
1. **Base ($B$)**: The pristine registry version originally installed.
2. **Local ($L$)**: Your current project file (with any local edits).
3. **Upstream ($U$)**: The new registry version you are updating to.

```text
               Base Version (B)
              /               \
             /                 \
            ▼                   ▼
    Local File (L)       Upstream File (U)
            \                   /
             \                 /
              ▼               ▼
           Merged Project File (M)
```

### Merge Decision Rules

| Local Edit? ($L \neq B$) | Upstream Changed? ($U \neq B$) | Result |
| :---: | :---: | :--- |
| **No** | **No** | **Unchanged**: No action needed. |
| **No** | **Yes** | **Clean Update**: Upstream version is applied cleanly. |
| **Yes** | **No** | **Keep Local**: Your local customization is preserved. |
| **Yes** | **Yes** | **Conflict**: Operation stops immediately. |

> [!WARNING]
> **No Silent Overwrites / No `--force`**: In V1, VibeKit refuses to overwrite conflicting files automatically. If a conflict occurs, the entire module update is halted. You must review the differences using `vibekit diff <module>` and resolve them manually.

---

## 2. Safe Module Removal

When you run `vibekit remove <module>`:
1. **Exclusive vs. Shared**: VibeKit checks the dependency graph. If a dependency (e.g., `tool:filesystem`) is also required by another installed agent, it remains installed.
2. **Local Edits Guard**: If you modified an exclusive file created by the module, removal will stop and warn you to prevent accidental data loss.
3. **Manifest Cleanup**: Upon successful removal, the module entry is cleanly removed from `installed.json` and `.vibekit/project.yaml`.

---

## 3. The `vibekit doctor` Diagnostic Engine

`vibekit doctor` acts as the integrity gatekeeper for your project. Run it anytime you suspect misconfigurations or before deploying an agent to production.

```text
$ vibekit doctor

  ✓ Schema validation: project.yaml matches project.schema.json
  ✓ Manifest integrity: installed.json checksums verified
  ✓ Dependency graph: no undeclared dependencies or cycles
  ✓ Permissions: all agent path grants and tool scopes valid
  ✓ Runtime files: state directories and lock files healthy

Project is healthy.
```

### What `doctor` Checks:
- **Schema Conformity**: Validates `project.yaml`, `installed.json`, and all component configurations against their respective JSON schemas.
- **Integrity Verification**: Checks installed manifest checksums against the module registry and verifies installed file hashes for tampering.
- **Dependency & Capability Completeness**: Ensures all required dependencies and required agent capabilities resolve to installed providers.
- **Cycle Detection**: Verifies that agent delegation graphs and module dependencies do not contain cycles.
- **Scope & Path Safety**: Validates agent permission grants for path traversal (`..`), leading slashes, null bytes, command injection characters, and invalid scope combinations.
- **Runtime Exports**: Verifies that executable modules declaring `runtime.package` have resolvable packages and valid exported symbols matching `runtime.export`.
