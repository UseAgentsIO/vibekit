# Local Gateway Specification

**Status:** Normative V1 correction  
**Scope:** Machine-local Project discovery, health metadata and lifecycle control

This specification narrowly supersedes the “cross-Project portfolio runtime” non-goal in `V1-Implementation-Specification.md`. VibeKit MAY provide one local Gateway that lists independent Projects and starts or stops their independent Host processes. The Gateway is not a Host, does not route messages and never loads or combines Project conversations, sessions, State, secrets, Agent instructions or tool context.

## 1. Isolation boundary

One Project Host remains the execution and isolation boundary. Projects MAY use different Agents, instructions, providers, models, Interfaces, permissions and State layouts while running concurrently. The Gateway reads only Project configuration and Host health metadata needed for its lifecycle dashboard.

`project.id` is the machine-wide VibeKit identity because the deployment secret store is Project-ID scoped. Before a command starts a Host or accesses that store, the CLI MUST establish that no other registered path owns the same ID. Existing duplicate IDs MUST be renamed before both Projects can run.

## 2. Project registry

The registry is `~/.config/vibekit/projects.json`, mode `0600`, with this shape:

```json
{
  "schemaVersion": 1,
  "projects": [
    {
      "projectId": "project:example",
      "path": "/canonical/absolute/path",
      "registeredAt": "2026-08-20T00:00:00.000Z"
    }
  ]
}
```

Writes MUST use atomic replacement. Paths MUST be canonicalized with `realpath`; duplicate paths and IDs are invalid. Missing paths remain registered and appear as `missing`. Relocation is allowed only when the old path is missing and the new path contains the same Project ID. Unregistering removes only the registry entry, refuses while its Host runs and never deletes Project files, State, sessions or secrets.

Successful `create` and `init` commands register their Project. Existing Projects register lazily when `start`, `msg` or `model` first needs the machine-wide identity guard.

## 3. Gateway process and services

The Gateway serves its API and embedded dashboard from one Node process bound only to `127.0.0.1`, using port `9467` unless `VIBEKIT_GATEWAY_PORT`, `--port`, or a persisted value under `~/.config/vibekit/gateway/` selects another port.

`vibekit gateway install` is the only command that installs a login service. Package installation MUST NOT mutate system services. Supported service definitions are:

- macOS LaunchAgent with `RunAtLoad` and restart after unsuccessful exit.
- Linux and WSL2 systemd user service with `Restart=on-failure`.
- Native Windows per-user Task Scheduler task with a login trigger and bounded failure restart.

Restarting, stopping or uninstalling the Gateway MUST NOT stop Project Hosts. Project Hosts never auto-restart. `Start All` attempts every valid stopped Project. `Stop All` requires both user confirmation and `{ "confirm": true }` at the API boundary, and bulk actions preserve one result per Project so partial failures remain visible.

Hosts launched by the Gateway MUST receive only the operating-system environment needed to execute; provider and Interface credentials MUST come from that Project's deployment secret store. Missing required credentials fail that Project's start without blocking unrelated Projects.

## 4. Local API and dashboard

The Gateway exposes:

- `GET /api/projects`
- `POST /api/projects`
- `DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/start|stop|restart|open`
- `POST /api/projects/start-all|stop-all`
- `POST /api/projects/:projectId/locate`
- `GET /api/projects/:projectId/logs`

The dashboard polls every two seconds and presents Project identity, location, lifecycle, PID, start time, Agent bindings, provider/model, Interface health, active conversations, queued turns and the last fatal error. It MAY add existing Projects and control lifecycle, but MUST NOT create Projects or edit Project configuration.

Mutation requests require a random owner-only token stored under `~/.config/vibekit/gateway/` with mode `0600` and sent in `X-VibeKit-Token`. The page receives the token in its HTML, never in a URL. The server MUST reject non-loopback `Host` and `Origin` values and MUST NOT emit permissive CORS headers.

Log access is fixed to the registered Project’s `.vibekit/runtime/host.log`, redacts likely secrets and returns at most 200 lines or 256 KiB. The API MUST NOT expose deployment secrets, environment values, conversation State or caller-selected file paths.

## 5. Explicit non-goals

This correction does not authorize a hosted or remote control plane, cross-machine execution, conversation aggregation, a unified inbox, message composition, configuration editing, automatic Project discovery, Project creation, telemetry, a graphical workflow builder or a new Module or Agent taxonomy.
