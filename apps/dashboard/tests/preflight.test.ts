import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { describe, expect, it } from 'vitest';
import { buildPreflight } from '../server/preflight.js';
import { parseRunbook } from '../server/runbooks.js';
import { buildRunPrompt } from '../shared/run-request.js';

const connectors = { runbookai: 'runbookai', github: 'github' };

function agent(manifest: Partial<TrueForgeApi.AgentSpec>): TrueForgeApi.Agent {
  return {
    id: 'a',
    name: 'runbookai',
    description: '',
    createdBySubject: { subjectDisplayName: 'x', subjectId: 'x', subjectType: 'user' },
    manifest: { model: { name: 'openai/gpt-5.2' }, ...manifest },
  };
}

const status = (view: ReturnType<typeof buildPreflight>) =>
  Object.fromEntries(view.checks.map((check) => [check.key, check.status]));

describe('buildPreflight', () => {
  it('passes when the sandbox is on and every gated tool is named', () => {
    const view = buildPreflight(
      'runbookai',
      agent({
        config: { sandbox: { enabled: true } },
        mcpServers: [
          {
            name: 'runbookai',
            requireApprovalForTools: ['github_create_pull_request', 'aws_execute_demo_rollback'],
          },
        ],
      }),
      connectors,
    );
    expect(status(view)).toEqual({ agent: 'ok', sandbox: 'ok', connector: 'ok', approvals: 'ok' });
    expect(view.canStart).toBe(true);
  });

  it('fails without a sandbox, the connector, or the agent itself', () => {
    expect(
      status(
        buildPreflight(
          'runbookai',
          agent({ mcpServers: [{ name: 'runbookai', requireApprovalForTools: ['@all'] }] }),
          connectors,
        ),
      ).sandbox,
    ).toBe('fail');
    expect(
      status(
        buildPreflight('runbookai', agent({ config: { sandbox: { enabled: true } } }), connectors),
      ).connector,
    ).toBe('fail');
    const missing = buildPreflight('runbookai', null, connectors);
    expect(missing.canStart).toBe(false);
    expect(missing.checks[0]?.detail).toContain('TrueForge has no agent with this name');
  });

  it('warns when approval depends on tool annotations and fails when it is missing', () => {
    const byDefault = buildPreflight(
      'runbookai',
      agent({ config: { sandbox: { enabled: true } }, mcpServers: [{ name: 'runbookai' }] }),
      connectors,
    );
    expect(status(byDefault).approvals).toBe('warn');
    expect(byDefault.canStart).toBe(true);

    const none = buildPreflight(
      'runbookai',
      agent({
        config: { sandbox: { enabled: true } },
        mcpServers: [{ name: 'runbookai', requireApprovalForTools: ['aws_get_logs'] }],
      }),
      connectors,
    );
    expect(status(none).approvals).toBe('fail');
    expect(none.canStart).toBe(false);
  });

  it('treats tools the connector does not expose as unable to run', () => {
    const view = buildPreflight(
      'runbookai',
      agent({
        config: { sandbox: { enabled: true } },
        mcpServers: [
          {
            name: 'runbookai',
            requireApprovalForTools: [],
            disableTools: ['github_create_pull_request', 'aws_execute_demo_rollback'],
          },
        ],
      }),
      connectors,
    );
    expect(view.gates.map((gate) => gate.coverage)).toEqual(['disabled', 'disabled']);
    expect(view.canStart).toBe(true);
  });
});

describe('run requests', () => {
  it('builds the prompt the agent receives', () => {
    expect(
      buildRunPrompt({
        runbookId: 'checkout-incident.md',
        incidentId: 'INC-001',
        description: '  checkout-api  returns 500 ',
      }),
    ).toBe(
      'Execute runbook checkout-incident.md for INC-001. checkout-api returns 500. Resolve whatever you safely can. Never make a consequential external change without my approval.',
    );
  });

  it('reads a runbook title and numbered steps', () => {
    expect(parseRunbook('x.md', '# Title\n\nIntro\n1. First.\n2. Second.\n- not a step\n')).toEqual(
      {
        id: 'x.md',
        title: 'Title',
        steps: ['First.', 'Second.'],
      },
    );
  });
});

describe('connectors outside the permission matrix', () => {
  const base = { config: { sandbox: { enabled: true } } };
  const runbookai = { name: 'runbookai', requireApprovalForTools: ['@all'] };

  it('warns when TrueForge would run an unclassified connector without asking', () => {
    const view = buildPreflight(
      'runbookai',
      agent({ ...base, mcpServers: [runbookai, { name: 'pagerduty' }] }),
      connectors,
    );
    expect(status(view)).toMatchObject({ unclassified: 'warn' });
    expect(view.checks.find((check) => check.key === 'unclassified')?.detail).toContain(
      'pagerduty',
    );
    expect(view.canStart).toBe(true);
  });

  it('accepts one that requires approval for all its tools, and adds no check without one', () => {
    const guarded = buildPreflight(
      'runbookai',
      agent({
        ...base,
        mcpServers: [runbookai, { name: 'pagerduty', requireApprovalForTools: ['@all'] }],
      }),
      connectors,
    );
    expect(status(guarded)).toMatchObject({ unclassified: 'ok' });
    const none = buildPreflight(
      'runbookai',
      agent({ ...base, mcpServers: [runbookai] }),
      connectors,
    );
    expect(Object.keys(status(none))).not.toContain('unclassified');
  });
});
