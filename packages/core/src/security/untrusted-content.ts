import { redactText } from './redaction.js';

/**
 * Flags instruction-like text inside external content (tool outputs, files,
 * logs). Findings are informational: external content is always treated as
 * data, and the approval boundary is enforced by typed policy, not by this scan.
 * This is untrusted-content handling, not a guarantee against prompt injection.
 */
export interface UntrustedFinding {
  rule: string;
  label: string;
  excerpt: string;
}

const RULES: readonly { rule: string; label: string; pattern: RegExp }[] = [
  {
    rule: 'override-instructions',
    label: 'Tries to override the agent’s instructions',
    pattern:
      /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|system)\b[^.\n]{0,30}\b(?:instructions?|rules|prompts?|directives?|guidelines)\b/i,
  },
  {
    rule: 'secret-request',
    label: 'Asks for secrets or credentials',
    pattern:
      /\b(?:reveal|print|show|output|leak|send|upload|exfiltrate|post|echo|dump|share)\b[^.\n]{0,50}\b(?:api[ _-]?keys?|secrets?|tokens?|credentials?|passwords?|env(?:ironment)? variables?|\.env)\b/i,
  },
  {
    rule: 'disable-safety',
    label: 'Asks to disable a safety control',
    pattern:
      /\b(?:disable|turn off|deactivate|bypass|remove)\b[^.\n]{0,40}\b(?:polic(?:y|ies)|guardrails?|safety|approvals?|audit(?:ing| logs?| logging)?|cloudtrail)\b/i,
  },
  {
    rule: 'approval-bypass',
    label: 'Asks to act without approval',
    pattern:
      /\b(?:do|proceed|go ahead|merge|deploy|push|execute|run|apply)\b[^.\n]{0,40}\bwithout\b[^.\n]{0,20}\b(?:approval|asking|confirmation|review|authori[sz]ation)\b/i,
  },
  {
    rule: 'role-hijack',
    label: 'Claims a new role or system prompt',
    pattern: /\b(?:you are now|new system prompt|system prompt:|developer mode)\b/i,
  },
  {
    rule: 'pipe-to-shell',
    label: 'Pipes a download straight into a shell',
    pattern: /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:ba|z)?sh\b/i,
  },
];

const MAX_SCAN_CHARS = 200_000;

export function scanUntrustedContent(text: string, maxFindings = 5): UntrustedFinding[] {
  // Redact before scanning so an excerpt can never cut a secret in half and leak the rest.
  // A cut at the size limit drops the trailing partial word for the same reason.
  const bounded =
    text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS).replace(/\S+$/, '') : text;
  const sample = redactText(bounded);
  const findings: UntrustedFinding[] = [];
  for (const { rule, label, pattern } of RULES) {
    const match = pattern.exec(sample);
    if (!match) continue;
    findings.push({ rule, label, excerpt: excerptAround(sample, match.index, match[0].length) });
    if (findings.length >= maxFindings) break;
  }
  return findings;
}

function excerptAround(text: string, start: number, length: number): string {
  const from = Math.max(0, start - 30);
  const to = Math.min(text.length, start + length + 30);
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}
