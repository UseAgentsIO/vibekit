# Headquarters — VibeKit Realization Roadmap & TODOs

This document outlines the architectural blueprint, missing components, and implementation tasks required to realize the **Headquarters: Minimal Life Coordinator Blueprint** as a production-grade [VibeKit](file:///Users/sethrose/Documents/07_Projects/VibeKit-Agents/vibekit/README.md) project.

---

## 🏛️ Project Purpose

The Headquarters starter blueprint demonstrates how to establish a single conversational front door (**Chief of Staff**) that delegates bounded life coordination tasks to a specialized domain agent (**Personal Director**). It serves as an educational starting point for users to understand VibeKit's hierarchical delegation and easily add their own custom domain agents (e.g. Health, Finance, Home, Career, or Engineering).

---

## 🧩 Taxonomy Mapping to VibeKit

$$\textbf{Components} \longrightarrow \textbf{Agents} \longrightarrow \textbf{Project} \longrightarrow \textbf{Host}$$

```text
                                Human Operator
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
            Slack Interface                        Terminal Interface
           (interface:slack)                      (interface:terminal)
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      ▼
                                 AGENT HOST
                            (vibekit-host daemon)
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
            Chief of Staff Agent                 Project State
           (agent:chief-of-staff)             (.vibekit/state/)
                     │                        - Tasks & Results
                     ▼                        - Decisions & Approvals
          Personal Director Agent             - Scoped Memory
         (agent:director-personal)            - Schedules & Events
```

---

## 📋 Missing Pieces & Required Tasks

To fully realize this starter project and enable seamless extension, the following components and host capabilities must be completed.

---

### 1. Interface Layer: Slack Socket Mode (`interface:slack`)
*Status: Missing Component in V1*

VibeKit currently ships with `interface:terminal`. A production life coordinator benefits from an always-accessible mobile/desktop Slack transport built on `@useagentsio/interface-sdk`.

- [ ] **Slack Socket Mode Adapter (`packages/interface-slack`)**:
  - Implement `@useagentsio/interface-slack` conforming to the standard `RunningInterface` lifecycle.
  - Connect via Slack Bolt / Socket Mode (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`).
  - Translate inbound Slack mentions, direct messages, and thread replies into Host `InboundMessage` objects with stable `conversationKey` (`slack:<channel>:<thread>`).
- [ ] **Progressive Activity Streaming & Block Kit**:
  - Stream thinking deltas, progress updates, and activity indicators dynamically using Slack Block Kit.
- [ ] **Decision & Approval Cards**:
  - Render Host `ask-approval` events as interactive Block Kit decision cards with Approve/Reject buttons that resolve approvals through `services.submit`.

---

### 2. Core Tool Components

- [ ] **Durable Scoped Memory (`tool:memory` / `state:memory`)**:
  - Lexical retrieval and prompt injection for personal preferences, records, and ongoing context.
  - Expose `memory_search`, `memory_store`, and `memory_prune` tools.
- [ ] **Scheduler Engine (`tool:scheduler` / `host:scheduler`)**:
  - Recurring schedule manager supporting `daily`, `weekdays`, `weekly`, and cron expressions with IANA timezones.
  - Distributed claim leases for scheduled triggers to prevent duplicate executions.
- [ ] **Document & File Management (`tool:filesystem`)**:
  - Bounded filesystem access for managing personal itineraries, notes, and records with path traversal guards.

---

### 3. Agent Workforce Recipes

- [ ] **`agent:chief-of-staff`**:
  - Recipe defining intent parsing, task decomposition, delegation coordination, operational narration, and decision surfacing.
- [ ] **`agent:director-personal`**:
  - Recipe configured for personal administration, scheduling, logistics, and document preparation.

---

### 4. Educational Extension Documentation & Templates

- [ ] **Domain Agent Templates**:
  - Provide ready-to-use example templates for common follow-on agents:
    - Health (`agent:director-health`)
    - Finance (`agent:director-finance`)
    - Home Logistics (`agent:director-home`)
    - Coding & Refactoring (`agent:coder`)
- [ ] **Delegation Recipe Guide**:
  - Step-by-step walkthrough showing how editing `.vibekit/project.yaml` immediately extends the Chief of Staff's capabilities.

---

## 🗓️ Phased Implementation Plan

| Phase | Milestone | Deliverables |
| :--- | :--- | :--- |
| **Phase 1: Starter Contract & Recipes** | Scaffold `.vibekit/project.yaml`, Chief of Staff, and Personal Director | Project configuration, agent recipes, terminal interface binding |
| **Phase 2: Slack Interface Package** | Build `@useagentsio/interface-slack` | Socket Mode transport, Block Kit streaming, `/chief` commands, approval decision cards |
| **Phase 3: Scoped Memory & Scheduling** | Implement Memory and Scheduler tools | Scoped memory persistence, recurrence rules, automated task triggers |
| **Phase 4: Expansion Guides & Templates** | Add follow-on templates | Step-by-step documentation and recipes for Health, Finance, and Coder agents |
