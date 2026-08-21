import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  persistDoctorReport,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
  type DoctorReport,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { makeTempDir } from "../helpers.js";

describe("Doctor safe repair boundary", () => {
  it("repairs only generated runtime paths, derived configuration, and owner-only modes", () => {
    const dir = makeTempDir("vibekit-doctor-fix-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));
    writeInstalledManifest(dir, emptyInstalledManifest());

    const before = runDoctor({ projectRoot: dir, diagnostics: true, persistReport: false });
    expect(before.findings.some((finding) => finding.code === "generated_directory_missing")).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/runtime/generated"))).toBe(false);

    fs.mkdirSync(path.join(dir, ".vibekit/runtime/generated"), { recursive: true });
    fs.chmodSync(path.join(dir, ".vibekit/runtime/generated"), 0o755);
    fs.writeFileSync(path.join(dir, ".vibekit/runtime/generated/local.txt"), "local\n", { mode: 0o644 });

    const fixed = runDoctor({ projectRoot: dir, fix: true, persistReport: false });
    expect(fixed.findings.some((finding) => finding.code === "generated_directory_missing")).toBe(false);
    expect(fixed.findings.some((finding) => finding.code === "derived_configuration_stale")).toBe(false);
    expect((fs.statSync(path.join(dir, ".vibekit/runtime/generated")).mode & 0o777)).toBe(0o700);
    expect((fs.statSync(path.join(dir, ".vibekit/runtime/generated/local.txt")).mode & 0o777)).toBe(0o600);
    expect(fixed.repairs?.some((repair) => repair.kind === "owner-only-mode" && repair.status === "applied")).toBe(true);
  });

  it("removes dead and expired runtime locks but refuses malformed or active locks", () => {
    const dir = makeTempDir("vibekit-doctor-locks-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const locks = path.join(dir, ".vibekit/runtime/locks");
    fs.mkdirSync(locks, { recursive: true });
    const hostLock = path.join(dir, ".vibekit/runtime/host.lock");
    fs.writeFileSync(hostLock, "2147483647\n");
    fs.writeFileSync(
      path.join(locks, "expired.lock"),
      JSON.stringify({ name: "test", owner: "test", acquiredAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:00:01.000Z", leaseMs: 1 }),
    );
    fs.writeFileSync(path.join(locks, "malformed.lock"), "not json\n");

    const fixed = runDoctor({
      projectRoot: dir,
      fix: true,
      persistReport: false,
      now: () => new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(fs.existsSync(hostLock)).toBe(false);
    expect(fs.existsSync(path.join(locks, "expired.lock"))).toBe(false);
    expect(fs.existsSync(path.join(locks, "malformed.lock"))).toBe(true);
    expect(fixed.findings.some((finding) => finding.code === "state_lock_corrupt")).toBe(true);
    expect(fixed.repairs?.some((repair) => repair.path.endsWith("malformed.lock") && repair.status === "refused")).toBe(true);
  });

  it("fails closed when a runtime-owned path escapes through a symlink", () => {
    const dir = makeTempDir("vibekit-doctor-symlink-");
    const outside = makeTempDir("vibekit-doctor-outside-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    fs.mkdirSync(path.join(dir, ".vibekit"), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, ".vibekit/runtime"), "dir");

    const fixed = runDoctor({ projectRoot: dir, fix: true, persistReport: false });

    expect(fixed.findings.some((finding) => finding.code === "runtime_path_unsafe" && finding.severity === "error")).toBe(true);
    expect(fixed.repairs?.some((repair) => repair.status === "refused")).toBe(true);
    expect(fs.existsSync(path.join(outside, "generated"))).toBe(false);
  });

  it("persists redacted report data without secret values", () => {
    const dir = makeTempDir("vibekit-doctor-report-");
    const report: DoctorReport = {
      findings: [
        {
          severity: "error",
          code: "provider_rejected",
          message: "provider returned api_key=sk-or-v1-very-secret-value",
          recommendedAction: "Replace the credential",
        },
      ],
      errorCount: 1,
      warningCount: 0,
      checkedPaths: [".vibekit/project.yaml", "../../../Users/sethrose/private/registry/index.json"],
      versions: { vibekit: "1.2.1" },
    };
    const reportPath = persistDoctorReport(dir, report);
    expect(reportPath).toBe(".vibekit/runtime/diagnostics/doctor.json");
    const stored = fs.readFileSync(path.join(dir, reportPath!), "utf8");
    expect(stored).not.toContain("very-secret-value");
    expect(stored).not.toContain("Users/sethrose");
    expect(stored).toContain("[external]/index.json");
    expect(stored).toContain("[redacted]");
  });
});
