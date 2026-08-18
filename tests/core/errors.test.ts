import { describe, expect, it } from "vitest";

import {
  FAILURE_CATEGORIES,
  VibeKitError,
  isFailureCategory,
  redactSecrets,
} from "@useagentsio/core";

describe("VibeKitError", () => {
  it("exposes every spec §32 category", () => {
    expect(FAILURE_CATEGORIES).toEqual([
      "invalid_input",
      "permission_denied",
      "authorization_required",
      "policy_blocked",
      "dependency_missing",
      "configuration_invalid",
      "compatibility_error",
      "conflict",
      "resource_busy",
      "unavailable",
      "timed_out",
      "cancelled",
      "verification_failed",
      "external_error",
      "internal_error",
      "cleanup_failed",
    ]);
    for (const category of FAILURE_CATEGORIES) {
      expect(isFailureCategory(category)).toBe(true);
      const error = new VibeKitError({
        category,
        code: `${category}_example`,
        message: "structured failure",
      });
      expect(error.category).toBe(category);
      expect(error.code).toBe(`${category}_example`);
    }
  });

  it("does not leak secret-like values in the message", () => {
    const error = new VibeKitError({
      category: "invalid_input",
      code: "secret_in_message",
      message: "received token=sk-abcdefghijklmnopqrstuvwxyz and Bearer abc.def",
      details: { token: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
    });
    expect(error.message).not.toContain("sk-");
    expect(error.message).not.toContain("Bearer abc");
    expect(error.message).toContain("[redacted]");
    expect(String(error.details?.token)).toContain("[redacted]");
  });

  it("redacts common secret patterns", () => {
    expect(redactSecrets("OPENAI_API_KEY=sk-abcdefghijklmnopqrst")).toContain("[redacted]");
    expect(redactSecrets("password: hunter2")).toContain("[redacted]");
  });
});
