/**
 * Defensive redaction for secret-like tokens and credentials.
 * Used across logs, audit events, and tool outputs.
 */

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
  // Bearer tokens
  {
    name: "BEARER_TOKEN",
    pattern: /Bearer\s+([A-Za-z0-9_.-]{12,})/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  // GitHub Personal Access Tokens and OAuth tokens
  {
    name: "GITHUB_TOKEN",
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|ghr_[A-Za-z0-9]{36})\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // AWS Access Key ID
  {
    name: "AWS_ACCESS_KEY",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // OpenAI API Key
  {
    name: "OPENAI_API_KEY",
    pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  // Daytona API Key
  {
    name: "DAYTONA_API_KEY",
    pattern: /\b(daytona_[A-Za-z0-9_-]{16,})\b/g,
    replacement: "[REDACTED_DAYTONA_KEY]",
  },
  // Key=Value secrets in environment variables or logs
  {
    name: "ENV_SECRET",
    pattern: /\b((?:API_KEY|SECRET|PASSWORD|TOKEN|ACCESS_KEY|PRIVATE_KEY)=)([^\s;&|"']+)/gi,
    replacement: "$1[REDACTED_VALUE]",
  },
  // JSON key-value secret fields
  {
    name: "JSON_SECRET_FIELD",
    pattern: /(["']?(?:apiKey|api_key|secret|password|accessToken|access_token|privateKey|private_key)["']?\s*[:=]\s*["'])([^"',\s]{8,})(["'])/gi,
    replacement: "$1[REDACTED_SECRET]$3",
  },
];

/**
 * Redacts secrets from string inputs.
 */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  return redacted;
}

/**
 * Recursively redacts string values within an object or array.
 */
export function redactObject<T>(input: T): T {
  if (typeof input === "string") {
    return redactSecrets(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item)) as unknown as T;
  }

  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (
        /^(?:API_KEY|SECRET|PASSWORD|TOKEN|ACCESS_KEY|PRIVATE_KEY|apiKey|api_key|authToken|accessToken|secretKey)$/i.test(
          key
        ) &&
        typeof value === "string"
      ) {
        result[key] = "[REDACTED_VALUE]";
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as unknown as T;
  }

  return input;
}
