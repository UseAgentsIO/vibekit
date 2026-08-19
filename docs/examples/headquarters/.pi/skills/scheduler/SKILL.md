---
name: scheduler
description: Write self-contained scheduled Task objectives, pin a delivery Interface, use [SILENT] for healthy watchdogs, and never recurse into the job table. A Skill does not grant authority.
---

# Scheduler

Use this Skill only as a procedure. It does not grant `tool:scheduler` or `interface:schedule`, and it does not authorize job-table mutations.

## Before creating a job

1. Confirm `interface:schedule` is installed and the Host is the ticker. If the Interface is absent, stop.
2. Confirm `tool:scheduler` is bound when this session is allowed to mutate jobs. Scheduled Worker Runs must not create or edit jobs when `policy:schedule-no-recurse` is bound.
3. Fail closed when a required secret reference or delivery Interface is unbound. Do not spend a Run on a blocked job.

## Write a self-contained Task

- Each fire starts a **fresh Worker Run**. Do not assume conversation memory unless the Task text says so.
- Put the full objective, acceptance criteria, inputs, and stop conditions in the Task. A later fire must be able to run with only that document.
- Name the Agent binding the job should use. Do not rely on "whoever is talking now".

## Pin delivery

- Declare the outbound Interface on the job (for example terminal, Slack, Telegram, or HTTP).
- Do not leave delivery implicit. An unbound delivery Interface is a failed job, not a guess.
- Keep the delivery target stable across fires so operators can find the output.

## Watchdogs and `[SILENT]`

- For healthy watchdogs that have nothing to report, begin the Result with `[SILENT]` or produce empty stdout so the Interface sends nothing outbound.
- Report only on failure, drift, or an actionable finding.
- Do not notify on every successful poll.

## Do not recurse

- A scheduled Worker Run must not create, edit, pause, resume, run, or remove jobs.
- Do not call `tool:scheduler` from a cron session to schedule follow-up work. Write a one-shot or interval job up front instead.
- If the Task discovers it needs a different cadence, record that on the Result and let an operator or an interactive session change the table.

## Finish

- Record the job id, cadence, timezone, pinned delivery Interface, and whether the fire was silent.
- A completed scheduled Run is not Verification and not an accepted Result.
