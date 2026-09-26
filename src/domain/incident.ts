import { z } from "zod";

export const IncidentSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const IncidentStatusSchema = z.enum([
  "OPEN",
  "INVESTIGATING",
  "MITIGATING",
  "RESOLVED",
  "CLOSED",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string().trim().min(1, "Incident id must not be empty"),
  title: z.string().trim().min(1, "Incident title must not be empty"),
  service: z.string().trim().min(1, "Service must not be empty"),
  status: IncidentStatusSchema,
  severity: IncidentSeveritySchema,
  description: z.string().trim().min(1, "Description must not be empty"),
  createdAt: z.string().min(1, "createdAt must not be empty"),
});

export type Incident = z.infer<typeof IncidentSchema>;

/**
 * Controlled demo incident fixture for hackathon scenario.
 */
export const DEMO_INCIDENT_INC001: Incident = {
  id: "INC-001",
  title: "Checkout API 500 Spike After Deployment",
  service: "checkout-api",
  status: "INVESTIGATING",
  severity: "HIGH",
  description: "checkout-api started returning 500 responses after the latest release.",
  createdAt: "2026-09-26T12:00:00.000Z",
};
