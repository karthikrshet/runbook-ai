import type { RiskClass } from '@runbook-ai/core';
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { describe, expect, it } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import { isProposedAction } from '../shared/view.js';
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
  type Item,
} from './helpers.js';

const after = (seconds: number): string =>
  new Date(Date.parse('2026-09-26T10:44:00.000Z') + seconds * 1000).toISOString();

/** A call TrueForge holds for a decision. */
function held(at: string, callId: string, toolInfo: TrueForgeApi.ToolInfo): Item[] {
  return [
    toolCall(at, callId, toolInfo, {}),
    {
      turnId: 'fx_turn_1',
      event: {
        type: 'tool.approval_required',
        id: `ar_${callId}`,
        createdAt: at,
        threadId: 'main',
        toolCalls: [{ id: callId, sourceEventId: 'x' }],
      },
    },
  ];
}

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
    // Neither a crossed boundary nor a known external change.
    expect(view.counts.gatedExecuted).toBe(0);
    expect(view.timeline.map((entry) => entry.kind)).not.toContain('boundary.crossed');
    expect(view.timeline.at(-1)).toMatchObject({
      kind: 'tool.completed',
      title: 'github · list_tags ran; it is not in the permission matrix',
      tone: 'caution',
    });
  });

  it('counts only the approved change when an unclassified tool also ran', () => {
    const all = buildInc001Events();
    const view = project([
      ...all.slice(0, -1),
      toolCall('2026-09-26T10:44:02.500Z', 'x_slack', mcpTool('slack', 'post_message'), {}),
      toolResponse('2026-09-26T10:44:02.800Z', 'x_slack', '{"ok":true}', 'fx_turn_2'),
      ...all.slice(-1),
    ]);
    expect(view.phase).toBe('resolved');
    expect(view.counts.gatedExecuted).toBe(1);
    expect(view.timeline.map((entry) => entry.kind)).not.toContain('boundary.crossed');
  });

  it('keeps an unclassified tool a human approved as a change made after approval', () => {
    const view = project([
      ...held('2026-09-26T10:42:01.000Z', 'call_x', mcpTool('slack', 'post_message')),
      approvalDecision('2026-09-26T10:42:05.000Z', 'call_x', { status: 'allow' }),
      toolResponse('2026-09-26T10:42:06.000Z', 'call_x', '{"ok":true}', 'fx_turn_2'),
    ]);
    expect(view.timeline.at(-1)).toMatchObject({
      kind: 'action.completed',
      title: 'slack · post_message ran after approval',
    });
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

describe('a blast radius reported by RunbookAI', () => {
  /** The fixture's events with a reported radius for the proposed tool. */
  const reporting = (riskClass: RiskClass, tool = 'github_create_pull_request'): Item[] =>
    withResponse(
      awaitingEvents(),
      'fx_call_evidence',
      evidenceEnvelope((evidence) => ({
        ...evidence,
        proposedAction: { ...evidence.proposedAction, tool },
        blastRadius: {
          externalSystemsTouched: ['GitHub'],
          resourcesAffected: 1,
          customerFacing: false,
          mutatesData: false,
          destructive: false,
          reversible: true,
          rollbackAvailable: true,
          unknownDependencies: 0,
          riskClass,
          reasons: ['Reported by RunbookAI'],
        },
      })),
    );
  const radius = (view: ReturnType<typeof project>, callId: string) => {
    const entry = view.pendingActions.find((action) => action.call.id === callId);
    return [entry?.blastRadiusSource, entry?.blastRadius.riskClass];
  };

  it('is shown for the proposed action when it is at least as severe as policy', () => {
    expect(radius(project(reporting('LOW')), 'fx_call_pr')).toEqual(['runbookai', 'LOW']);
    expect(radius(project(reporting('HIGH')), 'fx_call_pr')).toEqual(['runbookai', 'HIGH']);
  });

  it('never reaches a same-named tool on a connector outside the permission matrix', () => {
    const view = project([
      ...reporting('LOW'),
      ...held(after(1), 'c_evil', mcpTool('evil', 'github_create_pull_request')),
    ]);
    expect(radius(view, 'fx_call_pr')).toEqual(['runbookai', 'LOW']);
    expect(radius(view, 'c_evil')).toEqual(['policy', 'BLOCKED']);
    // The same match decides where the console shows RunbookAI's summary of the action.
    const matches = (callId: string) => {
      const call = view.toolCalls.find((candidate) => candidate.id === callId);
      return call ? isProposedAction(view.evidence, call) : null;
    };
    expect([matches('fx_call_pr'), matches('c_evil')]).toEqual([true, false]);
  });

  it('never softens a forbidden call that names the proposed tool', () => {
    const view = project([
      ...reporting('LOW', 'delete_repository'),
      ...held(after(1), 'c_del', mcpTool('github', 'delete_repository')),
    ]);
    expect(view.pendingActions[1]?.call.actionClass).toBe('FORBIDDEN');
    expect(radius(view, 'c_del')).toEqual(['policy', 'BLOCKED']);
  });

  it('never lowers the risk policy computed for the proposed tool', () => {
    const view = project([
      ...reporting('LOW', 'aws_execute_demo_rollback'),
      ...held(after(1), 'c_rb', mcpTool('runbookai', 'aws_execute_demo_rollback')),
    ]);
    // Customer-facing, so the permission matrix rates the rollback MEDIUM.
    expect(radius(view, 'c_rb')).toEqual(['policy', 'MEDIUM']);
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

  describe('the external change step', () => {
    const approved = [
      toolCall('2026-09-26T10:42:01.000Z', 'c1', mcpTool('github', 'get_file_contents'), {
        path: 'a.ts',
      }),
      toolResponse('2026-09-26T10:42:02.000Z', 'c1', 'export const a = 1;'),
      ...held('2026-09-26T10:42:03.000Z', 'c_pr', mcpTool('github', 'create_pull_request')),
      approvalDecision('2026-09-26T10:42:10.000Z', 'c_pr', { status: 'allow' }),
    ];
    const act = (events: readonly Item[]) =>
      project(events).track.items.find((item) => item.key === 'act')?.status;

    it('is running, not succeeded, while an approved change has not returned', () => {
      const view = project(approved);
      expect(view.track.items.find((item) => item.key === 'act')?.status).toBe('active');
      expect(view.track.items.filter((item) => item.status === 'done').map((i) => i.key)).toEqual([
        'investigate',
      ]);
    });

    it('failed when TrueForge recorded an error for the approved change', () => {
      const failed = toolResponse(
        '2026-09-26T10:42:11.000Z',
        'c_pr',
        JSON.stringify({ error: 'Validation Failed' }),
        'fx_turn_2',
      );
      expect(act([...approved, failed])).toBe('failed');
    });

    it('succeeded once the approved change returned', () => {
      const done = toolResponse('2026-09-26T10:42:11.000Z', 'c_pr', '{"number":7}', 'fx_turn_2');
      expect(act([...approved, done])).toBe('done');
    });
  });
});

describe('a paused turn', () => {
  const started: Item = {
    turnId: 't1',
    event: {
      type: 'turn.created',
      id: 'p0',
      createdAt: after(0),
      turnId: 't1',
      previousTurnId: null,
      threadId: null,
      state: { status: 'running' },
      input: [{ type: 'user.message', content: 'Investigate INC-9' }],
    },
  };
  const authRequired = (id: string, server: string): TrueForgeApi.McpAuthRequiredEvent => ({
    type: 'mcp.auth_required',
    id,
    createdAt: after(1),
    threadId: null,
    mcpServers: [{ name: server, id: server, authUrl: 'https://trueforge.example/oauth' }],
  });
  const approvalRequired: TrueForgeApi.ToolApprovalRequiredEvent = {
    type: 'tool.approval_required',
    id: 'a1',
    createdAt: after(1),
    threadId: 'main',
    toolCalls: [{ id: 'c_pr', sourceEventId: 'm1' }],
  };
  const emitted = (event: TrueForgeApi.ActionRequiredEvent): Item => ({ turnId: 't1', event });
  /** How TrueForge reports a pause: the finished turn lists the actions it waits on. */
  const finished = (requiredActions: TrueForgeApi.ActionRequiredEvent[]): Item => ({
    turnId: 't1',
    event: {
      type: 'turn.done',
      id: 'd1',
      createdAt: after(3),
      threadId: null,
      state: { status: 'done', completedAt: after(3), output: null, requiredActions },
    },
  });
  const pauses = (view: ReturnType<typeof project>) =>
    view.timeline.filter((entry) => entry.kind === 'run.paused').map((entry) => entry.title);

  it('announces a pause that TrueForge reports only when the turn finishes', () => {
    const auth = authRequired('p1', 'github');
    const view = project([started, emitted(auth), finished([auth])]);
    expect(view.phase).toBe('paused');
    expect(view.pause).toEqual({ reason: 'connector_auth', detail: 'github' });
    expect(pauses(view)).toEqual(['Paused until a connector is authorized in TrueForge']);
  });

  it('announces the stop for approval, with no other pause reason', () => {
    const view = project(awaitingEvents());
    expect(pauses(view)).toEqual(['Paused until a decision is made in TrueForge']);
    expect(view.pause).toBeNull();
  });

  it('announces a pause once when a turn.update reported it first', () => {
    const auth = authRequired('p1', 'github');
    const update: Item = {
      turnId: 't1',
      event: {
        type: 'turn.update',
        id: 'u1',
        createdAt: after(2),
        threadId: null,
        state: { status: 'paused', actionRequiredOnEvents: [{ id: 'p1' }] },
      },
    };
    expect(pauses(project([started, emitted(auth), update, finished([auth])]))).toHaveLength(1);
  });

  it('names a connector login that waits together with an approval', () => {
    const auth = authRequired('au1', 'slack');
    const view = project([
      started,
      toolCall(after(1), 'c_pr', mcpTool('github', 'create_pull_request'), {}),
      emitted(approvalRequired),
      emitted(auth),
      finished([approvalRequired, auth]),
    ]);
    expect(view.phase).toBe('awaiting_authorization');
    // Approving alone will not resume the run.
    expect(view.pause).toEqual({ reason: 'connector_auth', detail: 'slack' });
    expect(pauses(view)).toEqual([
      'Paused until a decision is made and a connector is authorized in TrueForge',
    ]);
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
