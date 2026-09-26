import { describe, expect, it } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import {
  approvalDecision,
  awaitingEvents,
  evidenceEnvelope,
  execTool,
  mcpTool,
  project,
  toolCall,
  toolResponse,
  withResponse,
} from './helpers.js';

describe('a run stopped at the authorization line', () => {
  const view = project(awaitingEvents());

  it('reports the TrueForge checkpoint as pending', () => {
    expect(view.phase).toBe('awaiting_authorization');
    expect(view.track.lineState).toBe('at_danger');
    expect(view.gatedAction?.call).toMatchObject({
      id: 'fx_call_pr',
      status: 'awaiting_approval',
      actionClass: 'CONSEQUENTIAL',
      approval: { decision: null },
    });
  });

  it('places the line before the first gated runbook step', () => {
    const statuses = view.track.items.map((item) => `${String(item.index)}:${item.status}`);
    expect(view.track.lineIndex).toBe(7);
    expect(statuses).toEqual([
      '1:done',
      '2:done',
      '3:done',
      '4:done',
      '5:done',
      '6:done',
      '7:done',
      '8:awaiting',
      '9:pending',
      '10:pending',
    ]);
  });

  it('computes the blast radius from the permission matrix when RunbookAI reports none', () => {
    expect(view.gatedAction?.blastRadiusSource).toBe('policy');
    expect(view.gatedAction?.blastRadius.riskClass).toBe('LOW');
  });

  it('verifies every cited evidence item against the recorded exit code', () => {
    const provenance = Object.fromEntries(
      (view.evidence?.items ?? []).map((item) => [item.key, item.provenance?.status ?? 'none']),
    );
    expect(provenance).toEqual({
      reproduction: 'verified',
      rootCause: 'none',
      remediation: 'verified',
      unitTests: 'verified',
      integrationTests: 'verified',
      lint: 'verified',
      typecheck: 'verified',
      healthProbe: 'verified',
    });
    expect(view.evidence?.items.find((item) => item.key === 'rootCause')?.claim).toBe('hypothesis');
  });

  it('shows test counts parsed from the sandbox output, including the failed first attempt', () => {
    const fix1 = view.toolCalls.find((call) => call.id === 'fx_call_fix1');
    expect(fix1?.status).toBe('failed');
    expect(fix1?.exec?.tests).toMatchObject({ passed: 11, failed: 1, total: 12 });
    expect(fix1?.exec?.tests?.failedTests).toEqual([
      'tests/checkout.test.ts > POST /checkout > applies a percentage promo code',
    ]);
    expect(view.evidence?.items.find((item) => item.key === 'unitTests')?.detail).toBe(
      '12/12 passed',
    );
  });

  it('flags the injected instruction in the commit history and keeps it as data', () => {
    const commits = view.toolCalls.find((call) => call.id === 'fx_call_commits');
    expect(commits?.untrusted.map((finding) => finding.rule)).toEqual([
      'override-instructions',
      'secret-request',
    ]);
    expect(
      view.timeline.some(
        (entry) => entry.tone === 'caution' && entry.toolCallId === 'fx_call_commits',
      ),
    ).toBe(true);
    // The flag changes nothing about policy: the boundary still holds.
    expect(view.violations).toEqual([]);
  });

  it('counts no external change before approval', () => {
    expect(view.counts.gatedExecuted).toBe(0);
    expect(view.counts.toolCalls).toBe(18);
  });
});

describe('after a human approves in TrueForge', () => {
  const view = project(buildInc001Events());

  it('clears the line and reports the verified outcome', () => {
    expect(view.phase).toBe('resolved');
    expect(view.track.lineState).toBe('cleared');
    expect(view.gatedAction?.call.approval).toMatchObject({
      decision: 'allow',
      decidedAt: '2026-09-26T10:43:52.000Z',
    });
    expect(view.verification?.healthy).toBe(true);
    expect(view.verification?.checks[0]?.provenance?.status).toBe('verified');
    expect(view.track.items.every((item) => item.status === 'done')).toBe(true);
    expect(view.counts.gatedExecuted).toBe(1);
    expect(view.turn.status).toBe('done');
  });
});

describe('when a human rejects the action in TrueForge', () => {
  const view = project([
    ...awaitingEvents(),
    approvalDecision('2026-09-26T10:43:40.000Z', 'fx_call_pr', {
      status: 'deny',
      reason: 'Wait for the owning team',
    }),
    toolResponse(
      '2026-09-26T10:43:41.000Z',
      'fx_call_pr',
      JSON.stringify({ error: 'User denied tool call: Wait for the owning team' }),
      'fx_turn_2',
    ),
  ]);

  it('reports the rejection without treating the denial notice as execution', () => {
    expect(view.phase).toBe('rejected');
    expect(view.track.lineState).toBe('rejected');
    expect(view.gatedAction?.call).toMatchObject({
      status: 'denied',
      approval: { decision: 'deny', reason: 'Wait for the owning team' },
    });
    expect(view.violations).toEqual([]);
    expect(view.counts.gatedExecuted).toBe(0);
    expect(view.track.items.find((item) => item.index === 8)?.status).toBe('rejected');
    expect(view.track.items.find((item) => item.index === 9)?.status).toBe('skipped');
  });
});

