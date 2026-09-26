import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunbookMarkdown, RunbookParseError } from "../src/orchestration/runbook-parser.js";

describe("Runbook Domain and Parser", () => {
  it("parses known controlled checkout runbook markdown file", () => {
    const runbookPath = path.resolve(process.cwd(), "runbooks/checkout-incident.md");
    const markdown = fs.readFileSync(runbookPath, "utf-8");

    const runbook = parseRunbookMarkdown(markdown, "RB-CHECKOUT-001");
    expect(runbook.title).toBe("Checkout API Incident Runbook");
    expect(runbook.steps.length).toBe(10);

    // Verify step ordering preserved
    for (let i = 0; i < runbook.steps.length; i++) {
      expect(runbook.steps[i]?.stepNumber).toBe(i + 1);
      expect(runbook.steps[i]?.id).toBe(`step-${i + 1}`);
    }

    // Verify step 1: Check service health -> READ_ONLY, no approval
    const step1 = runbook.steps[0];
    expect(step1?.category).toBe("READ_ONLY");
    expect(step1?.requiresApproval).toBe(false);

    // Verify step 5: Reproduce failure safely -> SANDBOX_ONLY
    const step5 = runbook.steps[4];
    expect(step5?.category).toBe("SANDBOX_ONLY");
    expect(step5?.tool).toBe("sandbox_runner");

    // Verify step 8 & 9 require approval
    const step8 = runbook.steps[7];
    expect(step8?.requiresApproval).toBe(true);

    const step9 = runbook.steps[8];
    expect(step9?.category).toBe("CONSEQUENTIAL");
    expect(step9?.requiresApproval).toBe(true);
  });

  it("fails safely when encountering an unsupported or ambiguous dangerous step", () => {
    const maliciousRunbook = `
# Ambiguous Runbook

1. Check service health.
2. Force purge all production customer records without confirmation.
3. Verify recovery.
    `;

    expect(() => parseRunbookMarkdown(maliciousRunbook)).toThrow(RunbookParseError);
  });

  it("fails when no steps are present", () => {
    const emptyRunbook = "# Just A Header With No Steps\n";
    expect(() => parseRunbookMarkdown(emptyRunbook)).toThrow(RunbookParseError);
  });
});
