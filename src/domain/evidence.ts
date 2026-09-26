import { z } from "zod";
import { ProposedActionSchema } from "./action.js";
import { BlastRadiusSchema } from "./blast-radius.js";

export const EvidenceProvenanceSchema = z.enum([
  "OBSERVED",
  "TOOL_DERIVED",
  "SANDBOX_DERIVED",
  "MODEL_HYPOTHESIS",
  "USER_PROVIDED",
]);

export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string().trim().min(1, "Evidence id must not be empty"),
  provenance: EvidenceProvenanceSchema,
  description: z.string().trim().min(1, "Evidence description must not be empty"),
  data: z.unknown().optional(),
  timestamp: z.string().optional(),
  sourceUri: z.string().optional(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * CheckResult represents an operational verification check (lint, typecheck, health probe).
 * CRITICAL RULE: MODEL_HYPOTHESIS cannot attest that a check succeeded.
 */
export const CheckResultSchema = z
  .object({
    checkName: z.string().trim().min(1, "Check name must not be empty"),
    passed: z.boolean(),
    details: z.string().optional(),
    provenance: EvidenceProvenanceSchema,
  })
  .refine(
    (data) => {
      if (data.passed && data.provenance === "MODEL_HYPOTHESIS") {
        return false;
      }
      return true;
    },
    {
      message: "MODEL_HYPOTHESIS cannot attest that an execution check succeeded.",
      path: ["provenance"],
    }
  );

export type CheckResult = z.infer<typeof CheckResultSchema>;

/**
 * TestResult represents test suite execution.
 * CRITICAL RULE: MODEL_HYPOTHESIS cannot attest that tests passed.
 */
export const TestResultSchema = z
  .object({
    testSuite: z.string().trim().min(1, "Test suite name must not be empty"),
    passed: z.boolean(),
    totalTests: z.number().int().nonnegative().optional(),
    passedTests: z.number().int().nonnegative().optional(),
    failedTests: z.number().int().nonnegative().optional(),
    provenance: EvidenceProvenanceSchema,
    rawOutput: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.passed && data.provenance === "MODEL_HYPOTHESIS") {
        return false;
      }
      return true;
    },
    {
      message: "MODEL_HYPOTHESIS cannot attest to verified test execution or passing tests.",
      path: ["provenance"],
    }
  );

export type TestResult = z.infer<typeof TestResultSchema>;

export const RootCauseHypothesisSchema = z.object({
  summary: z.string().trim().min(1, "Summary must not be empty"),
  evidence: z.array(EvidenceItemSchema),
});

export type RootCauseHypothesis = z.infer<typeof RootCauseHypothesisSchema>;

export const RollbackPlanSchema = z.object({
  available: z.boolean(),
  steps: z.array(z.string().trim().min(1)),
  estimatedRecoverySeconds: z.number().int().nonnegative().optional(),
});

export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;

export const ReproductionRecordSchema = z.object({
  attempted: z.boolean(),
  reproduced: z.boolean(),
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  evidence: z.array(EvidenceItemSchema),
});

export type ReproductionRecord = z.infer<typeof ReproductionRecordSchema>;

export const ValidationSummarySchema = z.object({
  unitTests: TestResultSchema.optional(),
  integrationTests: TestResultSchema.optional(),
  lint: CheckResultSchema.optional(),
  typecheck: CheckResultSchema.optional(),
  healthProbe: CheckResultSchema.optional(),
});

export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;

export const EvidencePackageSchema = z.object({
  incidentId: z.string().trim().min(1, "incidentId must not be empty"),
  problemSummary: z.string().trim().min(1, "problemSummary must not be empty"),
  suspectedRootCause: RootCauseHypothesisSchema,
  reproduction: ReproductionRecordSchema,
  validation: ValidationSummarySchema,
  proposedAction: ProposedActionSchema,
  blastRadius: BlastRadiusSchema,
  rollbackPlan: RollbackPlanSchema,
  unknowns: z.array(z.string()),
});

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;

export function isVerifiedExecutionProvenance(provenance: EvidenceProvenance): boolean {
  return provenance === "OBSERVED" || provenance === "TOOL_DERIVED" || provenance === "SANDBOX_DERIVED";
}
