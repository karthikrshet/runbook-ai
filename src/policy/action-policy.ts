import { z } from "zod";
import { type ProposedAction, ProposedActionSchema } from "../domain/action.js";

export const PolicyDecisionSchema = z.enum(["ALLOW", "REQUIRE_APPROVAL", "BLOCK"]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyEvaluationResultSchema = z.object({
  decision: PolicyDecisionSchema,
  reasons: z.array(z.string().min(1)),
});

export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

/**
 * Deterministic policy evaluator.
 * Core principle: "The model proposes. Policy authorizes."
 *
 * Rules:
 * - Overrides (requestsSecretExposure, unknownScope, FORBIDDEN) => BLOCK
 * - READ_ONLY => ALLOW
 * - SANDBOX_ONLY => ALLOW (at policy level; does not attest that sandbox execution is verified)
 * - REVERSIBLE_EXTERNAL => REQUIRE_APPROVAL
 * - CONSEQUENTIAL => REQUIRE_APPROVAL
 */
export function evaluateActionPolicy(rawAction: ProposedAction | unknown): PolicyEvaluationResult {
  const action = ProposedActionSchema.parse(rawAction);
  const blockReasons: string[] = [];

  // Overrides take highest precedence
  if (action.requestsSecretExposure) {
    blockReasons.push("Action requests secret or credential exposure.");
  }

  if (action.unknownScope) {
    blockReasons.push("Action has unknown resource scope.");
  }

  if (action.category === "FORBIDDEN") {
    blockReasons.push("Action is classified as FORBIDDEN.");
  }

  if (blockReasons.length > 0) {
    return {
      decision: "BLOCK",
      reasons: blockReasons,
    };
  }

  switch (action.category) {
    case "READ_ONLY":
      return {
        decision: "ALLOW",
        reasons: ["Read-only actions are permitted without human approval."],
      };

    case "SANDBOX_ONLY":
      return {
        decision: "ALLOW",
        reasons: [
          "Sandbox-only operations are authorized by policy for isolated execution.",
          "Note: Policy authorization does not attest that the sandbox environment is verified or available.",
        ],
      };

    case "REVERSIBLE_EXTERNAL": {
      const reasons: string[] = [];
      if (action.mutatesExternalState) {
        reasons.push("Action mutates an external system.");
      }
      reasons.push("Reversible external actions require human authorization.");
      return {
        decision: "REQUIRE_APPROVAL",
        reasons,
      };
    }

    case "CONSEQUENTIAL": {
      const reasons: string[] = [];
      if (action.mutatesExternalState) {
        reasons.push("Action mutates an external system.");
      }
      if (action.destructive) {
        reasons.push("Action is marked as destructive.");
      }
      reasons.push("Consequential external actions require human authorization.");
      return {
        decision: "REQUIRE_APPROVAL",
        reasons,
      };
    }

    case "FORBIDDEN":
      return {
        decision: "BLOCK",
        reasons: ["Action is classified as FORBIDDEN."],
      };

    default: {
      const _exhaustiveCheck: never = action.category;
      return {
        decision: "BLOCK",
        reasons: [`Unrecognized action category: ${_exhaustiveCheck}`],
      };
    }
  }
}
