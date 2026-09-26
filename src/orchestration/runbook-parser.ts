import { type ActionCategory } from "../domain/action.js";
import { type Runbook, type RunbookStep, RunbookSchema } from "../domain/runbook.js";

export class RunbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunbookParseError";
  }
}

interface StepClassification {
  category: ActionCategory;
  tool: string;
  requiresApproval: boolean;
  evidenceRequired: boolean;
}

/**
 * Controlled pattern mappings for deterministic runbook compilation.
 * CRITICAL: Unknown or ambiguous steps are NEVER defaulted to READ_ONLY;
 * they must fail safely with RunbookParseError.
 */
const KNOWN_STEP_PATTERNS: Array<{
  pattern: RegExp;
  classification: StepClassification;
}> = [
  {
    pattern: /check service health/i,
    classification: {
      category: "READ_ONLY",
      tool: "health_check",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /read errors (from the last \d+ minutes|in logs?)/i,
    classification: {
      category: "READ_ONLY",
      tool: "log_reader",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /compare current deployment with previous deployment/i,
    classification: {
      category: "READ_ONLY",
      tool: "deploy_diff",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /inspect recent source changes/i,
    classification: {
      category: "READ_ONLY",
      tool: "git_inspect",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /reproduce suspected failure safely/i,
    classification: {
      category: "SANDBOX_ONLY",
      tool: "sandbox_runner",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /generate candidate remediation/i,
    classification: {
      category: "SANDBOX_ONLY",
      tool: "remediation_generator",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /run regression validation/i,
    classification: {
      category: "SANDBOX_ONLY",
      tool: "test_runner",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
  {
    pattern: /ask for approval|request approval/i,
    classification: {
      category: "REVERSIBLE_EXTERNAL",
      tool: "approval_gate",
      requiresApproval: true,
      evidenceRequired: true,
    },
  },
  {
    pattern: /apply approved action/i,
    classification: {
      category: "CONSEQUENTIAL",
      tool: "deployment_tool",
      requiresApproval: true,
      evidenceRequired: true,
    },
  },
  {
    pattern: /verify recovery/i,
    classification: {
      category: "READ_ONLY",
      tool: "health_verify",
      requiresApproval: false,
      evidenceRequired: true,
    },
  },
];

/**
 * Deterministic Runbook Parser for controlled runbook formats.
 */
export function parseRunbookMarkdown(markdownContent: string, runbookId = "RB-001"): Runbook {
  const lines = markdownContent.split(/\r?\n/);

  let title = "";
  const steps: RunbookStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    if (!line) continue;

    // Detect markdown title (# Title)
    if (line.startsWith("#")) {
      const parsedTitle = line.replace(/^#+\s*/, "").trim();
      if (parsedTitle && !title) {
        title = parsedTitle;
      }
      continue;
    }

    // Match numbered list: 1. Description
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      const stepNumber = parseInt(numberedMatch[1] ?? "0", 10);
      const description = (numberedMatch[2] ?? "").trim();

      const matchedRule = KNOWN_STEP_PATTERNS.find((rule) => rule.pattern.test(description));

      if (!matchedRule) {
        // Fail safely: do not guess or silently classify dangerous unknown steps as READ_ONLY
        throw new RunbookParseError(
          `Unsupported or ambiguous runbook step at line ${i + 1}: "${description}". Unknown steps fail safely and require explicit classification.`
        );
      }

      steps.push({
        id: `step-${stepNumber}`,
        stepNumber,
        description,
        category: matchedRule.classification.category,
        tool: matchedRule.classification.tool,
        requiresApproval: matchedRule.classification.requiresApproval,
        evidenceRequired: matchedRule.classification.evidenceRequired,
        status: "PENDING",
      });
    }
  }

  if (!title) {
    title = "Incident Runbook";
  }

  if (steps.length === 0) {
    throw new RunbookParseError("Runbook markdown must contain at least one numbered step.");
  }

  return RunbookSchema.parse({
    id: runbookId,
    title,
    steps,
  });
}
