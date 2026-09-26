import { describe, expect, it } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import { automaticCallCount } from '../src/lib/console.js';
import { buildReportMarkdown, reportActions } from '../src/lib/report.js';
import { awaitingEvents, mcpTool, project } from './helpers.js';

const at = (seconds: number): string =>
  new Date(Date.parse('2026-09-26T10:00:00.000Z') + seconds * 1000).toISOString();

/** The part of the Markdown report above the timeline, which repeats every call. */
const summary = (markdown: string): string => markdown.split('## Timeline')[0] ?? '';

/** TrueForge holding two calls at once: a pull request, then a customer-facing rollback. */
const twoPending = project([
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
]);

describe('gated actions in the incident report', () => {
  it('lists every call TrueForge holds, each once, with its own blast radius', () => {
    expect(reportActions(twoPending).map((entry) => entry.call.id)).toEqual(['c_pr', 'c_rb']);

    const text = summary(buildReportMarkdown(twoPending));
    expect(text).toContain('## Gated actions (2)');
    expect(text).toContain('runbookai · github_create_pull_request');
    expect(text).toContain('runbookai · aws_execute_demo_rollback');
    expect(text).toContain('Blast radius: **LOW**');
    expect(text).toContain('Blast radius: **MEDIUM**');
    expect(text.match(/Decision: waiting in TrueForge/g)).toHaveLength(2);
    // TrueForge's order, as the console switcher lists them: not re-sorted by risk.
    expect(text.indexOf('github_create_pull_request')).toBeLessThan(
      text.indexOf('aws_execute_demo_rollback'),
    );
  });

  it('keeps TrueForge order however the view lists the held calls', () => {
    const [pr, rollback] = twoPending.pendingActions;
    if (!pr || !rollback) throw new Error('expected two held calls');
    const shuffled = { ...twoPending, gatedAction: rollback, pendingActions: [rollback, pr] };
    expect(reportActions(shuffled).map((entry) => entry.call.id)).toEqual(['c_pr', 'c_rb']);
  });

  it('keeps the singular section for one gated action', () => {
    const view = project(awaitingEvents());
    expect(reportActions(view).map((entry) => entry.call.id)).toEqual(['fx_call_pr']);
    const text = summary(buildReportMarkdown(view));
    expect(text).toContain('## Gated action\n');
    expect(text).not.toContain('## Gated actions');
  });
});

describe('agent actions in the incident report', () => {
  it('counts sandbox commands once, as the console and the printed report do', () => {
    const view = project(awaitingEvents());
    expect(automaticCallCount(view)).toBe(view.counts.automatic - view.sandbox.execCallIds.length);
    expect(buildReportMarkdown(view)).toContain(
      '| Agent actions | 8 automatic calls, 9 sandbox commands, 0 external changes |',
    );
  });

  it('counts the full run the same way', () => {
    expect(buildReportMarkdown(project(buildInc001Events()))).toContain(
      '| Agent actions | 9 automatic calls, 9 sandbox commands, 1 external change |',
    );
  });
});
