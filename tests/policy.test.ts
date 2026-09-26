import { describe, expect, it } from "vitest";
import { evaluateActionPolicy } from "../src/policy/action-policy.js";

describe("Deterministic Action Policy Engine", () => {
  it("READ_ONLY -> ALLOW", () => {
    const res = evaluateActionPolicy({
      id: "act-read",
      description: "Inspect pod health",
      category: "READ_ONLY",
    });
    expect(res.decision).toBe("ALLOW");
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it("SANDBOX_ONLY -> ALLOW at policy level", () => {
    const res = evaluateActionPolicy({
      id: "act-sandbox",
      description: "Run sandbox test suite",
      category: "SANDBOX_ONLY",
    });
    expect(res.decision).toBe("ALLOW");
    expect(res.reasons.some((r) => r.includes("isolated execution"))).toBe(true);
  });

  it("REVERSIBLE_EXTERNAL -> REQUIRE_APPROVAL", () => {
    const res = evaluateActionPolicy({
      id: "act-rev",
      description: "Drain traffic from instance",
      category: "REVERSIBLE_EXTERNAL",
      externalSystem: "aws-elb",
      mutatesExternalState: true,
      reversible: true,
    });
    expect(res.decision).toBe("REQUIRE_APPROVAL");
    expect(res.reasons.some((r) => r.includes("require human authorization"))).toBe(true);
  });

  it("CONSEQUENTIAL -> REQUIRE_APPROVAL", () => {
    const res = evaluateActionPolicy({
      id: "act-conseq",
      description: "Deploy updated container image",
      category: "CONSEQUENTIAL",
      externalSystem: "k8s-cluster",
      mutatesExternalState: true,
      destructive: false,
    });
    expect(res.decision).toBe("REQUIRE_APPROVAL");
    expect(res.reasons.some((r) => r.includes("require human authorization"))).toBe(true);
  });

  it("FORBIDDEN -> BLOCK", () => {
    const res = evaluateActionPolicy({
      id: "act-forbid",
      description: "Purge production S3 bucket",
      category: "FORBIDDEN",
      destructive: true,
    });
    expect(res.decision).toBe("BLOCK");
    expect(res.reasons.some((r) => r.includes("FORBIDDEN"))).toBe(true);
  });

  it("secret exposure requested -> BLOCK override", () => {
    const res = evaluateActionPolicy({
      id: "act-leak",
      description: "Print database password in logs",
      category: "READ_ONLY",
      requestsSecretExposure: true,
    });
    expect(res.decision).toBe("BLOCK");
    expect(res.reasons.some((r) => r.includes("secret"))).toBe(true);
  });

  it("unknown resource scope -> BLOCK override", () => {
    const res = evaluateActionPolicy({
      id: "act-unknown",
      description: "Run script across all clusters",
      category: "SANDBOX_ONLY",
      unknownScope: true,
    });
    expect(res.decision).toBe("BLOCK");
    expect(res.reasons.some((r) => r.includes("unknown resource scope"))).toBe(true);
  });

  it("multiple override violations are all reported in reasons", () => {
    const res = evaluateActionPolicy({
      id: "act-multi-bad",
      description: "Multiple violations",
      category: "FORBIDDEN",
      requestsSecretExposure: true,
      unknownScope: true,
    });
    expect(res.decision).toBe("BLOCK");
    expect(res.reasons.length).toBe(3);
  });
});
