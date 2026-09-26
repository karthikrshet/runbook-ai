import { describe, expect, it } from 'vitest';
import {
  approvalCoverage,
  computeBlastRadius,
  decisionFor,
  gatedToolNames,
  isGated,
  lookupToolPolicy,
  type ConnectorNames,
  type ToolRef,
} from '../src/index.js';

const connectors: ConnectorNames = { runbookai: 'runbookai', github: 'github' };
const mcp = (server: string, tool: string): ToolRef => ({ kind: 'mcp', server, tool });

describe('lookupToolPolicy', () => {
  it('classifies RunbookAI tools only when served by the configured connector', () => {
    expect(lookupToolPolicy(mcp('runbookai', 'aws_get_logs'), connectors)?.actionClass).toBe(
      'READ_ONLY',
    );
    expect(
      lookupToolPolicy(mcp('runbookai', 'github_create_pull_request'), connectors)?.actionClass,
    ).toBe('CONSEQUENTIAL');
    // The same tool name from another connector is not trusted to be the same tool.
    expect(lookupToolPolicy(mcp('lookalike', 'github_create_pull_request'), connectors)).toBeNull();
  });

  it('follows renamed connectors', () => {
    const renamed = { runbookai: 'rb-prod', github: 'gh' };
    expect(
      lookupToolPolicy(mcp('rb-prod', 'aws_execute_demo_rollback'), renamed)?.actionClass,
    ).toBe('CONSEQUENTIAL');
    expect(lookupToolPolicy(mcp('gh', 'create_branch'), renamed)?.actionClass).toBe(
      'REVERSIBLE_EXTERNAL',
    );
  });

  it('treats the TrueForge sandbox exec tool as sandbox-only and other harness tools as read-only', () => {
    expect(
      lookupToolPolicy({ kind: 'system', server: '', tool: 'exec' }, connectors)?.actionClass,
    ).toBe('SANDBOX_ONLY');
    expect(
      lookupToolPolicy({ kind: 'system', server: '', tool: 'web_search' }, connectors)?.actionClass,
    ).toBe('READ_ONLY');
  });

  it('marks arbitrary-command and tampering tools as forbidden on any connector', () => {
    for (const tool of [
      'execute_aws_command',
      'shell',
      'delete_repository',
      'disable_cloudtrail',
      'attach_admin_policy',
    ]) {
      expect(lookupToolPolicy(mcp('anything', tool), connectors)?.actionClass, tool).toBe(
        'FORBIDDEN',
      );
    }
  });

  it('returns null for tools outside the matrix', () => {
    expect(lookupToolPolicy(mcp('github', 'star_repository'), connectors)).toBeNull();
    expect(lookupToolPolicy(mcp('runbookai', 'does_not_exist'), connectors)).toBeNull();
  });
});

describe('decisionFor', () => {
  it('never lets an unclassified tool run automatically', () => {
    expect(decisionFor(null)).toBe('require_approval');
    expect(isGated(null)).toBe(true);
  });

  it('maps every class to a fixed decision', () => {
    expect(decisionFor('READ_ONLY')).toBe('auto');
    expect(decisionFor('SANDBOX_ONLY')).toBe('auto_in_sandbox');
    expect(decisionFor('REVERSIBLE_EXTERNAL')).toBe('require_approval');
    expect(decisionFor('CONSEQUENTIAL')).toBe('require_approval');
    expect(decisionFor('FORBIDDEN')).toBe('deny');
  });
});

describe('computeBlastRadius', () => {
  const policy = (server: string, tool: string) => lookupToolPolicy(mcp(server, tool), connectors);

  it('rates a reversible, non-customer-facing pull request as LOW', () => {
    const blast = computeBlastRadius(policy('runbookai', 'github_create_pull_request'));
    expect(blast).toMatchObject({
      riskClass: 'LOW',
      externalSystemsTouched: ['GitHub'],
      resourcesAffected: 1,
      reversible: true,
      rollbackAvailable: true,
    });
    expect(blast.reasons).toEqual(['Contained, reversible change with a rollback']);
  });

  it('rates a customer-facing rollback as MEDIUM', () => {
    const blast = computeBlastRadius(policy('runbookai', 'aws_execute_demo_rollback'));
    expect(blast.riskClass).toBe('MEDIUM');
    expect(blast.reasons).toContain('Customer-facing external change');
  });

  it('rates destructive actions as HIGH', () => {
    const blast = computeBlastRadius(policy('github', 'delete_file'));
    expect(blast.riskClass).toBe('HIGH');
    expect(blast.reasons).toContain('Destructive action');
  });

  it('lists every rule that fired', () => {
    const blast = computeBlastRadius(policy('github', 'merge_pull_request'));
    expect(blast.riskClass).toBe('MEDIUM');
    expect(blast.reasons).toEqual([
      'Customer-facing external change',
      '1 unknown downstream dependency(ies)',
    ]);
  });

  it('blocks forbidden and unknown tools', () => {
    expect(computeBlastRadius(policy('x', 'execute_aws_command')).riskClass).toBe('BLOCKED');
    const unknown = computeBlastRadius(null);
    expect(unknown.riskClass).toBe('BLOCKED');
    expect(unknown.reasons[0]).toMatch(/not in the permission matrix/);
  });

  it('rates read-only and sandbox work as LOW', () => {
    expect(computeBlastRadius(policy('runbookai', 'aws_get_logs')).reasons).toEqual(['Read-only']);
    const sandbox = computeBlastRadius(
      lookupToolPolicy({ kind: 'system', server: '', tool: 'exec' }, connectors),
    );
    expect(sandbox).toMatchObject({ riskClass: 'LOW', externalSystemsTouched: [] });
  });
});

describe('approval coverage', () => {
  it('reads TrueForge requireApprovalForTools selectors', () => {
    expect(approvalCoverage('github_create_pull_request', ['github_create_pull_request'])).toBe(
      'explicit',
    );
    expect(approvalCoverage('github_create_pull_request', ['@all'])).toBe('all');
    expect(approvalCoverage('github_create_pull_request', ['@write'])).toBe('annotation');
    // TrueForge's default is ['@destructive'].
    expect(approvalCoverage('github_create_pull_request', undefined)).toBe('annotation');
    expect(approvalCoverage('github_create_pull_request', [])).toBe('missing');
    expect(gatedToolNames('runbookai')).toEqual([
      'github_create_pull_request',
      'aws_execute_demo_rollback',
    ]);
  });
});
