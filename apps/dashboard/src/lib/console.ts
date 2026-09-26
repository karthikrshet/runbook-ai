import type { PolicyDecision } from '@runbook-ai/core';
import type {
  EvidenceBasis,
  EvidenceItemView,
  RunView,
  ToolCallView,
  TrackItemView,
} from '../../shared/view';
import type { Tone } from './copy';
import { parseUnifiedDiff, type FileDiff } from './diff';
import { clock } from './format';

/**
 * Pure derivations for the operator console. Each reads only the view the server
 * built from TrueForge's event log, so every state shown can be traced to it.
 */

export interface StatusPill {
  label: string;
  tone: Tone;
}

/** The incident's state in the words an operator uses, from the run's phase. */
export function incidentStatus(view: RunView): StatusPill {
  switch (view.phase) {
    case 'waiting':
      return { label: 'Waiting', tone: 'neutral' };
    case 'acting': {
      const reproduced = view.evidence?.items.some(
        (item) => item.key === 'reproduction' && item.claim === 'passed',
      );
      return { label: reproduced ? 'Reproduced' : 'Investigating', tone: 'caution' };
    }
    case 'awaiting_authorization':
      return { label: 'Awaiting approval', tone: 'gate' };
    case 'authorized':
      return view.verification
        ? {
            label: view.verification.healthy ? 'Verifying' : 'Verification failed',
            tone: view.verification.healthy ? 'good' : 'bad',
          }
        : { label: 'Remediating', tone: 'good' };
    case 'resolved':
      // RunbookAI verified the approved change; whether the service has recovered is
      // outside what the verification report proves, so this does not claim "Resolved".
      return { label: 'Verified', tone: 'good' };
    case 'paused':
      return { label: 'Paused', tone: 'caution' };
    case 'rejected':
      return { label: 'Rejected', tone: 'bad' };
    case 'finished':
      return { label: 'Finished', tone: 'neutral' };
    case 'failed':
      return { label: 'Failed', tone: 'bad' };
    case 'violated':
      return { label: 'Boundary crossed', tone: 'bad' };
  }
}

export type IndicatorTone = 'good' | 'caution' | 'bad' | 'neutral' | 'demo';

export interface Indicator {
  key: 'trueforge' | 'sandbox' | 'github' | 'aws';
  name: string;
  state: string;
  tone: IndicatorTone;
  /** What the state rests on, for the tooltip and the data-sources panel. */
  basis: string;
}

export interface StreamState {
  connection: 'connecting' | 'live' | 'retrying';
  problem: string | null;
}

/**
 * Integration indicators. None says "connected" unless TrueForge's record for this
 * session shows it; a fixture replay never claims a connection at all.
 */
export function integrationIndicators(view: RunView, stream: StreamState): Indicator[] {
  if (view.source.kind === 'fixture') {
    const basis = 'Demo mode replays a synthetic fixture. Nothing is contacted.';
    return [
      { key: 'trueforge', name: 'TrueForge', state: 'Not connected', tone: 'demo', basis },
      { key: 'sandbox', name: 'Sandbox', state: 'Demo replay', tone: 'demo', basis },
      { key: 'github', name: 'GitHub', state: 'Demo replay', tone: 'demo', basis },
      { key: 'aws', name: 'AWS', state: 'Demo replay', tone: 'demo', basis },
    ];
  }
  return [
    trueforgeIndicator(view, stream),
    sandboxIndicator(view),
    systemIndicator(view, 'github', 'GitHub'),
    systemIndicator(view, 'aws', 'AWS'),
  ];
}

function trueforgeIndicator(view: RunView, stream: StreamState): Indicator {
  const base = { key: 'trueforge', name: 'TrueForge' } as const;
  if (stream.problem) return { ...base, state: 'Disconnected', tone: 'bad', basis: stream.problem };
  if (stream.connection === 'retrying') {
    return {
      ...base,
      state: 'Reconnecting',
      tone: 'caution',
      basis: 'Lost the dashboard server; reconnecting.',
    };
  }
  if (stream.connection === 'connecting') {
    return { ...base, state: 'Connecting', tone: 'caution', basis: 'Opening the session stream.' };
  }
  return {
    ...base,
    state: 'Connected',
    tone: 'good',
    basis: `Reading session ${view.session.id} from ${view.source.label}.`,
  };
}

