import { z } from "zod";
import { redactObject } from "../security/redaction.js";

export const AuditEventTypeSchema = z.enum([
  "INCIDENT_RECEIVED",
  "RUNBOOK_PARSED",
  "TOOL_REQUESTED",
  "TOOL_SUCCEEDED",
  "TOOL_FAILED",
  "SANDBOX_REQUESTED",
  "SANDBOX_SUCCEEDED",
  "SANDBOX_FAILED",
  "EVIDENCE_RECORDED",
  "APPROVAL_REQUIRED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "ACTION_EXECUTED",
  "VERIFICATION_COMPLETED",
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string().trim().min(1, "Event id must not be empty"),
  type: AuditEventTypeSchema,
  timestamp: z.string().min(1, "Timestamp must not be empty"),
  incidentId: z.string().trim().min(1, "Incident id must not be empty"),
  summary: z.string().trim().min(1, "Summary must not be empty"),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * In-memory audit timeline container for an incident session.
 * NOTE: Initialized empty. No fake events are prepopulated.
 */
export class AuditTimeline {
  private events: AuditEvent[] = [];

  constructor(initialEvents: AuditEvent[] = []) {
    for (const event of initialEvents) {
      this.record(event);
    }
  }

  /**
   * Records an audit event with automatic redaction of sensitive values.
   */
  public record(eventInput: unknown): AuditEvent {
    const validated = AuditEventSchema.parse(eventInput);
    const sanitizedPayload = redactObject(validated.payload);

    const event: AuditEvent = {
      ...validated,
      payload: sanitizedPayload,
    };

    // Verify monotonic or valid chronological ordering
    if (this.events.length > 0) {
      const lastEvent = this.events[this.events.length - 1];
      if (lastEvent && new Date(event.timestamp).getTime() < new Date(lastEvent.timestamp).getTime()) {
        throw new Error(
          `Event timestamp out of order: ${event.timestamp} is earlier than previous event ${lastEvent.timestamp}`
        );
      }
    }

    this.events.push(event);
    return event;
  }

  public getEvents(): readonly AuditEvent[] {
    return [...this.events];
  }

  public getEventsByIncident(incidentId: string): AuditEvent[] {
    return this.events.filter((e) => e.incidentId === incidentId);
  }

  public getEventsByType(type: AuditEventType): AuditEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  public clear(): void {
    this.events = [];
  }
}
