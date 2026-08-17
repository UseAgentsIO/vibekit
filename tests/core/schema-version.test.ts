import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  VibeKitError,
  assertSchemaVersion,
} from "@vibekit/core";

describe("schemaVersion", () => {
  it("accepts the current integer version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(() => assertSchemaVersion(1)).not.toThrow();
  });

  it("rejects a missing value", () => {
    expect(() => assertSchemaVersion(undefined)).toThrow(VibeKitError);
    try {
      assertSchemaVersion(undefined);
    } catch (error) {
      expect((error as VibeKitError).code).toBe("schema_version_missing");
      expect((error as VibeKitError).category).toBe("invalid_input");
    }
  });

  it("rejects a non-integer value", () => {
    expect(() => assertSchemaVersion("1")).toThrow(VibeKitError);
    expect(() => assertSchemaVersion(1.5)).toThrow(VibeKitError);
  });

  it("rejects an unsupported version", () => {
    try {
      assertSchemaVersion(2);
      throw new Error("expected assertSchemaVersion to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("compatibility_error");
      expect((error as VibeKitError).code).toBe("schema_version_unsupported");
    }
  });
});