function sandboxIndicator(view: RunView): Indicator {
  const base = { key: 'sandbox', name: 'Sandbox' } as const;
  const runs = view.toolCalls.filter((call) => call.exec !== null);
  const last = runs.at(-1);
  if (runs.some((call) => call.status === 'running')) {
    return {
      ...base,
      state: 'Running',
      tone: 'caution',
      basis: 'A sandbox command is running in TrueForge.',
    };
  }
  if (last?.exec?.infraError) {
    return {
      ...base,
      state: 'Failed',
      tone: 'bad',
      basis: `The last command did not run: ${last.exec.infraError}`,
    };
  }
  if (view.sandbox.sandboxId || last) {
    const id = view.sandbox.sandboxId ? `Sandbox ${view.sandbox.sandboxId}` : 'The sandbox';
    return {
      ...base,
      state: 'Ready',
      tone: 'good',
      basis: `${id} ran ${runs.length} command${runs.length === 1 ? '' : 's'} in this session.`,
    };
  }
  return {
    ...base,
    state: 'Not used yet',
    tone: 'neutral',
    basis: 'TrueForge has recorded no sandbox activity in this session.',
  };
}

function systemIndicator(view: RunView, key: 'github' | 'aws', system: string): Indicator {
  const base = { key, name: system };
  const calls = view.toolCalls.filter((call) => call.system === system);
  const finished = calls.filter((call) => call.status === 'succeeded' || call.status === 'failed');
  const last = finished.at(-1);
  if (!last) {
    return {
      ...base,
      state: 'Not used yet',
      tone: 'neutral',
      basis: `No ${system} tool has returned in this session.`,
    };
  }
  if (last.status === 'failed') {
    return {
      ...base,
      state: 'Error',
      tone: 'bad',
      basis: `The last ${system} call failed: ${last.resultPreview ?? last.ref.tool}`,
    };
  }
  const ok = finished.filter((call) => call.status === 'succeeded').length;
  return {
    ...base,
    state: 'Connected',
    tone: 'good',
    basis: `${ok} ${system} call${ok === 1 ? '' : 's'} succeeded in this session, as TrueForge recorded.`,
  };
}

/** The tool calls TrueForge recorded for a step, oldest first. */
export function stepCalls(view: RunView, item: TrackItemView): ToolCallView[] {
  const ids = new Set(item.toolCallIds);
  return view.toolCalls.filter((call) => ids.has(call.id));
}

/** Wall time from the first call's request to the last recorded result; null while unknown. */
export function callsDuration(calls: readonly ToolCallView[]): number | null {
  const start = Math.min(...calls.map((call) => Date.parse(call.requestedAt)));
  const ends = calls.map((call) => (call.completedAt ? Date.parse(call.completedAt) : Number.NaN));
  if (calls.length === 0 || ends.some(Number.isNaN)) return null;
  return Math.max(...ends) - start;
}

/** The evidence items a step requires, in the order the runbook lists them. */
export function stepEvidence(view: RunView, item: TrackItemView): EvidenceItemView[] {
  const items = view.evidence?.items ?? [];
  return item.evidenceKeys.flatMap((key) => items.filter((candidate) => candidate.key === key));
}

/**
 * How much of a step's required evidence holds up: claimed passed AND matched by
 * TrueForge's record of the call it cites. A failed or unchecked item does not count.
 */
export function stepEvidenceVerified(view: RunView, item: TrackItemView): number {
  return stepEvidence(view, item).filter(
    (entry) => entry.claim === 'passed' && entry.provenance?.status === 'verified',
  ).length;
}

/** Where a call ran, in plain words. */
export function runtimeFor(call: ToolCallView): string {
  if (call.exec) return 'TrueForge sandbox';
  if (call.ref.kind === 'system') return 'TrueForge harness';
  return call.system
    ? `${call.system} via the ${call.ref.server} connector`
    : `${call.ref.server} connector`;
}

/** The operation to show while the agent works: the running call, else the latest one. */
export function currentCall(view: RunView): ToolCallView | null {
  const running = view.toolCalls.filter((call) => call.status === 'running');
  return running.at(-1) ?? view.toolCalls.at(-1) ?? null;
}

