import { describe, expect, it } from "vitest";
import {
  CLAIMS as PACKAGE_CLAIMS,
  COPY_LINT_VERSION,
  runCli,
  scanContent as packageScanContent,
  walkFilePaths,
} from "./index.mjs";
import {
  CLAIMS as REPO_CLAIMS,
  scanContent as repoScanContent,
} from "../../scripts/lint-regulatory-copy.mjs";

describe("@tide/copy-lint — canon alignment", () => {
  it("keeps claim ids aligned with the in-repo regulatory copy lint", () => {
    expect(PACKAGE_CLAIMS.map((claim) => claim.id)).toEqual(REPO_CLAIMS.map((claim) => claim.id));
    expect(PACKAGE_CLAIMS.map((claim) => claim.id)).toEqual([
      "bare-autopilot",
      "yield-or-investment-product",
      "guaranteed-return",
      "mainnet-capital-managed",
      "auto-repay-executed",
      "liquidation-avoided",
      "audited-live-autopilot",
      "advisor-recommendation-language",
    ]);
  });

  it("matches in-repo findings for representative public copy", () => {
    const copy = [
      "TIDE Autopilot manages your BTC.",
      "TIDE is not a yield product.",
      "Live Autopilot is gated behind audit and testnet rehearsals.",
      "Auto-repay executed during the run.",
      "TIDE recommends rotating exposure.",
    ].join("\n");

    expect(packageScanContent(copy, "fixture.md")).toEqual(repoScanContent(copy, "fixture.md"));
  });

  it("every claim has a non-empty operator-facing message", () => {
    for (const claim of PACKAGE_CLAIMS) {
      expect(typeof claim.message).toBe("string");
      expect(claim.message.length).toBeGreaterThan(20);
    }
  });
});

describe("@tide/copy-lint — scanContent edge cases", () => {
  it("flags bare autopilot without qualifier", () => {
    const findings = packageScanContent("Our autopilot manages your BTC.");
    expect(findings.map((f) => f.id)).toContain("bare-autopilot");
  });

  it("accepts qualified autopilot", () => {
    expect(packageScanContent("Autopilot Rehearsal demo, testnet only.").map((f) => f.id))
      .not.toContain("bare-autopilot");
    expect(packageScanContent("The gated Autopilot is a future milestone.").map((f) => f.id))
      .not.toContain("bare-autopilot");
  });

  it("flags guaranteed return language and accepts nearby negation", () => {
    expect(packageScanContent("We guarantee a smooth return on every cycle.").map((f) => f.id))
      .toContain("guaranteed-return");
    expect(packageScanContent("TIDE does not guarantee any return or cashflow.").map((f) => f.id))
      .not.toContain("guaranteed-return");
  });

  it("keeps absolute execution and liquidation claims strict", () => {
    expect(packageScanContent("TIDE never automatically repays — wallet signs each action.").map((f) => f.id))
      .toContain("auto-repay-executed");
    expect(packageScanContent("TIDE does not prevent liquidation.").map((f) => f.id))
      .toContain("liquidation-avoided");
  });

  it("returns line + column + excerpt for every finding", () => {
    const text = "Header line.\nLine two with Autopilot here.";
    const findings = packageScanContent(text, "fixture.md");
    const f = findings.find((x) => x.id === "bare-autopilot");
    expect(f.file).toBe("fixture.md");
    expect(f.line).toBe(2);
    expect(f.column).toBeGreaterThan(0);
    expect(f.excerpt.toLowerCase()).toContain("autopilot");
  });

  it("returns no findings for canon-clean copy", () => {
    const clean =
      "TIDE is a policy cockpit. Autopilot Rehearsal runs on testnet only. " +
      "The user wallet signs every action.";
    expect(packageScanContent(clean)).toEqual([]);
  });
});

describe("@tide/copy-lint — runCli surface", () => {
  function captureIo() {
    const stdoutChunks = [];
    const stderrChunks = [];
    let exitCode = null;
    return {
      stdout: (s) => stdoutChunks.push(s),
      stderr: (s) => stderrChunks.push(s),
      exit: (code) => { exitCode = code; },
      get stdoutText() { return stdoutChunks.join("\n"); },
      get stderrText() { return stderrChunks.join("\n"); },
      get exitCode() { return exitCode; },
    };
  }

  it("usage-errors when no inputs supplied", () => {
    const io = captureIo();
    runCli([], { stdout: io.stdout, stderr: io.stderr, exit: io.exit });
    expect(io.exitCode).toBe(2);
    expect(io.stderrText).toContain("no input paths supplied");
  });
});

describe("@tide/copy-lint — package utilities", () => {
  it("declares a semver package version", () => {
    expect(COPY_LINT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("does not blow up on a non-existent path", () => {
    expect(walkFilePaths("/nonexistent-path-just-for-test", "/tmp")).toEqual([]);
  });
});
