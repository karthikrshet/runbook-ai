import { describe, expect, it } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import type { RunView } from '../shared/view.js';
import {
  approvalState,
  incidentStatus,
  integrationIndicators,
  latestDiff,
  stepCalls,
} from '../src/lib/console.js';
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
    expect(incidentStatus(resolved).label).toBe('Resolved');
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
