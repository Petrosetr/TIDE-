import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = readFileSync(path.join(HERE, "onchain_mvp_proof_pack.md"), "utf8");

describe("onchain_mvp_proof_pack.md — HTTP security headers disclosure", () => {
  it("ships the explicit '## HTTP security headers — S0 host state' section", () => {
    expect(text).toMatch(/^## HTTP security headers — S0 host state$/m);
  });

  it("references the smoke verifier", () => {
    expect(text).toContain("npm run verify:security-headers");
  });

  it("references the post-deploy gate env flag", () => {
    expect(text).toContain("TIDE_VERIFY_SECURITY_HEADERS_REQUIRED");
    expect(text).toMatch(/after every\s+manual host config change/i);
  });

  it("acknowledges the current S0 reality (deployed headers verified, infra-as-code still pending)", () => {
    expect(text).toMatch(/return\s+the expected HTTP security headers/i);
    expect(text).toMatch(/Move nginx config fully into infra-as-code/i);
  });
});

describe("onchain_mvp_proof_pack.md — Cap posture disclosure", () => {
  it("ships the explicit 'Cap posture — S0 testnet' section", () => {
    expect(text).toMatch(/^## Cap posture — S0 testnet$/m);
  });

  it("references the env-override flag the verifier reads", () => {
    expect(text).toContain("TIDE_VERIFY_ALLOW_CAP_COLOCATION=1");
  });

  it("acknowledges the hardened state the verifier prefers (cap separation)", () => {
    expect(text).toMatch(/F-C-CK-1/);
    expect(text).toMatch(/two caps to live on different addresses/i);
  });

  it("acknowledges the older cap-separation baseline (softer than verifier)", () => {
    expect(text).toMatch(/older cap-separation baseline/);
  });

  it("commits to a hardened-rotation milestone (not just informational)", () => {
    expect(text).toMatch(/cap rotation/i);
  });

  it("links to the public cap-placement attestation source-of-truth", () => {
    expect(text).toContain("docs/proof/cap-placement-attestation.md");
  });
});
