import { changesExternalState } from '../domain/action.js';
import type { BlastRadius, RiskClass } from '../domain/blast-radius.js';
import type { ToolPolicy } from './permission-matrix.js';

/**
 * Deterministic blast radius for one proposed tool call.
 *
 * Rules, first match wins:
 *   BLOCKED  tool is FORBIDDEN, or not in the permission matrix (unknown scope)
 *   HIGH     destructive; data mutation without rollback; irreversible or
 *            un-rollbackable external change; more than 3 resources
 *   MEDIUM   customer-facing external change; any unknown dependency
 *   LOW      everything else (read-only, sandbox-only, contained reversible change)
 */
export function computeBlastRadius(policy: ToolPolicy | null): BlastRadius {
  if (policy === null) {
    return {
      externalSystemsTouched: [],
      resourcesAffected: 0,
      customerFacing: false,
      mutatesData: false,
      destructive: false,
      reversible: false,
      rollbackAvailable: false,
      unknownDependencies: 1,
      riskClass: 'BLOCKED',
      reasons: ['Tool is not in the permission matrix, so its scope is unknown'],
    };
  }

  const external = changesExternalState(policy.actionClass);
  const { riskClass, reasons } = classify(policy, external);

  return {
    externalSystemsTouched: policy.system !== null && external ? [policy.system] : [],
    resourcesAffected: policy.resourcesAffected,
    customerFacing: policy.customerFacing,
    mutatesData: policy.mutatesData,
    destructive: policy.destructive,
    reversible: policy.reversible,
    rollbackAvailable: policy.rollbackAvailable,
    unknownDependencies: policy.unknownDependencies,
    riskClass,
    reasons,
  };
}

function classify(
  policy: ToolPolicy,
  external: boolean,
): { riskClass: RiskClass; reasons: string[] } {
  if (policy.actionClass === 'FORBIDDEN') {
    return { riskClass: 'BLOCKED', reasons: ['Action class is FORBIDDEN'] };
  }

  const high: string[] = [];
  if (policy.destructive) high.push('Destructive action');
  if (policy.mutatesData && !policy.rollbackAvailable) high.push('Mutates data with no rollback');
  if (external && !policy.reversible) high.push('External change cannot be reversed');
  if (external && !policy.rollbackAvailable) high.push('External change has no rollback');
  if (policy.resourcesAffected > 3) high.push('Affects more than 3 resources');
  if (high.length > 0) return { riskClass: 'HIGH', reasons: high };

  const medium: string[] = [];
  if (external && policy.customerFacing) medium.push('Customer-facing external change');
  if (policy.unknownDependencies > 0) {
    medium.push(`${policy.unknownDependencies} unknown downstream dependency(ies)`);
  }
  if (medium.length > 0) return { riskClass: 'MEDIUM', reasons: medium };

  if (external) {
    return { riskClass: 'LOW', reasons: ['Contained, reversible change with a rollback'] };
  }
  return {
    riskClass: 'LOW',
    reasons: [policy.actionClass === 'SANDBOX_ONLY' ? 'Runs only inside the sandbox' : 'Read-only'],
  };
}
