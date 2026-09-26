import { z } from "zod";
import { type ProposedAction, ProposedActionSchema } from "./action.js";

export const RiskClassSchema = z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const BlastRadiusSchema = z.object({
  externalSystemsTouched: z.array(z.string()),
  resourcesAffected: z.number().int().nonnegative(),
  customerFacing: z.boolean(),
  mutatesData: z.boolean(),
  destructive: z.boolean(),
  reversible: z.boolean(),
  rollbackAvailable: z.boolean(),
  unknownDependencies: z.number().int().nonnegative(),
  riskClass: RiskClassSchema,
});

export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

/**
 * Deterministic Blast Radius Calculator.
 *
 * Rule Precedence:
 * BLOCKED > HIGH > MEDIUM > LOW
 *
 * 1. BLOCKED when:
 *    - action is FORBIDDEN
 *    - secret exposure requested
 *    - resource scope unknown
 *
 * 2. HIGH when:
 *    - destructive
 *    - mutation without rollback (mutatesExternalState or mutatesData without rollbackAvailable)
 *    - resourcesAffected > 3
 *
 * 3. MEDIUM when:
 *    - customer-facing external mutation with rollback
 *    - consequential/reversible external operation that does not qualify as HIGH
 *
 * 4. LOW when:
 *    - read-only
 *    - sandbox-only
 *    - otherwise demonstrably low impact
 */
export function calculateBlastRadius(rawAction: ProposedAction | unknown): BlastRadius {
  const action = ProposedActionSchema.parse(rawAction);

  const externalSystemsTouched: string[] = [];
  if (action.externalSystem && action.externalSystem.trim().length > 0) {
    externalSystemsTouched.push(action.externalSystem.trim());
  }

  const isMutation = action.mutatesExternalState || action.mutatesData;

  let riskClass: RiskClass;

  // 1. BLOCKED evaluation (highest precedence)
  if (action.category === "FORBIDDEN" || action.requestsSecretExposure || action.unknownScope) {
    riskClass = "BLOCKED";
  }
  // 2. HIGH evaluation
  else if (action.destructive || (isMutation && !action.rollbackAvailable) || action.resourcesAffected > 3) {
    riskClass = "HIGH";
  }
  // 3. MEDIUM evaluation
  else if (
    (action.customerFacing && isMutation && action.rollbackAvailable) ||
    action.category === "CONSEQUENTIAL" ||
    action.category === "REVERSIBLE_EXTERNAL" ||
    (isMutation && action.rollbackAvailable)
  ) {
    riskClass = "MEDIUM";
  }
  // 4. LOW evaluation
  else {
    riskClass = "LOW";
  }

  return {
    externalSystemsTouched,
    resourcesAffected: action.resourcesAffected,
    customerFacing: action.customerFacing,
    mutatesData: action.mutatesData,
    destructive: action.destructive,
    reversible: action.reversible,
    rollbackAvailable: action.rollbackAvailable,
    unknownDependencies: action.unknownDependencies,
    riskClass,
  };
}
