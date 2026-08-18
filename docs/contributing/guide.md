# Contributing Guide

Thank you for your interest in contributing to **VibeKit Agents**! This guide outlines how to set up your local development environment, run test suites, and submit high-quality contributions.

---

## 1. Development Environment Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `11.18.0` (pinned in `package.json` under `packageManager`)
- **Git**: `>= 2.30`

---

## 2. Workspace Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
```

---

## 3. Development Workflow & Commands

### Running Tests
Vitest is used for testing across all packages:

```bash
# Run all unit, integration, and e2e test suites
pnpm test

# Run a specific test file or directory
pnpm test tests/cli
pnpm test tests/host/host.test.ts
```

### Type Checking
TypeScript project references are verified across the entire monorepo:

```bash
pnpm typecheck
```

### Rebuilding the Registry Index
If you add or update modules in `registry/`:

```bash
pnpm registry:index
```

### Running the CLI Locally
You can execute the local CLI entrypoint using `tsx`:

```bash
pnpm exec tsx packages/cli/src/index.ts --help
pnpm exec tsx packages/cli/src/index.ts create test-agent --yes
```

---

## 4. Architectural Rules & Invariants

When contributing, you **must adhere** to the following invariants:

1. **Do Not Fork Pi**: Pi is consumed as an embedded library dependency. Do not fork or rewrite Pi's core runtime.
2. **Secrets as References Only**: Never commit, hardcode, or serialize secret values in YAML, JSON, state files, or test fixtures. Always use `{ name, source: "environment" }`.
3. **Relative File Targets Only**: Reject all absolute paths, parent directory traversals (`..`), or null bytes.
4. **No Third-Party Marketplaces**: All registry modules in V1 belong to the official catalog.
5. **No `orchestrator`, `subagent`, or `Blocks` Types**: Delegation is an Agent capability, not a separate framework type.
6. **Interface Decoupling**: Interfaces must never own project state, permissions, or agent recipes.

---

## 5. Submitting Changes

1. Open an issue or join an existing discussion to align on requirements.
2. Create a focused feature branch.
3. Ensure all tests (`pnpm test`) pass cleanly.
4. Submit a Pull Request targeting the `main` branch with clear description and testing evidence.
