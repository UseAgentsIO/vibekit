import { describe, expect, it } from "vitest";

import {
  VibeKitError,
  assertTransition,
  canTransition,
} from "@vibekit/core";

describe("lifecycle transitions", () => {
  it("allows documented task transitions", () => {
    expect(() => assertTransition("task", "open", "claimed")).not.toThrow();
    expect(() => assertTransition("task", "claimed", "open")).not.toThrow();
    expect(() => assertTransition("task", "running", "review")).not.toThrow();
    expect(() => assertTransition("task", "blocked", "running")).not.toThrow();
    expect(() => assertTransition("task", "review", "accepted")).not.toThrow();
  });

  it("allows documented run, decision, approval, and verification transitions", () => {
    expect(() => assertTransition("run", "created", "ready")).not.toThrow();
    expect(() => assertTransition("run", "running", "waiting")).not.toThrow();
    expect(() => assertTransition("run", "waiting", "running")).not.toThrow();
    expect(() => assertTransition("decision", "proposed", "accepted")).not.toThrow();
    expect(() => assertTransition("decision", "accepted", "superseded")).not.toThrow();
    expect(() => assertTransition("approval", "pending", "approved")).not.toThrow();
    expect(() => assertTransition("verification", "pending", "passed")).not.toThrow();
  });

  it("rejects same-state transitions", () => {
    expect(canTransition("task", "open", "open")).toBe(false);
    expect(() => assertTransition("task", "open", "open")).toThrow(VibeKitError);
  });

  it("rejects unknown transitions and fails closed", () => {
    expect(canTransition("task", "accepted", "open")).toBe(false);
    expect(() => assertTransition("task", "accepted", "open")).toThrow(VibeKitError);
    expect(() => assertTransition("run", "completed", "running")).toThrow(VibeKitError);
    expect(() => assertTransition("approval", "approved", "pending")).toThrow(VibeKitError);
    expect(() => assertTransition("verification", "passed", "failed")).toThrow(VibeKitError);
    expect(() => assertTransition("decision", "superseded", "accepted")).toThrow(VibeKitError);
  });

  it("rejects unknown states", () => {
    expect(() => assertTransition("task", "queued", "open")).toThrow(VibeKitError);
    try {
      assertTransition("run", "running", "succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("invalid_input");
      expect((error as VibeKitError).code).toBe("lifecycle_state_unknown");
    }
  });

  it("treats decision superseded as the only terminal exception", () => {
    expect(canTransition("decision", "rejected", "superseded")).toBe(true);
    expect(canTransition("decision", "disputed", "superseded")).toBe(true);
    expect(canTransition("task", "failed", "superseded")).toBe(false);
  });
});
