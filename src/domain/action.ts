import { z } from "zod";

export const ActionCategorySchema = z.enum([
  "READ_ONLY",
  "SANDBOX_ONLY",
  "REVERSIBLE_EXTERNAL",
  "CONSEQUENTIAL",
  "FORBIDDEN",
]);

export type ActionCategory = z.infer<typeof ActionCategorySchema>;

export const ProposedActionSchema = z.object({
  id: z.string().trim().min(1, "Action id must not be empty"),
  description: z.string().trim().min(1, "Action description must not be empty"),
  category: ActionCategorySchema,
  externalSystem: z.string().trim().optional(),
  mutatesExternalState: z.boolean().default(false),
  mutatesData: z.boolean().default(false),
  destructive: z.boolean().default(false),
  reversible: z.boolean().default(true),
  rollbackAvailable: z.boolean().default(false),
  resourcesAffected: z
    .number()
    .int("resourcesAffected must be an integer")
    .nonnegative("resourcesAffected cannot be negative")
    .default(0),
  customerFacing: z.boolean().default(false),
  unknownScope: z.boolean().default(false),
  unknownDependencies: z
    .number()
    .int("unknownDependencies must be an integer")
    .nonnegative("unknownDependencies cannot be negative")
    .default(0),
  requestsSecretExposure: z.boolean().default(false),
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export function parseProposedAction(input: unknown): ProposedAction {
  return ProposedActionSchema.parse(input);
}

export function safeParseProposedAction(input: unknown) {
  return ProposedActionSchema.safeParse(input);
}
