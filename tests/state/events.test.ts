import fs from "node:fs";
import path from "node:path";

import { formatRuntimeId } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { createRepositoryState } from "../../packages/cli/src/internal/core/state/index.js";

import { eventDoc, tempProject, UUIDS } from "./helpers.js";

describe("append-only Event log", () => {
  it("appends Events to a daily JSONL file and never rewrites prior lines", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const first = state.events.append(
      eventDoc({
        id: formatRuntimeId("event", UUIDS[7]),
        type: "task.created",
        timestamp: "2026-01-15T12:00:00.000Z",
      }),
    );
    const filePath = state.events.fileFor(first.timestamp);
    const afterFirst = fs.readFileSync(filePath, "utf8");
    expect(afterFirst).toBe(`${JSON.stringify(first)}\n`);

    const second = state.events.append(
      eventDoc({
        id: formatRuntimeId("event", UUIDS[8]),
        type: "task.claimed",
        timestamp: "2026-01-15T12:01:00.000Z",
      }),
    );
    const afterSecond = fs.readFileSync(filePath, "utf8");
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond).toBe(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    expect(afterSecond.split("\n").filter((line) => line.length > 0)).toHaveLength(2);
  });

  it("lists Events across day files and survives restart", () => {
    const root = tempProject();
    const first = createRepositoryState({ projectRoot: root });
    first.events.append(
      eventDoc({
        id: formatRuntimeId("event", UUIDS[7]),
        type: "run.started",
        timestamp: "2026-01-15T23:59:00.000Z",
      }),
    );
    first.events.append(
      eventDoc({
        id: formatRuntimeId("event", UUIDS[8]),
        type: "run.completed",
        timestamp: "2026-01-16T00:01:00.000Z",
      }),
    );
    first.close();

    const second = createRepositoryState({ projectRoot: root });
    expect(second.events.list().map((event) => event.type)).toEqual([
      "run.started",
      "run.completed",
    ]);
    expect(second.events.list({ type: "run.completed" })).toHaveLength(1);
    expect(fs.existsSync(path.join(second.paths.events, "2026-01-15.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(second.paths.events, "2026-01-16.jsonl"))).toBe(true);
  });

  it("keeps prior Event lines when the last append is truncated", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const first = state.events.append(eventDoc({ type: "task.created" }));
    const filePath = state.events.fileFor(first.timestamp);
    fs.appendFileSync(filePath, '{"schemaVersion":1,"id":"event_', "utf8");
    const listed = state.events.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(first.id);
  });
});
