import { redactText } from '@runbook-ai/core';
import type { ExecView, TestSummaryView } from '../../shared/view.js';
import { errorText, isRecord, tryParseJson } from './content.js';

const TAIL_LINES = 60;
const TAIL_CHARS = 6000;
// ECMA-48 CSI sequences (colours, cursor movement) emitted by test runners.
const ANSI_PATTERN = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

interface ParsedExecResponse {
  exitCode: number | null;
  output: string;
  infraError: string | null;
}

/**
 * TrueForge's sandbox `exec` tool returns `JSON.stringify(ExecResult)`:
 *   {"success":true,"response":{"exitCode":0,"result":"..."}}   command ran
 *   {"success":false,"error":"..."}                               sandbox failed
 * Tool errors are wrapped by the harness as {"error": <content>}.
 */
export function parseExecResponse(content: string): ParsedExecResponse {
  const json = tryParseJson(content);
  if (isRecord(json)) {
    const response = json['response'];
    if (json['success'] === true && isRecord(response)) {
      return {
        exitCode: typeof response['exitCode'] === 'number' ? response['exitCode'] : null,
        output: typeof response['result'] === 'string' ? response['result'] : '',
        infraError: null,
      };
    }
    if (json['success'] === false) {
      return { exitCode: null, output: '', infraError: stringify(json['error']) };
    }
    if ('error' in json) {
      const inner = errorText(json['error']);
      const innerJson = tryParseJson(inner);
      const message =
        isRecord(innerJson) && innerJson['success'] === false
          ? stringify(innerJson['error'])
          : inner;
      return { exitCode: null, output: '', infraError: message };
    }
  }
  // Unrecognised shape (for example a large-output pointer): show it as output.
  return { exitCode: null, output: content, infraError: null };
}

/** Builds the display view of a sandbox command; `output` is the full unredacted text for scanning. */
export function buildExecView(
  args: Record<string, unknown>,
  response: string | null,
): { view: ExecView; output: string } {
  const command = typeof args['command'] === 'string' ? redactText(args['command']) : '';
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : null;
  if (response === null) {
    return {
      view: {
        command,
        cwd,
        exitCode: null,
        infraError: null,
        outputTail: '',
        outputLineCount: 0,
        truncated: false,
        tests: null,
      },
      output: '',
    };
  }
  const parsed = parseExecResponse(response);
  const plain = stripAnsi(parsed.output).replace(/\r\n?/g, '\n');
  // Redact the whole output before cutting the tail so no secret is split in half.
  const clean = redactText(plain).replace(/^\n+|\n+$/g, '');
  const lines = clean === '' ? [] : clean.split('\n');
  let tail = lines.slice(-TAIL_LINES).join('\n');
  if (tail.length > TAIL_CHARS) tail = tail.slice(-TAIL_CHARS);
  return {
    view: {
      command,
      cwd,
      exitCode: parsed.exitCode,
      infraError: parsed.infraError === null ? null : redactText(parsed.infraError),
      outputTail: tail,
      outputLineCount: lines.length,
      truncated: tail.length < clean.length,
      tests: parseTestSummary(clean),
    },
    output: plain,
  };
}

/**
 * Reads the summary line printed by common JavaScript test runners. Returns null
 * when no summary is recognised; callers must not invent counts.
 */
export function parseTestSummary(output: string): TestSummaryView | null {
  const text = stripAnsi(output);

  // Vitest: "      Tests  1 failed | 11 passed (12)"
  const vitest = /^\s*Tests\s{2,}(.+?)\s+\((\d+)\)\s*$/m.exec(text);
  if (vitest?.[1] && vitest[2]) {
    const counts = countParts(vitest[1], '|');
    return { ...counts, total: Number(vitest[2]), failedTests: failedTestNames(text) };
  }

  // Jest: "Tests:       1 failed, 11 passed, 12 total"
  const jest = /^\s*Tests:\s+(.+?),\s*(\d+) total\s*$/m.exec(text);
  if (jest?.[1] && jest[2]) {
    const counts = countParts(jest[1], ',');
    return { ...counts, total: Number(jest[2]), failedTests: failedTestNames(text) };
  }

  // node:test: "# pass 11" / "# fail 1" (TAP) or "ℹ pass 11" (spec reporter)
  const pass = /^(?:#|ℹ)\s*pass\s+(\d+)\s*$/m.exec(text);
  const fail = /^(?:#|ℹ)\s*fail\s+(\d+)\s*$/m.exec(text);
  if (pass?.[1] && fail?.[1]) {
    const skipped = /^(?:#|ℹ)\s*skipped\s+(\d+)\s*$/m.exec(text)?.[1];
    const passed = Number(pass[1]);
    const failed = Number(fail[1]);
    const skippedCount = skipped ? Number(skipped) : 0;
    return {
      passed,
      failed,
      skipped: skippedCount,
      total: passed + failed + skippedCount,
      failedTests: failedTestNames(text),
    };
  }
  return null;
}

function countParts(
  summary: string,
  separator: string,
): Omit<TestSummaryView, 'total' | 'failedTests'> {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const part of summary.split(separator)) {
    const match = /(\d+)\s+(passed|failed|skipped|todo|pending)/.exec(part.trim());
    if (!match?.[1] || !match[2]) continue;
    const value = Number(match[1]);
    if (match[2] === 'passed') counts.passed += value;
    else if (match[2] === 'failed') counts.failed += value;
    else counts.skipped += value;
  }
  return counts;
}

/** Names of failing tests, most specific first; the same test is listed once. */
function failedTestNames(text: string): string[] {
  const names: string[] = [];
  const patterns = [
    /^\s*FAIL\s+(.+?)\s*$/gm,
    /^\s*[×✕]\s+(.+?)(?:\s+\d+ms)?\s*$/gm,
    /^\s*●\s+(.+?)\s*$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (!name || /^\d/.test(name)) continue;
      if (names.some((known) => known.endsWith(name) || name.endsWith(known))) continue;
      names.push(name.length > 160 ? `${name.slice(0, 157)}…` : name);
      if (names.length >= 5) return names;
    }
  }
  return names;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === undefined ? 'Unknown sandbox error' : JSON.stringify(value);
}
