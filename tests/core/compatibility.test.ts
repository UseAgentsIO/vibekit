import { describe, expect, it } from "vitest";

import { satisfiesCompatibility } from "@useagentsio/core";

describe("compatibility ranges", () => {
  it("matches declared VibeKit, Pi, and Node ranges", () => {
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0", pi: ">=0.50.0", node: ">=20" },
        { vibekit: "1.2.0", pi: "0.51.0", node: "20.11.0" },
      ),
    ).toBe(true);
  });

  it("accepts a v-prefixed Node version against >=20", () => {
    expect(
      satisfiesCompatibility(
        { vibekit: ">=1.0.0", node: ">=20" },
        { vibekit: "1.0.0", node: "v22.1.0" },
      ),
    ).toBe(true);
  });

  it("treats a non-range Pi declaration as an exact string", () => {
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0", pi: "pi-custom-build" },
        { vibekit: "1.0.1", pi: "pi-custom-build" },
      ),
    ).toBe(true);
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0", pi: "pi-custom-build" },
        { vibekit: "1.0.1", pi: "0.50.0" },
      ),
    ).toBe(false);
  });

  it("rejects range mismatches and missing actual versions", () => {
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0" },
        { vibekit: "2.0.0" },
      ),
    ).toBe(false);
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0", node: ">=20" },
        { vibekit: "1.0.0" },
      ),
    ).toBe(false);
    expect(
      satisfiesCompatibility(
        { vibekit: "^1.0.0", pi: ">=0.50.0" },
        { vibekit: "1.0.0", pi: "0.40.0" },
      ),
    ).toBe(false);
  });
});