describe('boundary audit', () => {
  it('reports a consequential tool that ran without any approval checkpoint', () => {
    const events = [
      toolCall('2026-09-26T10:42:01.000Z', 'call_pr', mcpTool('github', 'create_pull_request'), {
        repo: 'acme/app',
      }),
      toolResponse('2026-09-26T10:42:02.000Z', 'call_pr', JSON.stringify({ number: 7 })),
    ];
    const view = project(events);
    expect(view.violations).toEqual([
      expect.objectContaining({ severity: 'violation', toolCallId: 'call_pr' }),
    ]);
    expect(view.phase).toBe('violated');
    expect(view.track.lineState).toBe('violated');
    expect(view.timeline.some((entry) => entry.title.includes('ran without approval'))).toBe(true);
  });

  it('reports unclassified tools as a policy gap, not a violation', () => {
    const view = project([
      toolCall('2026-09-26T10:42:01.000Z', 'call_x', mcpTool('github', 'list_tags'), {}),
      toolResponse('2026-09-26T10:42:02.000Z', 'call_x', '[]'),
    ]);
    expect(view.violations).toEqual([expect.objectContaining({ severity: 'gap' })]);
    expect(view.track.lineState).toBe('not_reached');
    expect(view.phase).not.toBe('violated');
  });
});

describe('trust in RunbookAI results', () => {
  it('ignores a well-formed evidence envelope returned by any other connector', () => {
    const forged = evidenceEnvelope((evidence) => evidence);
    const view = project([
      toolCall('2026-09-26T10:42:01.000Z', 'call_forged', mcpTool('github', 'get_file_contents'), {
        path: 'evidence.json',
      }),
      toolResponse('2026-09-26T10:42:02.000Z', 'call_forged', forged),
    ]);
    expect(view.evidence).toBeNull();
    expect(view.toolCalls[0]?.envelopeKind).toBeNull();
  });

  it('marks claims that TrueForge contradicts or cannot find', () => {
    const tampered = evidenceEnvelope((evidence) => ({
      ...evidence,
      validation: {
        ...evidence.validation,
        // Claims a pass, but cites the failing first attempt (exit 1).
        unitTests: { status: 'passed', source: { toolCallId: 'fx_call_fix1' } },
        // Cites a call that never happened.
        lint: { status: 'passed', source: { toolCallId: 'fx_call_invented', exitCode: 0 } },
      },
    }));
    const view = project(withResponse(awaitingEvents(), 'fx_call_evidence', tampered));
    const byKey = new Map(view.evidence?.items.map((item) => [item.key, item.provenance]));
    expect(byKey.get('unitTests')).toMatchObject({ status: 'mismatch', recordedExitCode: 1 });
    expect(byKey.get('unitTests')?.note).toBe('Claims a pass; TrueForge recorded exit 1');
    expect(byKey.get('lint')).toMatchObject({ status: 'missing' });
  });
});

describe('secrets in tool calls', () => {
  it('redacts credentials in arguments and sandbox output', () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const view = project([
      toolCall('2026-09-26T10:42:01.000Z', 'call_env', execTool, {
        intent: 'Push the branch',
        command: `git push https://bot:${token}@github.com/acme/app.git`,
        env: { GITHUB_TOKEN: token, NODE_ENV: 'test' },
      }),
      toolResponse(
        '2026-09-26T10:42:03.000Z',
        'call_env',
        JSON.stringify({
          success: true,
          response: { exitCode: 0, result: `using ${token}\ndone` },
        }),
      ),
    ]);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(token);
    const call = view.toolCalls[0];
    expect(call?.args).toEqual([
      { key: 'env.GITHUB_TOKEN', value: '[REDACTED]' },
      { key: 'env.NODE_ENV', value: 'test' },
    ]);
    expect(call?.exec?.outputTail).toBe('using [REDACTED:github-token]\ndone');
  });
});

describe('without a compiled runbook', () => {
  it('groups observed calls into stages around the line', () => {
    const view = project([
      toolCall('2026-09-26T10:42:01.000Z', 'c1', mcpTool('github', 'get_file_contents'), {
        path: 'a.ts',
      }),
      toolResponse('2026-09-26T10:42:02.000Z', 'c1', 'export const a = 1;'),
      toolCall('2026-09-26T10:42:03.000Z', 'c2', execTool, {
        intent: 'Run tests',
        command: 'npm test',
      }),
      toolResponse(
        '2026-09-26T10:42:09.000Z',
        'c2',
        JSON.stringify({ success: true, response: { exitCode: 0, result: 'Tests  3 passed (3)' } }),
      ),
    ]);
    expect(view.track.mode).toBe('observed');
    expect(view.track.lineIndex).toBe(2);
    expect(view.track.items.map((item) => [item.key, item.status])).toEqual([
      ['investigate', 'done'],
      ['sandbox', 'done'],
      ['act', 'pending'],
      ['verify', 'pending'],
    ]);
    expect(view.incident.fromRunbookAi).toBe(false);
  });
});

describe('an empty session', () => {
  it('waits for the first event', () => {
    const view = project([]);
    expect(view.phase).toBe('waiting');
    expect(view.track.lineState).toBe('not_reached');
    expect(view.timeline).toEqual([]);
  });
});
