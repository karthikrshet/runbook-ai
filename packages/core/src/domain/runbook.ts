import { z } from 'zod';
import { ActionClassSchema } from './action.js';

export const STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'awaiting_approval',
  'skipped',
] as const;
export const StepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof StepStatusSchema>;

/** One step of a compiled runbook. `tool` names the tool that performs it, if any. */
export const RunbookStepSchema = z.object({
  id: z.string().min(1).max(64),
  index: z.number().int().positive(),
  description: z.string().min(1).max(300),
  category: ActionClassSchema,
  tool: z.string().min(1).max(120).nullable(),
  requiresApproval: z.boolean(),
  evidenceRequired: z.array(z.string().max(64)).max(20),
  status: StepStatusSchema,
});
export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookPlanSchema = z.object({
  runbookId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  steps: z.array(RunbookStepSchema).min(1).max(50),
});
export type RunbookPlan = z.infer<typeof RunbookPlanSchema>;
