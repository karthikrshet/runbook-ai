import { describe, expect, it, vi } from "vitest";
import type { EvidencePackage, ProposedAction } from "../src/index.js";
import {
  assessEvidenceReadiness,
  evaluateApprovalGate,
  type HumanApprovalGateway,
} from "../src/integrations/trueforge/approval-gate.js";

const consequentialAction: ProposedAction = {
  id: "create-remediation-pr",
  description: "Create a remediation pull request in the dedicated demo repository.",
  category: "CONSEQUENTIAL",
  externalSystem: "github",
  mutatesExternalState: true,
  mutatesData: false,
  destructive: false,
  reversible: true,
  rollbackAvailable: true,
  resourcesAffected: 1,
  customerFacing: false,
  unknownScope: false,
  unknownDependencies: 0,
  requestsSecretExposure: false,
};

function verifiedEvidence(): EvidencePackage {
  return {
    incidentId: "INC-001",
    problemSummary: "Checkout API returns 500 after the latest release.",
    suspectedRootCause: {
      summary: "A recent checkout validation regression is suspected.",
      evidence: [{
        id: "github-commit",
        provenance: "TOOL_DERIVED",
        description: "A recent demo-repository commit changed checkout validation.",
      }],
    },
    reproduction: {
      attempted: true,
      reproduced: true,
      command: "npm test -- checkout",
      exitCode: 1,
      evidence: [{
        id: "sandbox-reproduction",
        provenance: "SANDBOX_DERIVED",
        description: "Sandbox test reproduced the controlled checkout regression.",
      }],
    },
    validation: {
      unitTests: {
        testSuite: "unit",
        passed: true,
        totalTests: 12,
        passedTests: 12,
        failedTests: 0,
        provenance: "SANDBOX_DERIVED",
      },
      integrationTests: {
        testSuite: "integration",
        passed: true,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        provenance: "SANDBOX_DERIVED",
      },
      lint: { checkName: "lint", passed: true, provenance: "SANDBOX_DERIVED" },
      typecheck: { checkName: "typecheck", passed: true, provenance: "SANDBOX_DERIVED" },
      healthProbe: { checkName: "health", passed: true, provenance: "TOOL_DERIVED" },
    },
    proposedAction: consequentialAction,
    blastRadius: {
      externalSystemsTouched: ["github"],
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
      steps: ["Close the demo pull request or revert its merge commit."],
    },
    unknowns: [],
  };
}

describe("TrueForge approval boundary", () => {
  it("does not call a gateway until deterministic evidence requirements are met", async () => {
    const evidence = verifiedEvidence();
    evidence.validation.unitTests = {
      testSuite: "unit",
      passed: true,
      provenance: "MODEL_HYPOTHESIS",
    };

    const gateway: HumanApprovalGateway = {
      requestHumanApproval: vi.fn(),
    };

    const result = await evaluateApprovalGate(consequentialAction, evidence, gateway);

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("Verified passing unit-test evidence is required.");
    expect(gateway.requestHumanApproval).not.toHaveBeenCalled();
  });

  it("fails closed when a consequential action has no configured approval gateway", async () => {
    const result = await evaluateApprovalGate(consequentialAction, verifiedEvidence());

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reasons).toContain("A verified TrueForge approval gateway is not configured.");
  });

  it("passes the complete evidence package to the injected approval gateway", async () => {
    const gateway: HumanApprovalGateway = {
      requestHumanApproval: vi.fn().mockResolvedValue({
        approved: true,
        approver: "demo-operator",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    };
    const evidence = verifiedEvidence();

    const result = await evaluateApprovalGate(consequentialAction, evidence, gateway);

    expect(result.status).toBe("APPROVED");
    expect(gateway.requestHumanApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: "INC-001",
        action: consequentialAction,
        evidencePackage: evidence,
      }),
    );
  });

  it("never sends a forbidden action to an approval gateway", async () => {
    const forbiddenAction: ProposedAction = {
      ...consequentialAction,
      id: "expose-secret",
      category: "FORBIDDEN",
      requestsSecretExposure: true,
    };
    const evidence = verifiedEvidence();
    evidence.proposedAction = forbiddenAction;

    const gateway: HumanApprovalGateway = {
      requestHumanApproval: vi.fn(),
    };
    const result = await evaluateApprovalGate(forbiddenAction, evidence, gateway);

    expect(result.status).toBe("BLOCKED");
    expect(gateway.requestHumanApproval).not.toHaveBeenCalled();
  });

  it("reports each missing consequential-action requirement deterministically", () => {
    const evidence = verifiedEvidence();
    evidence.reproduction.reproduced = false;
    evidence.unknowns.push("Dependency ownership is not known.");

    const result = assessEvidenceReadiness(consequentialAction, evidence);

    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("Incident was not reproduced in a verified environment.");
    expect(result.reasons).toContain("Evidence package contains unresolved unknowns.");
  });
});
