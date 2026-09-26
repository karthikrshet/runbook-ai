import { z } from 'zod';
import { ActionClassSchema } from './action.js';
import { BlastRadiusSchema } from './blast-radius.js';

/**
 * Points at the TrueForge tool call whose recorded result backs a claim.
 * `exitCode` is the exit code the claim relies on; readers can check it
 * against TrueForge's own event log instead of trusting the claim.
 */
export const EvidenceSourceSchema = z.object({
  toolCallId: z.string().min(1).max(128),
  exitCode: z.number().int().optional(),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const CheckResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'not_run']),
  summary: z.string().max(300).optional(),
  source: EvidenceSourceSchema.optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const TestResultSchema = CheckResultSchema.extend({
  passed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const EvidencePackageSchema = z.object({
  incidentId: z.string().min(1).max(64),
  problemSummary: z.string().max(1000),
  suspectedRootCause: z.object({
    summary: z.string().max(1000),
    evidence: z.array(z.string().max(500)).max(20),
    confidence: z.number().min(0).max(1).optional(),
  }),
  reproduction: z.object({
    attempted: z.boolean(),
    reproduced: z.boolean(),
    command: z.string().max(500).optional(),
    exitCode: z.number().int().optional(),
    source: EvidenceSourceSchema.optional(),
  }),
  remediation: z
    .object({
      summary: z.string().max(500),
      attempts: z.number().int().nonnegative(),
      source: EvidenceSourceSchema.optional(),
    })
    .optional(),
  validation: z.object({
    unitTests: TestResultSchema.optional(),
    integrationTests: TestResultSchema.optional(),
    lint: CheckResultSchema.optional(),
    typecheck: CheckResultSchema.optional(),
    healthProbe: CheckResultSchema.optional(),
  }),
  proposedAction: z.object({
    tool: z.string().min(1).max(120),
    summary: z.string().max(500),
    actionClass: ActionClassSchema,
  }),
  blastRadius: BlastRadiusSchema.optional(),
  rollbackPlan: z.object({
    summary: z.string().max(500),
    steps: z.array(z.string().max(300)).max(20),
  }),
  unknowns: z.array(z.string().max(300)).max(20),
});
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;

export const VerificationReportSchema = z.object({
  healthy: z.boolean(),
  checks: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        status: z.enum(['passed', 'failed']),
        summary: z.string().max(300).optional(),
        source: EvidenceSourceSchema.optional(),
      }),
    )
    .max(20),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
