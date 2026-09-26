import { describe, expect, it } from "vitest";
import {
  CheckResultSchema,
  EvidenceItemSchema,
  EvidencePackageSchema,
  isVerifiedExecutionProvenance,
  TestResultSchema,
} from "../src/domain/evidence.js";

describe("Evidence Domain and Provenance Gate", () => {
  it("accepts TOOL_DERIVED evidence", () => {
    const item = EvidenceItemSchema.parse({
      id: "ev-tool-1",
      provenance: "TOOL_DERIVED",
      description: "Log inspection returned 42 500 errors in last 15 minutes",
      data: { errorCount: 42 },
    });
    expect(item.provenance).toBe("TOOL_DERIVED");
  });

  it("accepts SANDBOX_DERIVED evidence structurally", () => {
    const item = EvidenceItemSchema.parse({
      id: "ev-sb-1",
      provenance: "SANDBOX_DERIVED",
      description: "Reproduction test in isolated sandbox threw NullPointerException",
      data: { exitCode: 1 },
    });
    expect(item.provenance).toBe("SANDBOX_DERIVED");
  });

  it("represents MODEL_HYPOTHESIS distinctly", () => {
    const item = EvidenceItemSchema.parse({
      id: "ev-hyp-1",
      provenance: "MODEL_HYPOTHESIS",
      description: "Model hypothesizes missing environment variable caused crash",
    });
    expect(item.provenance).toBe("MODEL_HYPOTHESIS");
    expect(isVerifiedExecutionProvenance(item.provenance)).toBe(false);
  });

  it("prohibits MODEL_HYPOTHESIS from masquerading as verified passing test execution", () => {
    const result = TestResultSchema.safeParse({
      testSuite: "checkout-regression-suite",
      passed: true,
      totalTests: 10,
      passedTests: 10,
      failedTests: 0,
      provenance: "MODEL_HYPOTHESIS", // INVALID: Model cannot claim tests passed!
    });
    expect(result.success).toBe(false);
  });

  it("permits SANDBOX_DERIVED or TOOL_DERIVED passing test execution", () => {
    const result = TestResultSchema.safeParse({
      testSuite: "checkout-regression-suite",
      passed: true,
      totalTests: 10,
      passedTests: 10,
      failedTests: 0,
      provenance: "SANDBOX_DERIVED",
    });
    expect(result.success).toBe(true);
  });

  it("prohibits MODEL_HYPOTHESIS from marking a check as passed", () => {
    const result = CheckResultSchema.safeParse({
      checkName: "service-health-probe",
      passed: true,
      provenance: "MODEL_HYPOTHESIS",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid evidence structure", () => {
    const result = EvidenceItemSchema.safeParse({
      id: "",
      provenance: "INVALID_PROVENANCE",
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("validates full EvidencePackage structurally", () => {
    const pkg = EvidencePackageSchema.parse({
      incidentId: "INC-001",
      problemSummary: "500 errors after deployment",
      suspectedRootCause: {
        summary: "Database connection pool exhausted",
        evidence: [
          {
            id: "ev-1",
            provenance: "TOOL_DERIVED",
            description: "Connection pool timeout logs observed",
          },
        ],
      },
      reproduction: {
        attempted: true,
        reproduced: true,
        command: "npm test",
        exitCode: 1,
        evidence: [
          {
            id: "ev-2",
            provenance: "SANDBOX_DERIVED",
            description: "Failed reproduction run in sandbox",
          },
        ],
      },
      validation: {
        typecheck: {
          checkName: "tsc",
          passed: true,
          provenance: "TOOL_DERIVED",
        },
      },
      proposedAction: {
        id: "act-pool",
        description: "Increase connection pool size in config",
        category: "REVERSIBLE_EXTERNAL",
        mutatesExternalState: true,
        rollbackAvailable: true,
      },
      blastRadius: {
        externalSystemsTouched: ["postgres"],
        resourcesAffected: 1,
        customerFacing: false,
        mutatesData: false,
        destructive: false,
        reversible: true,
        rollbackAvailable: true,
        unknownDependencies: 0,
        riskClass: "MEDIUM",
      },
      rollbackPlan: {
        available: true,
        steps: ["Revert config value to previous commit", "Redeploy"],
      },
      unknowns: ["Database memory ceiling under spike"],
    });

    expect(pkg.incidentId).toBe("INC-001");
    expect(pkg.blastRadius.riskClass).toBe("MEDIUM");
  });
});
