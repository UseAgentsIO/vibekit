# VibeKit Agents

Source: [github.com/UseAgentsIO/vibekit](https://github.com/UseAgentsIO/vibekit)

VibeKit adds modular composition, project state, installation, and governance on top of [Pi](https://github.com/earendil-works/pi). Pi remains the Agent runtime.

This repository is in Phase 1: schemas and contracts.

## Packages

| Package | Name | Status |
| --- | --- | --- |
| `packages/core` | `@vibekit/core` | IDs, JSON Schemas, validation, lifecycles, errors |
| `packages/cli` | `vibekit` | Stub — CLI commands are not implemented yet |
| `packages/pi` | `@vibekit/pi` | Stub — Pi adapter is not implemented yet |

Schemas live in `schemas/`. Spec fixtures live in `fixtures/`.

## Requirements

- Node.js >= 20
- pnpm

## Scripts

```bash
pnpm install
pnpm typecheck
pnpm test
```
