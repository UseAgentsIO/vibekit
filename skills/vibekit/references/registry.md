# VibeKit registry authoring

Use this reference only when adding or changing an official Component or Agent. V1 has one official registry and immutable versioned payloads; do not add third-party registry behavior or a marketplace.

## Start from the source of truth

Read the current schemas under `schemas/`, the closest existing Module under `registry/`, and `docs/spec/V1-Implementation-Specification.md`. Use the implementation and tests as the final authority when older prose examples differ from current package names or behavior.

Place Modules at:

```text
registry/components/<type>/<name>/<version>/module.yaml
registry/components/<type>/<name>/<version>/config.schema.json
registry/components/<type>/<name>/<version>/payload/...

registry/agents/<name>/<version>/module.yaml
registry/agents/<name>/<version>/payload/agent.yaml
registry/agents/<name>/<version>/payload/instructions.md
```

Use lowercase typed IDs and Semantic Versions. Never modify a published version in place; create a new version directory.

## Author the minimum complete contract

For a Component, declare compatibility, immutable source revision, license, provided capabilities, required/optional/recommended/conflicting dependencies, requested permissions, environment-only secret references, file installs, configuration schema and target, and a health check when runtime verification is possible.

For an Agent, declare its instructions, model override rules, Component sets, required capabilities, inputs, outputs, permission allows and denies, delegation limits, State access, isolation and timeout, required verification, completion conditions, escalation conditions, and installed files.

Keep Skills procedural and Policies restrictive. A Skill never grants authority, and a Policy never silently expands it.

## Keep payloads safe

- Use relative file targets and explicit `exclusive` or `generated` ownership.
- Reject traversal, absolute paths, null bytes, and symlink escapes.
- Put shared settings in per-Module fragments and generate combined runtime configuration elsewhere.
- Declare npm dependencies and configuration declaratively. Do not add arbitrary installation hooks.
- Store secret names and `source: environment` only. Scan fixtures, payloads, and examples for likely values.
- Map Tools and Skills to Pi-native mechanisms before adding a VibeKit-specific runtime layer.

## Rebuild and verify

After any registry change, run:

```bash
pnpm registry:index
pnpm typecheck
pnpm test
```

Require the index builder to validate every Module and rewrite `registry/index.json`. Add the smallest focused test that proves a new contract, safety rule, dependency, payload install, or runtime behavior, then keep the full repository gates green.

Test installation into a clean temporary Project through the CLI, inspect the exact installed files and manifest ownership, and run `doctor`. For an update, test the three-way local/base/upstream cases. For removal, test modified-file preservation and shared dependency retention.

Do not claim a registry Module is usable from schema validation alone. Prove installation, Project composition, and the relevant runtime or health behavior.
