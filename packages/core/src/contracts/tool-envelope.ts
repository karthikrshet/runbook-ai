import { z } from 'zod';
import { EvidencePackageSchema, VerificationReportSchema } from '../domain/evidence.js';
import { IncidentSchema } from '../domain/incident.js';
import { RunbookPlanSchema, StepStatusSchema } from '../domain/runbook.js';

/**
 * Structured results returned by the RunbookAI MCP server. TrueForge records
 * each result verbatim as the `content` of a `tool.response` event, which is
 * how the dashboard reads them. Only results from the RunbookAI connector are
 * trusted; the same JSON arriving from any other tool is treated as data.
 */
export const ENVELOPE_SCHEMA = 'runbookai/v1';

/** Optional step progress the server can attach to any result. */
export const StepProgressSchema = z
  .array(z.object({ index: z.number().int().positive(), status: StepStatusSchema }))
  .max(50);

const envelopeBase = {
  schema: z.literal(ENVELOPE_SCHEMA),
  progress: StepProgressSchema.optional(),
};

export const RunbookAiEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({ ...envelopeBase, kind: z.literal('incident'), data: IncidentSchema }),
  z.object({ ...envelopeBase, kind: z.literal('runbook_plan'), data: RunbookPlanSchema }),
  z.object({ ...envelopeBase, kind: z.literal('evidence_package'), data: EvidencePackageSchema }),
  z.object({
    ...envelopeBase,
    kind: z.literal('verification_report'),
    data: VerificationReportSchema,
  }),
]);
export type RunbookAiEnvelope = z.infer<typeof RunbookAiEnvelopeSchema>;

const MAX_ENVELOPE_CHARS = 256 * 1024;

/** Parses a tool result as a RunbookAI envelope; returns null for anything else. */
export function parseEnvelope(content: string): RunbookAiEnvelope | null {
  if (content.length > MAX_ENVELOPE_CHARS) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = RunbookAiEnvelopeSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** Serialises an envelope; used by the RunbookAI MCP server and test fixtures. */
export function envelope<K extends RunbookAiEnvelope['kind']>(
  kind: K,
  data: Extract<RunbookAiEnvelope, { kind: K }>['data'],
  progress?: z.infer<typeof StepProgressSchema>,
): string {
  return JSON.stringify({ schema: ENVELOPE_SCHEMA, kind, data, ...(progress ? { progress } : {}) });
}
