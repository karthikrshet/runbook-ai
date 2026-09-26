import { describe, expect, it } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import type { RunView } from '../shared/view.js';
import {
  approvalState,
  incidentStatus,
  integrationIndicators,
  latestDiff,
  stepCalls,
  stepEvidenceVerified,
} from '../src/lib/console.js';
import { announcementFor, awaitingBody, emptyOperationText, headlineFor } from '../src/lib/copy.js';
import { parseUnifiedDiff } from '../src/lib/diff.js';
import {
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

const live = (view: RunView): RunView => ({
  ...view,
  source: { kind: 'trueforge', label: 'TrueForge at http://trueforge:8790' },
});
const stream = { connection: 'live', problem: null } as const;
const step = (view: RunView, index: number) => {
  const item = view.track.items.find((candidate) => candidate.index === index);
  if (!item) throw new Error(`no step ${String(index)}`);
  return item;
};

describe('evidence gate', () => {
  const view = project(awaitingEvents());

  it('is ready only when every item the runbook requires is verified against TrueForge', () => {
    expect(view.gate.ready).toBe(true);
    expect(view.gate.required.map((item) => [item.step, item.key, item.status])).toEqual([
      [5, 'reproduction', 'satisfied'],
      [6, 'remediation', 'satisfied'],
      [7, 'unitTests', 'satisfied'],
      [7, 'integrationTests', 'satisfied'],
      [7, 'lint', 'satisfied'],
      [7, 'typecheck', 'satisfied'],
      [7, 'healthProbe', 'satisfied'],
    ]);
  });

  it('is not ready when TrueForge contradicts a claim or cannot find its call', () => {
    const tampered = evidenceEnvelope((evidence) => ({
      ...evidence,
      validation: {
        ...evidence.validation,
        unitTests: { status: 'passed', source: { toolCallId: 'fx_call_fix1' } },
        lint: { status: 'passed', source: { toolCallId: 'fx_call_invented', exitCode: 0 } },
        typecheck: { status: 'passed' },
      },
    }));
    const gate = project(withResponse(awaitingEvents(), 'fx_call_evidence', tampered)).gate;
    const status = Object.fromEntries(gate.required.map((item) => [item.key, item.status]));
    expect(gate.ready).toBe(false);
    expect(status).toMatchObject({ unitTests: 'failed', lint: 'failed', typecheck: 'unverified' });
  });

  it('reports required evidence as missing until RunbookAI reports it', () => {
    const before = awaitingEvents().filter(
      (item) =>
        !(item.event.type === 'tool.response' && item.event.toolCallId === 'fx_call_evidence'),
    );
    const gate = project(before).gate;
    expect(gate.ready).toBe(false);
    expect(new Set(gate.required.map((item) => item.status))).toEqual(new Set(['missing']));
  });

  it('has no requirements without a compiled runbook', () => {
    expect(project([]).gate).toEqual({ required: [], ready: false });
  });

  it('classifies each claim by the call it cites, never a hypothesis as verified', () => {
    const basis = Object.fromEntries(
      view.evidence?.items.map((item) => [item.key, item.basis]) ?? [],
    );
    expect(basis).toEqual({
      reproduction: 'SANDBOX_DERIVED',
      rootCause: 'MODEL_HYPOTHESIS',
      remediation: 'SANDBOX_DERIVED',
      unitTests: 'SANDBOX_DERIVED',
      integrationTests: 'SANDBOX_DERIVED',
      lint: 'SANDBOX_DERIVED',
      typecheck: 'SANDBOX_DERIVED',
      healthProbe: 'SANDBOX_DERIVED',
    });

    const cited = evidenceEnvelope((evidence) => ({
      ...evidence,
      validation: {
        ...evidence.validation,
        healthProbe: { status: 'passed', source: { toolCallId: 'fx_call_health' } },
        lint: { status: 'passed' },
      },
    }));
    const items = project(withResponse(awaitingEvents(), 'fx_call_evidence', cited)).evidence
      ?.items;
    expect(items?.find((item) => item.key === 'healthProbe')?.basis).toBe('TOOL_DERIVED');
    expect(items?.find((item) => item.key === 'lint')?.basis).toBe('UNVERIFIED');
  });
});

describe('runbook steps', () => {
  const view = project(awaitingEvents());

  it('links each step to the calls TrueForge recorded for it', () => {
    expect(step(view, 1).toolCallIds).toEqual(['fx_call_health']);
    expect(step(view, 5).toolCallIds).toEqual(['fx_call_repro']);
    expect(step(view, 7).toolCallIds).toEqual([
      'fx_call_fix2',
      'fx_call_integ',
      'fx_call_lint',
      'fx_call_types',
      'fx_call_probe',
    ]);
    // The checkpoint step waits on the gated call.
    expect(step(view, 8).toolCallIds).toEqual(['fx_call_pr']);
    expect(stepCalls(view, step(view, 4)).map((call) => call.system)).toEqual(['GitHub']);
  });

  it('carries what each step requires', () => {
    expect(step(view, 7).evidenceKeys).toEqual([
      'unitTests',
      'integrationTests',
      'lint',
      'typecheck',
      'healthProbe',
    ]);
    expect(view.track.items.map((item) => item.requiresApproval)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('what the projection adds for the console', () => {
  it('names the external system of each call from the permission matrix', () => {
    const systems = Object.fromEntries(
      project(awaitingEvents()).toolCalls.map((call) => [call.id, call.system]),
    );
    expect(systems).toMatchObject({
      fx_call_incident: 'RunbookAI',
      fx_call_health: 'AWS',
      fx_call_commits: 'GitHub',
      fx_call_repro: null,
      fx_call_pr: 'GitHub',
    });
  });

  it('reports the connectors TrueForge initialized, the incident time and the fix', () => {
    const view = project(awaitingEvents());
    expect(view.connectors).toEqual([{ name: 'runbookai', state: 'initialized' }]);
    expect(view.incident.openedAt).toBe('2026-09-26T10:31:00Z');
    expect(view.evidence?.remediation).toEqual({
      summary: expect.stringContaining(
        'Skip the discount only when no promo code is present',
      ) as string,
      attempts: 2,
    });
  });

  it('tags the timeline with RunbookAI event kinds, not TrueForge API names', () => {
    const kinds = project(buildInc001Events()).timeline.map((entry) => entry.kind);
    for (const kind of [
      'run.started',
      'connectors.initialized',
      'incident.received',
      'runbook.parsed',
      'sandbox.created',
      'sandbox.completed',
      'evidence.added',
      'approval.required',
      'run.paused',
      'approval.approved',
      'action.completed',
      'verification.completed',
      'run.completed',
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(kinds.indexOf('approval.required')).toBeLessThan(kinds.indexOf('approval.approved'));
  });
});

describe('integration indicators', () => {
  it('never claim a connection for a fixture replay', () => {
    const indicators = integrationIndicators(project(awaitingEvents()), stream);
    expect(indicators.map((indicator) => [indicator.name, indicator.state])).toEqual([
      ['TrueForge', 'Not connected'],
      ['Sandbox', 'Demo replay'],
      ['GitHub', 'Demo replay'],
      ['AWS', 'Demo replay'],
    ]);
  });

  it('follow what TrueForge recorded in a live session', () => {
    const view = live(project(awaitingEvents()));
    const states = Object.fromEntries(
      integrationIndicators(view, stream).map((i) => [i.key, i.state]),
    );
    expect(states).toEqual({
      trueforge: 'Connected',
      sandbox: 'Ready',
      github: 'Connected',
      aws: 'Connected',
    });
    const down = integrationIndicators(view, {
      connection: 'live',
      problem: "Can't reach TrueForge",
    });
    expect(down[0]).toMatchObject({ state: 'Disconnected', tone: 'bad' });
  });

  it('report a failed sandbox and integrations nobody has used yet', () => {
    const view = live(
      project([
        toolCall('2026-09-26T10:42:01.000Z', 'c1', execTool, {
          intent: 'Run tests',
          command: 'npm test',
        }),
        toolResponse(
          '2026-09-26T10:42:02.000Z',
          'c1',
          JSON.stringify({ success: false, error: 'Sandbox provider unavailable' }),
        ),
      ]),
    );
    const states = Object.fromEntries(
      integrationIndicators(view, stream).map((i) => [i.key, i.state]),
    );
    expect(states).toEqual({
      trueforge: 'Connected',
      sandbox: 'Failed',
      github: 'Not used yet',
      aws: 'Not used yet',
    });
  });

  it('report a GitHub error when its last call failed', () => {
    const view = live(
      project([
        toolCall('2026-09-26T10:42:01.000Z', 'c1', mcpTool('github', 'get_file_contents'), {
          path: 'a',
        }),
        // TrueForge stores a failed tool call as {"error": ...}.
        toolResponse(
          '2026-09-26T10:42:02.000Z',
          'c1',
          JSON.stringify({ error: 'Bad credentials' }),
        ),
      ]),
    );
    expect(integrationIndicators(view, stream).find((i) => i.key === 'github')?.state).toBe(
      'Error',
    );
  });
});

describe('approval and incident state', () => {
  it('follows the gated call from pending to approved', () => {
    const awaiting = project(awaitingEvents());
    expect(approvalState(awaiting).key).toBe('approval.pending');
    expect(incidentStatus(awaiting).label).toBe('Awaiting approval');
    const resolved = project(buildInc001Events());
    expect(approvalState(resolved).key).toBe('approval.approved');
    // Verification covers the approved change; it does not prove the service recovered.
    expect(incidentStatus(resolved).label).toBe('Verified');
    expect(approvalState(project([])).key).toBe('approval.none');
  });
});

describe('remediation diff', () => {
  it('reads the diff a sandbox command printed', () => {
    const found = latestDiff(project(awaitingEvents()));
    expect(found?.call.id).toBe('fx_call_diff');
    expect(found?.files.map((file) => [file.path, file.additions, file.deletions])).toEqual([
      ['src/pricing.ts', 2, 1],
    ]);
  });

  it('numbers lines and keeps a removed "-- " line inside its hunk', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/db/init.sql b/db/init.sql',
        '--- a/db/init.sql',
        '+++ b/db/init.sql',
        '@@ -3,3 +3,3 @@ CREATE TABLE carts (',
        ' id int,',
        '--- promo code',
        '+-- promo code, optional',
        ' total int',
      ].join('\n'),
    );
    expect(file?.path).toBe('db/init.sql');
    expect(file?.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'id int,', oldLine: 3, newLine: 3 },
      { kind: 'remove', text: '-- promo code', oldLine: 4, newLine: null },
      { kind: 'add', text: '-- promo code, optional', oldLine: null, newLine: 4 },
      { kind: 'context', text: 'total int', oldLine: 5, newLine: 5 },
    ]);
  });

  it('finds nothing in output without a diff', () => {
    expect(parseUnifiedDiff('Tests  12 passed (12)\n--- summary ---\n')).toEqual([]);
  });
});

const at = (seconds: number): string =>
  new Date(Date.parse('2026-09-26T10:00:00.000Z') + seconds * 1000).toISOString();

describe('the action at the approval boundary', () => {
  it('is never displaced by a later tool outside the permission matrix', () => {
    const all = buildInc001Events();
    const view = project([
      ...all.slice(0, -1),
      toolCall('2026-09-26T10:44:02.500Z', 'x_slack', mcpTool('slack', 'post_message'), {
        channel: '#inc',
      }),
      toolResponse(
        '2026-09-26T10:44:02.800Z',
        'x_slack',
        JSON.stringify({ ok: true }),
        'fx_turn_2',
      ),
      ...all.slice(-1),
    ]);
    expect(view.gatedAction?.call.id).toBe('fx_call_pr');
    expect(view.phase).toBe('resolved');
    expect(view.violations.map((violation) => violation.severity)).toEqual(['gap']);
  });

  /** One model message asks for a pull request and a rollback; TrueForge holds both. */
  const heldTwo: Item[] = [
    {
      turnId: 't1',
      event: {
        type: 'model.message',
        id: 'm1',
        createdAt: at(1),
        threadId: 'main',
        toolCalls: [
          {
            id: 'c_pr',
            type: 'function',
            function: { name: 'github_create_pull_request', arguments: '{}' },
            toolInfo: mcpTool('runbookai', 'github_create_pull_request'),
          },
          {
            id: 'c_rb',
            type: 'function',
            function: { name: 'aws_execute_demo_rollback', arguments: '{}' },
            toolInfo: mcpTool('runbookai', 'aws_execute_demo_rollback'),
          },
        ],
      },
    },
    {
      turnId: 't1',
      event: {
        type: 'tool.approval_required',
        id: 'a1',
        createdAt: at(2),
        threadId: 'main',
        toolCalls: [
          { id: 'c_pr', sourceEventId: 'm1' },
          { id: 'c_rb', sourceEventId: 'm1' },
        ],
      },
    },
  ];

  it('lists every call TrueForge holds for a decision, the first one shown by default', () => {
    const view = project(heldTwo);
    expect(view.pendingActions.map((entry) => entry.call.id)).toEqual(['c_pr', 'c_rb']);
    expect(view.gatedAction?.call.id).toBe('c_pr');
    // The rollback is customer-facing, so policy rates it higher than the pull request.
    expect(view.pendingActions[1]?.blastRadius.riskClass).toBe('MEDIUM');
    expect(approvalState(view, view.pendingActions[1]).key).toBe('approval.pending');
  });

  it('announces every waiting action to screen readers, not only the first', () => {
    expect(announcementFor(project(heldTwo))).toBe(
      'Autonomy paused. 2 actions need human authorization: github_create_pull_request (blast radius LOW), aws_execute_demo_rollback (blast radius MEDIUM).',
    );
    expect(announcementFor(project(awaitingEvents()))).toBe(
      'Autonomy paused. Human authorization required for github_create_pull_request.',
    );
  });

  it('describes the waiting call on screen, even after an earlier action crossed the boundary', () => {
    const view = project([
      toolCall(at(0), 'c_pr0', mcpTool('github', 'create_pull_request'), { repo: 'acme/app' }),
      toolResponse(at(0.5), 'c_pr0', JSON.stringify({ number: 7 })),
      ...heldTwo,
    ]);
    // The crossed boundary stays on top; the boundary below still explains each waiting call.
    expect(view.phase).toBe('violated');
    expect(headlineFor(view).title).toBe('An action ran without approval');
    const rollback = view.pendingActions[1];
    expect(rollback?.call.id).toBe('c_rb');
    const body = awaitingBody(view, rollback?.call ?? null, { decisionsEnabled: true });
    expect(body).toMatch(/^The agent wants to roll back the demo service\./);
    expect(body).toContain('1 external change already ran');
    expect(body).not.toContain('without a decision');
    // Screen readers hear the crossed boundary first, then the calls still waiting.
    expect(announcementFor(view)).toBe(
      'Boundary crossed. An action ran without approval. 2 actions need human authorization: github_create_pull_request (blast radius LOW), aws_execute_demo_rollback (blast radius MEDIUM).',
    );
  });

  it('never tells a demo viewer to decide in TrueForge, since a replay has no session', () => {
    const view = project(awaitingEvents());
    for (const decisionsEnabled of [false, true]) {
      const body = headlineFor(view, { decisionsEnabled }).body;
      expect(body).toMatch(/This is a replay: in a live run, a human approves or rejects it/);
      expect(body).not.toMatch(/then approve or reject/);
    }
    expect(headlineFor(live(view)).body).toMatch(
      /Review the evidence, then approve or reject it in TrueForge\.$/,
    );
    expect(headlineFor(live(view), { decisionsEnabled: true }).body).toMatch(
      /Review the evidence below, then approve or reject\. TrueForge records the decision/,
    );
  });
});

describe('a turn paused for something other than an approval', () => {
  const started: Item = {
    turnId: 't1',
    event: {
      type: 'turn.created',
      id: 'p0',
      createdAt: at(0),
      turnId: 't1',
      previousTurnId: null,
      threadId: null,
      state: { status: 'running' },
      input: [{ type: 'user.message', content: 'Investigate INC-9' }],
    },
  };
  const pausedOn = (id: string, seconds: number): Item => ({
    turnId: 't1',
    event: {
      type: 'turn.update',
      id: `u_${id}`,
      createdAt: at(seconds),
      threadId: null,
      state: { status: 'paused', actionRequiredOnEvents: [{ id }] },
    },
  });

  it('says which connector needs authorization', () => {
    const view = project([
      started,
      {
        turnId: 't1',
        event: {
          type: 'mcp.auth_required',
          id: 'p1',
          createdAt: at(1),
          threadId: null,
          mcpServers: [{ name: 'github', id: 'gh', authUrl: 'https://trueforge.example/oauth' }],
        },
      },
      pausedOn('p1', 2),
    ]);
    expect(view.phase).toBe('paused');
    expect(view.pause).toEqual({ reason: 'connector_auth', detail: 'github' });
    expect(view.timeline.at(-1)?.title).toBe('Paused until a connector is authorized in TrueForge');
    expect(incidentStatus(view).label).toBe('Paused');
    // No call has run yet, and the agent is not working on the task either.
    expect(view.toolCalls).toEqual([]);
    expect(emptyOperationText(view.phase)).toBe(
      'No tool calls yet. TrueForge paused the run before the first one; the notice above says what it is waiting on.',
    );
  });

  it('says a turn that ended before any tool call ended, not that the agent is reading', () => {
    const ended = (state: Extract<Item['event'], { type: 'turn.done' }>['state']): Item => ({
      turnId: 't1',
      event: {
        type: 'turn.done',
        id: `d_${state.status}`,
        createdAt: at(1),
        threadId: null,
        state,
      },
    });
    const views = [
      project([
        started,
        ended({ status: 'done', completedAt: at(1), output: null, requiredActions: [] }),
      ]),
      project([
        started,
        ended({ status: 'error', completedAt: at(1), message: 'Model unavailable' }),
      ]),
      project([
        started,
        ended({ status: 'cancelled', completedAt: at(1), reason: 'client-cancelled' }),
      ]),
    ];
    expect(views.map((view) => view.phase)).toEqual(['finished', 'failed', 'failed']);
    for (const view of views) {
      expect(emptyOperationText(view.phase)).toBe('The turn ended without any tool call.');
    }
    expect(emptyOperationText(project([started]).phase)).toBe(
      'No tool calls yet. The agent is reading the task.',
    );
  });

  it('says the agent is waiting for an answer, and quotes the question', () => {
    const view = project([
      started,
      toolCall(
        at(1),
        'c_ask',
        { type: 'truefoundry-system', name: 'ask_user_question' },
        {
          question: 'Which region should I check?',
        },
      ),
      {
        turnId: 't1',
        event: {
          type: 'tool.response_required',
          id: 'p3',
          createdAt: at(2),
          threadId: 'main',
          toolCalls: [{ id: 'c_ask', sourceEventId: 'x' }],
        },
      },
      pausedOn('p3', 3),
    ]);
    expect(view.pause).toEqual({ reason: 'user_input', detail: 'Which region should I check?' });
    expect(view.timeline.at(-1)?.title).toBe(
      "Paused until the agent's question is answered in TrueForge",
    );
  });
});

describe('step evidence counts', () => {
  it('count only evidence that passed and matches TrueForge', () => {
    const tampered = evidenceEnvelope((evidence) => ({
      ...evidence,
      validation: {
        ...evidence.validation,
        unitTests: { status: 'passed', source: { toolCallId: 'fx_call_fix1' } },
      },
    }));
    const view = project(withResponse(awaitingEvents(), 'fx_call_evidence', tampered));
    expect(stepEvidenceVerified(view, step(view, 7))).toBe(4);
    expect(stepEvidenceVerified(project(awaitingEvents()), step(view, 7))).toBe(5);
  });
});
