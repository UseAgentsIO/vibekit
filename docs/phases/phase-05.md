# Phase 5 — Pi runtime adapter (`@useagentsio/pi`)

**Depends on:** Phases 1–4

## Build
- Project loader
- Agent loader
- effective configuration resolver
- model resolution
- bounded context assembly
- isolated Pi Run
- result collection
- Run Events
- cancellation
- environment filtering

## Exit criteria
- an Agent can execute one Task
- the Agent receives only authorized context
- missing configuration fails closed
- cancellation stops the Run
- temporary resources are cleaned

## Boundary
Pi owns the loop. VibeKit owns contracts around it. Compose Skill→Pi Skill, Tool→Pi extension, Provider→Pi provider config. Do not fork Pi.

Target current Pi package: `@earendil-works/pi-coding-agent`.
