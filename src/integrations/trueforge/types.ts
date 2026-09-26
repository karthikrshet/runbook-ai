/**
 * Interface boundaries for future TrueForge integration.
 *
 * NOTE: These are strictly boundary type definitions.
 * Real integration with TrueForge will occur in a later phase.
 * No fake implementations, mock functions, or invented SDK calls are provided here.
 *
 * Responsibility split:
 * TrueForge:
 * - agent execution loop
 * - model interaction
 * - MCP tool invocations
 * - Daytona / sandbox execution
 * - human approval workflows
 * - session / state management
 *
 * RunbookAI Local Core:
 * - operational domain models
 * - deterministic action policy
 * - evidence gating and provenance verification
 * - blast-radius calculation
 * - runbook compilation and semantics
 * - audit timeline models
 */

import type { ProposedAction } from "../../domain/action.js";
import type { PolicyEvaluationResult } from "../../policy/action-policy.js";
import type { EvidencePackage } from "../../domain/evidence.js";

export type IntegrationStatus = "NOT_STARTED" | "NOT_VERIFIED" | "BLOCKED" | "VERIFIED";

export interface TrueForgeIntegrationBoundary {
  readonly modelStatus: IntegrationStatus;
  readonly sandboxStatus: IntegrationStatus;
  readonly approvalStatus: IntegrationStatus;
  readonly mcpStatus: IntegrationStatus;
}

export interface TrueForgeApprovalRequest {
  readonly incidentId: string;
  readonly action: ProposedAction;
  readonly policyResult: PolicyEvaluationResult;
  readonly evidencePackage: EvidencePackage;
}

export interface TrueForgeApprovalResponse {
  readonly approved: boolean;
  readonly approver?: string | undefined;
  readonly timestamp: string;
  readonly rejectionReason?: string | undefined;
}
