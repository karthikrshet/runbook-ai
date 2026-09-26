import { z } from "zod";
import { ActionCategorySchema } from "./action.js";

export const RunbookStepStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "WAITING_APPROVAL",
]);
export type RunbookStepStatus = z.infer<typeof RunbookStepStatusSchema>;

export const RunbookStepSchema = z.object({
  id: z.string().trim().min(1, "Step id must not be empty"),
  stepNumber: z.number().int().positive("stepNumber must be a positive integer"),
  description: z.string().trim().min(1, "Step description must not be empty"),
  category: ActionCategorySchema,
  tool: z.string().trim().min(1, "Tool name must not be empty"),
  requiresApproval: z.boolean(),
  evidenceRequired: z.boolean(),
  status: RunbookStepStatusSchema.default("PENDING"),
});

export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookSchema = z.object({
  id: z.string().trim().min(1, "Runbook id must not be empty"),
  title: z.string().trim().min(1, "Runbook title must not be empty"),
  steps: z.array(RunbookStepSchema).min(1, "Runbook must contain at least one step"),
});

export type Runbook = z.infer<typeof RunbookSchema>;
