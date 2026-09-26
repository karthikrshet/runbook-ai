import { z } from 'zod';

export const IncidentSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  service: z.string().min(1).max(120),
  severity: z.string().max(20).optional(),
  summary: z.string().max(2000).optional(),
  openedAt: z.iso.datetime({ offset: true }).optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;
