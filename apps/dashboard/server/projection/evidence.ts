import {
  redactText,
  type CheckResult,
  type EvidencePackage,
  type EvidenceSource,
  type RunbookPlan,
  type TestResult,
  type VerificationReport,
} from '@runbook-ai/core';
import type {
  EvidenceBasis,
  EvidenceGateView,
  EvidenceItemView,
  EvidenceView,
  ProvenanceView,
  RequirementStatus,
  ToolCallView,
  VerificationView,
} from '../../shared/view.js';

type Expectation = 'zero' | 'nonzero' | 'any';
type Calls = ReadonlyMap<string, ToolCallView>;
type Claim = Omit<EvidenceItemView, 'basis'>;

/** Labels for the evidence package's items, keyed as runbooks name them in evidenceRequired. */
const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  reproduction: 'Incident reproduced in the sandbox',
  rootCause: 'Root cause correlated with a recent change',
  remediation: 'Candidate remediation generated',
  unitTests: 'Unit tests',
  integrationTests: 'Integration tests',
  lint: 'Lint',
  typecheck: 'Typecheck',
  healthProbe: 'Sandbox health probe',
};

const labelFor = (key: string): string => EVIDENCE_LABELS[key] ?? key;

/** What a claim rests on, read from the call it cites, never from the claim itself. */
function basisFor(claim: Claim, calls: Calls): EvidenceBasis {
  if (claim.claim === 'hypothesis') return 'MODEL_HYPOTHESIS';
  const cited = claim.provenance ? calls.get(claim.provenance.toolCallId) : undefined;
  if (!cited) return 'UNVERIFIED';
  return cited.exec ? 'SANDBOX_DERIVED' : 'TOOL_DERIVED';
}

const withBasis = (claims: readonly Claim[], calls: Calls): EvidenceItemView[] =>
  claims.map((claim) => ({ ...claim, basis: basisFor(claim, calls) }));

/**
 * Checks a claim against TrueForge's own record of the tool call it cites.
 * The claim is never taken on trust: a missing call, a different exit code, or
 * a "passed" claim backed by a failing command are all reported.
 */
export function verifySource(
  source: EvidenceSource,
  calls: Calls,
  expectation: Expectation,
): ProvenanceView {
  const base = { toolCallId: source.toolCallId };
  const call = calls.get(source.toolCallId);
  if (!call) {
    return {
      ...base,
      status: 'missing',
      recordedExitCode: null,
      note: 'No tool call with this id in the TrueForge session',
    };
  }
  if (call.status === 'running' || call.status === 'awaiting_approval') {
    return {
      ...base,
      status: 'pending',
      recordedExitCode: null,
      note: 'The cited call has not returned yet',
    };
  }
  if (call.exec) {
    const recorded = call.exec.exitCode;
    const mismatch = (note: string): ProvenanceView => ({
      ...base,
      status: 'mismatch',
      recordedExitCode: recorded,
      note,
    });
    if (call.exec.infraError !== null) return mismatch('The sandbox failed before the command ran');
    if (source.exitCode !== undefined && recorded !== source.exitCode) {
      return mismatch(
        `Claims exit ${source.exitCode}; TrueForge recorded ${describeExit(recorded)}`,
      );
    }
    if (expectation === 'zero' && recorded !== 0) {
      return mismatch(`Claims a pass; TrueForge recorded ${describeExit(recorded)}`);
    }
    if (expectation === 'nonzero' && recorded === 0) {
      return mismatch('Claims a failure; TrueForge recorded exit 0');
    }
    return { ...base, status: 'verified', recordedExitCode: recorded, note: null };
  }
  if (call.status === 'succeeded') {
    return { ...base, status: 'verified', recordedExitCode: null, note: null };
  }
  return {
    ...base,
    status: 'mismatch',
    recordedExitCode: null,
    note: `The cited call ${call.status === 'denied' ? 'was rejected' : 'failed'}`,
  };
}

function describeExit(code: number | null): string {
  return code === null ? 'no exit code' : `exit ${code}`;
}

function expectationFor(status: CheckResult['status']): Expectation {
  if (status === 'passed') return 'zero';
  if (status === 'failed') return 'nonzero';
  return 'any';
}

/** Prefers counts parsed from the output TrueForge recorded over counts the server reported. */
function checkDetail(result: CheckResult | TestResult, calls: Calls): string | null {
  const recorded = result.source ? calls.get(result.source.toolCallId)?.exec?.tests : null;
  if (recorded) {
    return `${recorded.passed}/${recorded.total} passed${recorded.failed ? ` · ${recorded.failed} failed` : ''}`;
  }
  if ('total' in result && result.total !== undefined) {
    return `${result.passed ?? 0}/${result.total} passed (as reported)`;
  }
  return result.summary ? redactText(result.summary) : null;
}

