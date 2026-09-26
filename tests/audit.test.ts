import { describe, expect, it } from "vitest";
import { AuditEventSchema, AuditTimeline } from "../src/audit/timeline.js";

describe("Audit Timeline", () => {
  it("validates event structure correctly", () => {
    const validEvent = AuditEventSchema.parse({
      id: "ev-1",
      type: "INCIDENT_RECEIVED",
      timestamp: "2026-09-26T12:00:00.000Z",
      incidentId: "INC-001",
      summary: "Incident INC-001 ingested into RunbookAI",
      payload: { service: "checkout-api" },
    });
    expect(validEvent.type).toBe("INCIDENT_RECEIVED");
  });

  it("rejects invalid event type", () => {
    const invalidEvent = AuditEventSchema.safeParse({
      id: "ev-bad",
      type: "UNRECOGNIZED_EVENT_TYPE",
      timestamp: "2026-09-26T12:00:00.000Z",
      incidentId: "INC-001",
      summary: "Bad event",
    });
    expect(invalidEvent.success).toBe(false);
  });

  it("starts empty without prepopulated fake events", () => {
    const timeline = new AuditTimeline();
    expect(timeline.getEvents()).toHaveLength(0);
  });

  it("records events and preserves chronological ordering", () => {
    const timeline = new AuditTimeline();

    timeline.record({
      id: "ev-1",
      type: "INCIDENT_RECEIVED",
      timestamp: "2026-09-26T12:00:00.000Z",
      incidentId: "INC-001",
      summary: "Incident ingested",
    });

    timeline.record({
      id: "ev-2",
      type: "RUNBOOK_PARSED",
      timestamp: "2026-09-26T12:01:00.000Z",
      incidentId: "INC-001",
      summary: "Runbook parsed",
    });

    const events = timeline.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("INCIDENT_RECEIVED");
    expect(events[1]?.type).toBe("RUNBOOK_PARSED");
  });

  it("rejects out-of-order events", () => {
    const timeline = new AuditTimeline();

    timeline.record({
      id: "ev-1",
      type: "INCIDENT_RECEIVED",
      timestamp: "2026-09-26T12:05:00.000Z",
      incidentId: "INC-001",
      summary: "First event at 12:05",
    });

    expect(() =>
      timeline.record({
        id: "ev-2",
        type: "RUNBOOK_PARSED",
        timestamp: "2026-09-26T12:01:00.000Z", // Out of order: 12:01 is earlier than 12:05
        incidentId: "INC-001",
        summary: "Backdated event",
      })
    ).toThrow(/out of order/i);
  });

  it("redacts sensitive data inside recorded event payloads", () => {
    const timeline = new AuditTimeline();

    timeline.record({
      id: "ev-auth",
      type: "TOOL_REQUESTED",
      timestamp: "2026-09-26T12:00:00.000Z",
      incidentId: "INC-001",
      summary: "Calling tool with auth header",
      payload: {
        header: "Bearer token_secret_string_12345678",
      },
    });

    const recorded = timeline.getEvents()[0];
    expect(recorded?.payload).toBeDefined();
    const payloadStr = JSON.stringify(recorded?.payload);
    expect(payloadStr).toContain("Bearer [REDACTED_TOKEN]");
    expect(payloadStr).not.toContain("token_secret_string_12345678");
  });
});
