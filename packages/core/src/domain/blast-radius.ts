import { z } from 'zod';

export const RISK_CLASSES = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED'] as const;
export const RiskClassSchema = z.enum(RISK_CLASSES);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const BlastRadiusSchema = z.object({
  externalSystemsTouched: z.array(z.string().max(80)).max(20),
  resourcesAffected: z.number().int().nonnegative(),
  customerFacing: z.boolean(),
  mutatesData: z.boolean(),
  destructive: z.boolean(),
  reversible: z.boolean(),
  rollbackAvailable: z.boolean(),
  unknownDependencies: z.number().int().nonnegative(),
  riskClass: RiskClassSchema,
  /** The deterministic rules that produced `riskClass`, in evaluation order. */
  reasons: z.array(z.string().max(200)).max(20),
});
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;