export function buildEvidenceView(
  found: { data: EvidencePackage; at: string; toolCallId: string } | null,
  calls: Calls,
): EvidenceView | null {
  if (!found) return null;
  const e = found.data;
  const items: Claim[] = [
    {
      key: 'reproduction',
      label: labelFor('reproduction'),
      claim: !e.reproduction.attempted
        ? 'not_run'
        : e.reproduction.reproduced
          ? 'passed'
          : 'failed',
      detail: e.reproduction.command ? redactText(e.reproduction.command) : null,
      provenance: e.reproduction.source ? verifySource(e.reproduction.source, calls, 'any') : null,
    },
    {
      key: 'rootCause',
      label: labelFor('rootCause'),
      claim: 'hypothesis',
      detail: redactText(e.suspectedRootCause.summary),
      provenance: null,
    },
  ];
  if (e.remediation) {
    items.push({
      key: 'remediation',
      label: labelFor('remediation'),
      claim: 'passed',
      detail: `${e.remediation.attempts} attempt${e.remediation.attempts === 1 ? '' : 's'}`,
      provenance: e.remediation.source ? verifySource(e.remediation.source, calls, 'any') : null,
    });
  }
  const v = e.validation;
  const checks: [string, CheckResult | TestResult | undefined][] = [
    ['unitTests', v.unitTests],
    ['integrationTests', v.integrationTests],
    ['lint', v.lint],
    ['typecheck', v.typecheck],
    ['healthProbe', v.healthProbe],
  ];
  for (const [key, result] of checks) {
    const label = labelFor(key);
    items.push(
      result
        ? {
            key,
            label,
            claim: result.status,
            detail: checkDetail(result, calls),
            provenance: result.source
              ? verifySource(result.source, calls, expectationFor(result.status))
              : null,
          }
        : { key, label, claim: 'not_run', detail: null, provenance: null },
    );
  }

  return {
    reportedAt: found.at,
    toolCallId: found.toolCallId,
    problemSummary: redactText(e.problemSummary),
    hypothesis: {
      summary: redactText(e.suspectedRootCause.summary),
      supportingFacts: e.suspectedRootCause.evidence.map(redactText),
      confidence: e.suspectedRootCause.confidence ?? null,
    },
    remediation: e.remediation
      ? { summary: redactText(e.remediation.summary), attempts: e.remediation.attempts }
      : null,
    items: withBasis(items, calls),
    proposedAction: {
      tool: e.proposedAction.tool,
      summary: redactText(e.proposedAction.summary),
      actionClass: e.proposedAction.actionClass,
    },
    rollbackPlan: {
      summary: redactText(e.rollbackPlan.summary),
      steps: e.rollbackPlan.steps.map(redactText),
    },
    unknowns: e.unknowns.map(redactText),
    blastRadius: e.blastRadius ?? null,
  };
}

export function buildVerificationView(
  found: { data: VerificationReport; at: string } | null,
  calls: Calls,
): VerificationView | null {
  if (!found) return null;
  const checks: Claim[] = found.data.checks.map((check, index) => ({
    key: `check-${index}`,
    label: redactText(check.name),
    claim: check.status,
    detail: check.summary ? redactText(check.summary) : null,
    provenance: check.source ? verifySource(check.source, calls, 'any') : null,
  }));
  return {
    reportedAt: found.at,
    healthy: found.data.healthy,
    checks: withBasis(checks, calls),
  };
}

/**
 * Readiness of the evidence gate, from the runbook alone: each evidence item that a
 * step before the authorization line requires must be claimed as passed, and
 * TrueForge's record of the call it cites must agree. No model is consulted.
 */
export function buildEvidenceGate(
  plan: RunbookPlan | null,
  lineIndex: number,
  evidence: EvidenceView | null,
): EvidenceGateView {
  if (!plan) return { required: [], ready: false };
  const beforeLine = [...plan.steps].sort((a, b) => a.index - b.index).slice(0, lineIndex);
  const required: EvidenceGateView['required'] = [];
  for (const step of beforeLine) {
    for (const key of step.evidenceRequired) {
      if (required.some((item) => item.key === key)) continue;
      const item = evidence?.items.find((candidate) => candidate.key === key);
      required.push({
        key,
        label: item?.label ?? labelFor(key),
        step: step.index,
        status: requirementStatus(item),
      });
    }
  }
  return {
    required,
    ready: required.length > 0 && required.every((item) => item.status === 'satisfied'),
  };
}

function requirementStatus(item: EvidenceItemView | undefined): RequirementStatus {
  if (!item || item.claim === 'not_run') return 'missing';
  const recorded = item.provenance?.status;
  if (item.claim === 'failed' || recorded === 'mismatch' || recorded === 'missing') return 'failed';
  // A hypothesis, or a pass nothing recorded confirms, never satisfies a requirement.
  return item.claim === 'passed' && recorded === 'verified' ? 'satisfied' : 'unverified';
}
