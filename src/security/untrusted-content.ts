export interface SuspiciousPatternMatch {
  patternId: string;
  description: string;
  matchedText: string;
  index: number;
}

export interface UntrustedContentAnalysis {
  isSafe: boolean;
  hasSuspiciousPatterns: boolean;
  findings: SuspiciousPatternMatch[];
  warning?: string | undefined;
}

interface SuspiciousRule {
  id: string;
  description: string;
  regex: RegExp;
}

/**
 * Deterministic safety signals for untrusted external content.
 * Terminology: "untrusted-content handling with deterministic tool boundaries".
 * NOTE: This is a defensive safety signal, NOT a claim of being "prompt-injection proof".
 */
const SUSPICIOUS_RULES: SuspiciousRule[] = [
  {
    id: "PROMPT_OVERRIDE",
    description: "Attempts to override or ignore system instructions",
    regex: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|prompts)\b/i,
  },
  {
    id: "SECRET_REVELATION",
    description: "Attempts to reveal API keys or secret credentials",
    regex: /\b(reveal|show|print|output|display|echo|leak)\s+(the\s+)?(api[_-]?key|credentials?|secrets?|tokens?|passwords?)\b/i,
  },
  {
    id: "SECRET_EXFILTRATION",
    description: "Attempts to upload or exfiltrate secrets externally",
    regex: /\b(upload|exfiltrate|send|post|transmit)\s+(the\s+)?(secrets?|credentials?|tokens?|keys?)\s+(to|externally)\b/i,
  },
  {
    id: "POLICY_TAMPERING",
    description: "Attempts to disable or override deterministic safety policy",
    regex: /\b(disable|bypass|override|turn\s*off)\s+(the\s+)?(safety\s+)?(policy|approval|guardrail|rule)\b/i,
  },
  {
    id: "ARBITRARY_EXECUTION",
    description: "Attempts to request unconstrained arbitrary command execution",
    regex: /\b(run|execute)\s+(arbitrary|unrestricted|raw)\s+(commands?|bash|shell|powershell|scripts?)\b/i,
  },
];

/**
 * Analyzes untrusted text content for suspicious control or extraction instructions.
 */
export function analyzeUntrustedContent(content: string): UntrustedContentAnalysis {
  const findings: SuspiciousPatternMatch[] = [];

  for (const rule of SUSPICIOUS_RULES) {
    const match = rule.regex.exec(content);
    if (match && match.index !== undefined) {
      findings.push({
        patternId: rule.id,
        description: rule.description,
        matchedText: match[0],
        index: match.index,
      });
    }
  }

  const hasSuspiciousPatterns = findings.length > 0;

  return {
    isSafe: !hasSuspiciousPatterns,
    hasSuspiciousPatterns,
    findings,
    warning: hasSuspiciousPatterns
      ? `Untrusted content contains ${findings.length} suspicious pattern(s). Deterministic tool boundaries must enforce strict containment.`
      : undefined,
  };
}
