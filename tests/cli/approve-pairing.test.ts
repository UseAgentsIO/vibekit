import { issuePairingCode, listPairings } from "@useagentsio/interface-telegram";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir } from "../helpers.js";

describe("approve-pairing", () => {
  it("approves a pending Telegram pairing code", async () => {
    const dir = makeTempDir("vibekit-pairing-");
    const pending = issuePairingCode(dir, "42", "Ada");
    const result = await runCli(["approve-pairing", pending.code, "--dir", dir]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Paired Telegram user 42/);
    expect(result.stdout).toContain("Owner identity: Ada.");
    expect(listPairings(dir).paired.map((entry) => entry.userId)).toEqual(["42"]);
  });

  it("rejects an unknown code", async () => {
    const dir = makeTempDir("vibekit-pairing-miss-");
    const result = await runCli(["approve-pairing", "NOTACODE", "--dir", dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unknown pairing code|pairing_failed/);
  });
});
