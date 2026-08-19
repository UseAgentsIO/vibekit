# Installed Manifest (`installed.json`)

Transactional record of modules installed in the Project. Schema: `schemas/installed.schema.json`. `modules` is an **array**, not a map.

---

## Shape

```json
{
  "schemaVersion": 1,
  "modules": [
    {
      "schemaVersion": 1,
      "id": "agent:chief",
      "version": "1.0.0",
      "registrySource": "official",
      "sourceRevision": "v1.0.0",
      "integrityChecksum": "sha256:…",
      "installedAt": "2026-08-18T08:00:00.000Z",
      "dependencies": [],
      "files": [
        {
          "path": ".vibekit/agents/chief/agent.yaml",
          "hash": "sha256:…",
          "ownership": "exclusive"
        },
        {
          "path": ".vibekit/agents/chief/instructions.md",
          "hash": "sha256:…",
          "ownership": "exclusive"
        }
      ],
      "configurationPaths": [],
      "compatibility": {
        "vibekit": "^1.0.0",
        "pi": ">=0.50.0",
        "node": ">=20"
      }
    }
  ]
}
```

---

## Fields

| Field | Meaning |
| :--- | :--- |
| `id` | Module ID (`agent:chief`) |
| `version` | Installed semver |
| `registrySource` | `official` for the default curated registry, or `local:<absolute-path>` for a custom registry path |
| `sourceRevision` | Registry module `source.revision` |
| `integrityChecksum` | Directory checksum of the installed module version |
| `files[]` | Project-relative `path`, content `hash` (`sha256:…`), `ownership` (`exclusive` \| `generated`) |
| `configurationPaths` | Config files created for the module |
| `dependencies` | Module IDs installed to satisfy `requires.required` |

Do not hand-edit this file to fake an install. Use `vibekit add` / `update` / `remove`.

`vibekit list` **VERIFIED** means every recorded file still exists and its hash matches the manifest (no local edit). **AVAILABLE** means the ID is in the registry index, not “loaded in the Host.”
