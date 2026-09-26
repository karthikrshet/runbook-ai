/**
 * Redacts credentials from text before it is logged or displayed. Patterns use
 * bounded quantifiers so large tool outputs cannot trigger slow backtracking.
 */

interface RedactionRule {
  kind: string;
  pattern: RegExp;
  /** Capture groups (by index) that are kept verbatim ahead of the redaction marker. */
  keep?: number[];
}

const RULES: readonly RedactionRule[] = [
  {
    kind: 'private-key',
    pattern:
      /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,20000}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g,
  },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_\w{22,255})/g },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{20,255}/g },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,255}/g },
  { kind: 'daytona-key', pattern: /\bdtn_[A-Za-z0-9]{20,255}/g },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}/g,
  },
  { kind: 'bearer', pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,4096}=*/gi, keep: [1] },
  {
    kind: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{1,200}:)[^\s@/]{1,200}(@)/gi,
    keep: [1, 2],
  },
  {
    kind: 'secret-assignment',
    pattern:
      /\b([\w.-]{0,40}(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|credential)s?[\w.-]{0,40}\s{0,3}[:=]\s{0,3}["']?)(?!\[REDACTED)(?!\d+\b)[^\s"',;]{4,4096}/gi,
    keep: [1],
  },
];

const SECRET_KEY_NAME =
  /secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id/i;

export function redactText(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, (...args: unknown[]) => {
      // replace() passes (match, ...groups, offset, input); keep the requested groups.
      const groups = args.slice(1, -2) as (string | undefined)[];
      const [before = '', after = ''] = (rule.keep ?? []).map((index) => groups[index - 1] ?? '');
      return `${before}[REDACTED:${rule.kind}]${after}`;
    });
  }
  return output;
}

/** True when a field name suggests its value is a credential. */
export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_NAME.test(key);
}

/** Redacts a keyed value: the whole value if the key looks secret, else any embedded secrets. */
export function redactField(key: string, value: string): string {
  return isSecretKeyName(key) ? '[REDACTED]' : redactText(value);
}
