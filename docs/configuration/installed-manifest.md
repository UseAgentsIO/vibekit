# Installed Manifest (`installed.json`)

The `.vibekit/installed.json` file serves as the transactional record of all modules installed in your project, tracking module origins, dependency linkages, and file integrity checksums.

---

## Example `installed.json`

```json
{
  "schemaVersion": 1,
  "modules": {
    "agent:chief": {
      "id": "agent:chief",
      "version": "1.0.0",
      "source": "official",
      "installedAt": "2026-08-18T08:00:00.000Z",
      "files": {
        ".vibekit/agents/chief/agent.yaml": "sha256-a1b2c3...",
        ".vibekit/agents/chief/instructions.md": "sha256-d4e5f6..."
      },
      "dependencies": [
        "policy:least-privilege",
        "tool:filesystem"
      ]
    },
    "tool:filesystem": {
      "id": "tool:filesystem",
      "version": "1.0.0",
      "source": "official",
      "installedAt": "2026-08-18T08:00:00.000Z",
      "files": {
        ".vibekit/components/tools/filesystem.yaml": "sha256-789abc..."
      },
      "dependencies": []
    }
  }
}
```

---

## Manifest Fields

- `schemaVersion` *(integer)*: Manifest format schema version.
- `modules` *(object)*: Map of installed module IDs to installation records:
  - `id` *(string)*: Typed module identifier (e.g., `agent:chief`).
  - `version` *(string)*: Exact semver version installed from the registry.
  - `source` *(string)*: Origin registry identifier (`official` or registry path).
  - `installedAt` *(string)*: ISO-8601 installation timestamp.
  - `files` *(object)*: Relative file paths mapped to their SHA-256 base checksum at the time of installation.
  - `dependencies` *(array)*: List of module IDs required by this module.

---

## Role in Three-Way Lifecycle

The checksums stored in `files` allow VibeKit to answer the crucial question during `vibekit update`:
*"Has the user customized this file locally since it was installed?"*

- If `sha256(current_file) == base_checksum`, the file is unmodified and can be upgraded cleanly.
- If `sha256(current_file) != base_checksum`, the user has made local edits. VibeKit preserves those edits.

The manifest is maintained automatically by the CLI. You should never edit `installed.json` by hand.