/** The runbook step a tool call is linked to, if any. */
export function stepForCall(view: RunView, toolCallId: string | null): TrackItemView | null {
  if (!toolCallId) return null;
  return view.track.items.find((item) => item.toolCallIds.includes(toolCallId)) ?? null;
}

export type ApprovalKey =
  | 'approval.none'
  | 'approval.required'
  | 'approval.pending'
  | 'approval.approved'
  | 'approval.rejected'
  | 'boundary.crossed';

export interface ApprovalState {
  key: ApprovalKey;
  label: string;
  tone: Tone;
  detail: string;
}

/**
 * The approval boundary's state, from TrueForge's record of the gated call. `gated` picks
 * one of several actions waiting at once; by default it is the view's gated action.
 */
export function approvalState(
  view: RunView,
  gated: RunView['gatedAction'] = view.gatedAction,
): ApprovalState {
  const call = gated?.call;
  if (!call) {
    return {
      key: 'approval.none',
      label: 'No approval required yet',
      tone: 'neutral',
      detail: 'Nothing that changes an external system has been proposed.',
    };
  }
  const decision = call.approval?.decision;
  if (decision === 'allow') {
    return {
      key: 'approval.approved',
      label: 'Approved',
      tone: 'good',
      detail: `Approved in TrueForge at ${clock(call.approval?.decidedAt)}.`,
    };
  }
  if (decision === 'deny' || call.status === 'denied') {
    return {
      key: 'approval.rejected',
      label: 'Rejected',
      tone: 'bad',
      detail: `Rejected in TrueForge${call.approval?.decidedAt ? ` at ${clock(call.approval.decidedAt)}` : ''}. The action did not run.`,
    };
  }
  if (call.status === 'awaiting_approval') {
    return {
      key: 'approval.pending',
      label: 'Pending',
      tone: 'gate',
      detail: 'TrueForge is holding the call until a human decides.',
    };
  }
  if (call.status === 'succeeded' || call.status === 'failed') {
    return {
      key: 'boundary.crossed',
      label: 'Ran without approval',
      tone: 'bad',
      detail: 'TrueForge ran this gated call without an approval decision.',
    };
  }
  return {
    key: 'approval.required',
    label: 'Required',
    tone: 'gate',
    detail: 'Policy requires approval; waiting for TrueForge to pause the call.',
  };
}

export const POLICY_DECISION_TEXT: Record<PolicyDecision, { label: string; tone: Tone }> = {
  auto: { label: 'Allow', tone: 'good' },
  auto_in_sandbox: { label: 'Allow in sandbox', tone: 'good' },
  require_approval: { label: 'Require approval', tone: 'gate' },
  deny: { label: 'Block', tone: 'bad' },
};

export const BASIS_TEXT: Record<EvidenceBasis, { label: string; description: string }> = {
  SANDBOX_DERIVED: {
    label: 'Sandbox-derived',
    description: 'Backed by a command TrueForge ran in the sandbox; its exit code was checked.',
  },
  TOOL_DERIVED: {
    label: 'Tool-derived',
    description: 'Backed by a connector call TrueForge recorded.',
  },
  MODEL_HYPOTHESIS: {
    label: 'Model hypothesis',
    description: 'The agent’s reasoning. Not proof, and never counted as verified.',
  },
  UNVERIFIED: {
    label: 'Unverified claim',
    description: 'Cites no tool call TrueForge recorded, so it cannot be checked.',
  },
};

export const BASIS_ORDER: readonly EvidenceBasis[] = [
  'SANDBOX_DERIVED',
  'TOOL_DERIVED',
  'UNVERIFIED',
  'MODEL_HYPOTHESIS',
];

/** The newest unified diff TrueForge recorded in sandbox output, if any. */
export function latestDiff(view: RunView): { call: ToolCallView; files: FileDiff[] } | null {
  const runs = view.toolCalls.filter((call) => call.exec && call.status === 'succeeded');
  for (const call of [...runs].reverse()) {
    const files = parseUnifiedDiff(call.exec?.outputTail ?? '');
    if (files.length > 0) return { call, files };
  }
  return null;
}
