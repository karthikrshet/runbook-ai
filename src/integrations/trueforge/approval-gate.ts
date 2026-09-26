import type { EvidencePackage } from "../../domain/evidence.js";
import { isVerifiedExecutionProvenance } from "../../domain/evidence.js";
import type { ProposedAction } from "../../domain/action.js";
import { evaluateActionPolicy, type PolicyEvaluationResult } from "../../policy/action-policy.js";
import type {
  TrueForgeApprovalRequest,
  TrueForgeApprovalResponse,
} from "./types.js";

/**
 * Local port for TrueForge's human-approval capability.
 *
 * A concrete adapter must be backed by a verified TrueForge approval checkpoint.
 * This interface deliberately has no SDK, HTTP, or UI assumptions.
 */
export interface HumanApprovalGateway {
  requestHumanApproval(
    request: TrueForgeApprovalRequest,
  ): Promise<TrueForgeApprovalResponse>;
}

export type ApprovalGateStatus =
  | "AUTO_ALLOWED"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED"
  | "UNAVAILABLE";

export interface EvidenceReadiness {
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export interface ApprovalGateResult {
  readonly status: ApprovalGateStatus;
  readonly policy: PolicyEvaluationResult;
  readonly evidenceReadiness: EvidenceReadiness;
  readonly approval?: TrueForgeApprovalResponse;
  readonly reasons: readonly string[];
}

function isVerifiedPassingCheck(
  check: EvidencePackage["validation"]["lint"],
): boolean {
  return Boolean(
    check?.passed && isVerifiedExecutionProvenance(check.provenance),
  );
}

function isVerifiedPassingTest(
  test: EvidencePackage["validation"]["unitTests"],
): boolean {
  return Boolean(
    test?.passed && isVerifiedExecutionProvenance(test.provenance),
  );
}

/**
 * Evaluates only facts contained in the evidence package. It does not infer
 * successful checks from model text and applies stricter requirements before
 * a consequential action can reach a human approval checkpoint.
 */
export function assessEvidenceReadiness(
  action: ProposedAction,
  evidencePackage: EvidencePackage,
): EvidenceReadiness {
  const reasons: string[] = [];

  if (evidencePackage.incidentId.trim().length === 0) {
    reasons.push("Evidence package has no incident identifier.");
  }

  if (evidencePackage.proposedAction.id !== action.id) {
    reasons.push("Evidence package does not describe the proposed action.");
  }

  if (!evidencePackage.reproduction.attempted) {
    reasons.push("Reproduction was not attempted.");
  }

  if (!evidencePackage.reproduction.reproduced) {
    reasons.push("Incident was not reproduced in a verified environment.");
  }

  const { validation } = evidencePackage;
  if (!isVerifiedPassingTest(validation.unitTests)) {
    reasons.push("Verified passing unit-test evidence is required.");
  }
  if (!isVerifiedPassingTest(validation.integrationTests)) {
    reasons.push("Verified passing integration-test evidence is required.");
  }
  if (!isVerifiedPassingCheck(validation.lint)) {
    reasons.push("Verified passing lint evidence is required.");
  }
  if (!isVerifiedPassingCheck(validation.typecheck)) {
    reasons.push("Verified passing typecheck evidence is required.");
  }
  if (!isVerifiedPassingCheck(validation.healthProbe)) {
    reasons.push("Verified passing health-probe evidence is required.");
  }

  if (!evidencePackage.rollbackPlan.available || !action.rollbackAvailable) {
    reasons.push("An available rollback plan is required.");
  }

  if (evidencePackage.unknowns.length > 0) {
    reasons.push("Evidence package contains unresolved unknowns.");
  }

  if (evidencePackage.blastRadius.unknownDependencies > 0) {
    reasons.push("Blast radius contains unknown dependencies.");
  }

  return { ready: reasons.length === 0, reasons };
}

/**
 * Enforces the deterministic RunbookAI policy before and after the TrueForge
 * approval boundary. This function never executes an external action.
 */
export async function evaluateApprovalGate(
  action: ProposedAction,
  evidencePackage: EvidencePackage,
  gateway?: HumanApprovalGateway,
): Promise<ApprovalGateResult> {
  const policy = evaluateActionPolicy(action);
  const evidenceReadiness = assessEvidenceReadiness(action, evidencePackage);

  if (policy.decision === "BLOCK") {
    return {
      status: "BLOCKED",
      policy,
      evidenceReadiness,
      reasons: policy.reasons,
    };
  }

  if (policy.decision === "ALLOW") {
    return {
      status: "AUTO_ALLOWED",
      policy,
      evidenceReadiness,
      reasons: policy.reasons,
    };
  }

  if (!evidenceReadiness.ready) {
    return {
      status: "BLOCKED",
      policy,
      evidenceReadiness,
      reasons: evidenceReadiness.reasons,
    };
  }

  if (!gateway) {
    return {
      status: "UNAVAILABLE",
      policy,
      evidenceReadiness,
      reasons: ["A verified TrueForge approval gateway is not configured."],
    };
  }

  try {
    const approval = await gateway.requestHumanApproval({
      incidentId: evidencePackage.incidentId,
      action,
      policyResult: policy,
      evidencePackage,
    });

    return approval.approved
      ? {
          status: "APPROVED",
          policy,
          evidenceReadiness,
          approval,
          reasons: ["Human approval was recorded by the configured gateway."],
        }
      : {
          status: "REJECTED",
          policy,
          evidenceReadiness,
          approval,
          reasons: [approval.rejectionReason ?? "Human approval was rejected."],
        };
  } catch {
    return {
      status: "UNAVAILABLE",
      policy,
      evidenceReadiness,
      reasons: ["The approval gateway did not return a verified response."],
    };
  }
}
