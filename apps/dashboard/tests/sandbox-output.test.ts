import { describe, expect, it } from 'vitest';
import { classifyResponse, readableText } from '../server/projection/content.js';
import { parseExecResponse, parseTestSummary, stripAnsi } from '../server/projection/exec.js';

describe('parseExecResponse', () => {
  it('reads a command that ran, whatever its exit code', () => {
    const content = JSON.stringify({ success: true, response: { exitCode: 2, result: 'boom' } });
    expect(parseExecResponse(content)).toEqual({ exitCode: 2, output: 'boom', infraError: null });
  });

  it('reads a sandbox failure, bare or wrapped by the harness', () => {
    const bare = JSON.stringify({ success: false, error: 'sandbox unreachable' });
    expect(parseExecResponse(bare).infraError).toBe('sandbox unreachable');
    const wrapped = JSON.stringify({ error: [{ type: 'text', text: bare }] });
    expect(parseExecResponse(wrapped)).toEqual({
      exitCode: null,
      output: '',
      infraError: 'sandbox unreachable',
    });
  });

  it('shows unrecognised content as output instead of guessing an exit code', () => {
    expect(parseExecResponse('Output saved to /tmp/out.txt')).toEqual({
      exitCode: null,
      output: 'Output saved to /tmp/out.txt',
      infraError: null,
    });
  });
});

describe('parseTestSummary', () => {
  it('reads Vitest summaries, with colour codes', () => {
    const output =
      '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[1m\u001b[32m11 passed\u001b[39m\u001b[22m\u001b[90m (12)\u001b[39m';
    expect(stripAnsi(output)).toBe('      Tests  1 failed | 11 passed (12)');
    expect(parseTestSummary(output)).toEqual({
      passed: 11,
      failed: 1,
      skipped: 0,
      total: 12,
      failedTests: [],
    });
  });

  it('reads Jest summaries and failing test names', () => {
    const output =
      '  ● checkout › applies promo\n\nTests:       1 failed, 2 skipped, 9 passed, 12 total';
    expect(parseTestSummary(output)).toEqual({
      passed: 9,
      failed: 1,
      skipped: 2,
      total: 12,
      failedTests: ['checkout › applies promo'],
    });
  });

  it('reads node:test summaries', () => {
    expect(parseTestSummary('# tests 5\n# pass 4\n# fail 1\n# skipped 0')).toMatchObject({
      passed: 4,
      failed: 1,
      total: 5,
    });
  });

  it('returns null rather than inventing counts', () => {
    expect(parseTestSummary('> eslint .\n')).toBeNull();
  });
});

describe('classifyResponse', () => {
  it('tells denials from errors and results', () => {
    expect(classifyResponse(JSON.stringify({ error: 'User denied tool call: not now' }))).toEqual({
      kind: 'denied',
      message: 'not now',
    });
    expect(
      classifyResponse(JSON.stringify({ error: [{ type: 'text', text: 'rate limited' }] })),
    ).toEqual({ kind: 'error', message: 'rate limited' });
    expect(classifyResponse(JSON.stringify({ error: 'x', data: 1 })).kind).toBe('ok');
    expect(classifyResponse('plain text').kind).toBe('ok');
  });
});

describe('readableText', () => {
  it('reduces JSON to its string values so escaped newlines read as text', () => {
    const content = JSON.stringify({ commits: [{ message: 'line one\nline two', sha: 'abc' }] });
    expect(readableText(content)).toBe('line one\nline two\nabc');
    expect(readableText('not json')).toBe('not json');
  });
});
