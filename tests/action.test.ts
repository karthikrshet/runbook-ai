import { describe, expect, it } from "vitest";
import { parseProposedAction, safeParseProposedAction } from "../src/domain/action.js";

describe("Action Domain", () => {
  it("parses valid READ_ONLY action", () => {
    const action = parseProposedAction({
      id: "act-1",
      description: "Read deployment logs",
      category: "READ_ONLY",
      mutatesExternalState: false,
    });
    expect(action.category).toBe("READ_ONLY");
    expect(action.id).toBe("act-1");
    expect(action.resourcesAffected).toBe(0);
  });

  it("parses valid SANDBOX_ONLY action", () => {
    const action = parseProposedAction({
      id: "act-2",
      description: "Run sandbox reproduction test",
      category: "SANDBOX_ONLY",
    });
    expect(action.category).toBe("SANDBOX_ONLY");
  });

  it("parses valid REVERSIBLE_EXTERNAL action", () => {
    const action = parseProposedAction({
      id: "act-3",
      description: "Update traffic routing flag",
      category: "REVERSIBLE_EXTERNAL",
      externalSystem: "aws-route53",
      mutatesExternalState: true,
      reversible: true,
      rollbackAvailable: true,
    });
    expect(action.category).toBe("REVERSIBLE_EXTERNAL");
    expect(action.externalSystem).toBe("aws-route53");
  });

  it("parses valid CONSEQUENTIAL action", () => {
    const action = parseProposedAction({
      id: "act-4",
      description: "Apply database schema patch",
      category: "CONSEQUENTIAL",
      mutatesExternalState: true,
      mutatesData: true,
      destructive: false,
      resourcesAffected: 2,
    });
    expect(action.category).toBe("CONSEQUENTIAL");
    expect(action.resourcesAffected).toBe(2);
  });

  it("parses valid FORBIDDEN action", () => {
    const action = parseProposedAction({
      id: "act-5",
      description: "Drop production database table",
      category: "FORBIDDEN",
      destructive: true,
    });
    expect(action.category).toBe("FORBIDDEN");
  });

  it("rejects invalid action category", () => {
    const result = safeParseProposedAction({
      id: "act-bad",
      description: "Invalid action",
      category: "UNKNOWN_CATEGORY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative resourcesAffected", () => {
    const result = safeParseProposedAction({
      id: "act-neg",
      description: "Negative resources",
      category: "READ_ONLY",
      resourcesAffected: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative unknownDependencies", () => {
    const result = safeParseProposedAction({
      id: "act-neg-dep",
      description: "Negative dependencies",
      category: "READ_ONLY",
      unknownDependencies: -5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty id and empty description", () => {
    const resId = safeParseProposedAction({
      id: "   ",
      description: "Valid description",
      category: "READ_ONLY",
    });
    expect(resId.success).toBe(false);

    const resDesc = safeParseProposedAction({
      id: "act-valid",
      description: "   ",
      category: "READ_ONLY",
    });
    expect(resDesc.success).toBe(false);
  });
});
