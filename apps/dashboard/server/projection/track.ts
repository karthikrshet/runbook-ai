import { isGated, type RunbookPlan, type StepStatus } from '@runbook-ai/core';
import type {
  EvidenceView,
  LineState,
  Phase,
  ToolCallStatus,
  ToolCallView,
  TrackItemView,
  TrackStatus,
  TrackView,
  ViolationView,
} from '../../shared/view.js';

export interface TrackInput {
  plan: RunbookPlan | null;
  /** Latest step statuses reported by the RunbookAI server, by step index. */
  progress: ReadonlyMap<number, StepStatus>;
  /** Oldest first. */
  calls: readonly ToolCallView[];
  gatedAction: ToolCallView | null;
  /** Links steps to the calls their required evidence cites. */
  evidence: EvidenceView | null;
  phase: Phase;
  violations: readonly ViolationView[];
}

export function buildTrack(input: TrackInput): TrackView {
  const lineState = lineStateFor(input.gatedAction, input.violations);
  const track = input.plan ? runbookTrack(input.plan, input) : observedTrack(input);
  if (input.phase === 'acting') markCurrentStep(track.items, track.lineIndex);
  return { ...track, lineState };
}

function lineStateFor(gated: ToolCallView | null, violations: readonly ViolationView[]): LineState {
  if (violations.some((violation) => violation.severity === 'violation')) return 'violated';
  if (!gated) return 'not_reached';
  if (gated.status === 'awaiting_approval') return 'at_danger';
  if (gated.status === 'denied' || gated.approval?.decision === 'deny') return 'rejected';
  if (gated.approval?.decision === 'allow') return 'cleared';
  return 'not_reached';
}

/**
 * Steps come from the compiled runbook. Where TrueForge's own record says more
 * than the RunbookAI server reported (a tool call returned, an approval is
 * pending or was decided), TrueForge's record wins.
 */
function runbookTrack(plan: RunbookPlan, input: TrackInput): Omit<TrackView, 'lineState'> {
  const steps = [...plan.steps].sort((a, b) => a.index - b.index);
  const firstGated = steps.findIndex((s) => s.requiresApproval || isGated(s.category));
  const lineIndex = firstGated === -1 ? steps.length : firstGated;
  const hasCheckpointStep = steps.some((s) => s.tool === null && s.requiresApproval);
  const decidedAt = input.gatedAction?.approval?.decidedAt;
  const approvedAt =
    input.gatedAction?.approval?.decision === 'allow' && decidedAt ? time(decidedAt) : null;

  const used = new Set<string>();
  let cursor = Number.NEGATIVE_INFINITY;
  const items = steps.map((s, position): TrackItemView => {
    let status = fromStepStatus(input.progress.get(s.index) ?? s.status);
    const afterLine = position >= lineIndex;
    const linked = new Set<string>();

    if (s.tool !== null) {
      const match = input.calls.find(
        (call) =>
          call.ref.tool === s.tool &&
          !used.has(call.id) &&
          time(call.requestedAt) >= cursor &&
          // A read step after the line only counts once the gated action was approved.
          (!afterLine ||
            s.requiresApproval ||
            (approvedAt !== null && time(call.requestedAt) >= approvedAt)),
      );
      if (match) {
        used.add(match.id);
        linked.add(match.id);
        cursor = time(match.requestedAt);
        status = fromCallStatus(match.status, hasCheckpointStep && s.requiresApproval);
      }
    } else if (s.requiresApproval && input.gatedAction) {
      linked.add(input.gatedAction.id);
      status = checkpointStatus(input.gatedAction);
    }
    // TrueForge does not record which step a call belongs to; the evidence a step
    // requires names the calls that produced it.
    for (const key of s.evidenceRequired) {
      const cited = input.evidence?.items.find((item) => item.key === key)?.provenance;
      if (cited) linked.add(cited.toolCallId);
    }

    return {
      key: s.id,
      index: s.index,
      title: s.description,
      detail: s.tool,
      actionClass: s.category,
      status,
      gated: afterLine,
      requiresApproval: s.requiresApproval || isGated(s.category),
      toolCallIds: input.calls.filter((call) => linked.has(call.id)).map((call) => call.id),
      evidenceKeys: [...s.evidenceRequired],
    };
  });

  return { mode: 'runbook', title: 'Runbook', subtitle: plan.runbookId, items, lineIndex };
}

/** Without a compiled runbook, group what actually happened by action class. */
function observedTrack(input: TrackInput): Omit<TrackView, 'lineState'> {
  const firstExecutedGate = input.calls.find(
    (call) => isGatedCall(call) && (call.status === 'succeeded' || call.status === 'failed'),
  );
  const afterGate = (call: ToolCallView): boolean =>
    firstExecutedGate !== undefined && time(call.requestedAt) > time(firstExecutedGate.requestedAt);

  const investigate = input.calls.filter((c) => c.actionClass === 'READ_ONLY' && !afterGate(c));
  const sandbox = input.calls.filter((c) => c.actionClass === 'SANDBOX_ONLY');
  const act = input.calls.filter(isGatedCall);
  const verify = input.calls.filter((c) => c.actionClass === 'READ_ONLY' && afterGate(c));

  const items: TrackItemView[] = [
    stage('investigate', 'Investigate', investigate, 'READ_ONLY'),
    stage('sandbox', 'Reproduce and fix in the sandbox', sandbox, 'SANDBOX_ONLY'),
    {
      ...stage('act', 'Change an external system', act, null),
      status: input.gatedAction ? checkpointOrCallStatus(input.gatedAction) : 'pending',
      gated: true,
      requiresApproval: true,
    },
    { ...stage('verify', 'Verify', verify, 'READ_ONLY'), gated: true },
  ];
  return {
    mode: 'observed',
    title: 'Observed run',
    subtitle: 'No compiled runbook reported',
    items,
    lineIndex: 2,
  };
}

function stage(
  key: string,
  title: string,
  calls: readonly ToolCallView[],
  actionClass: TrackItemView['actionClass'],
): TrackItemView {
  const last = calls.at(-1);
  const running = calls.some((c) => c.status === 'running');
  return {
    key,
    index: null,
    title,
    detail: last
      ? `${calls.length} call${calls.length === 1 ? '' : 's'} · last ${last.ref.tool}`
      : null,
    actionClass,
    status: calls.length === 0 ? 'pending' : running ? 'active' : 'done',
    gated: false,
    requiresApproval: false,
    toolCallIds: calls.map((call) => call.id),
    evidenceKeys: [],
  };
}

function time(iso: string): number {
  return Date.parse(iso);
}

function isGatedCall(call: ToolCallView): boolean {
  return call.decision === 'require_approval' || call.decision === 'deny';
}

/** While the agent works on its own, the first unfinished automatic step is the current one. */
function markCurrentStep(items: TrackItemView[], lineIndex: number): void {
  if (items.some((item) => item.status === 'active' || item.status === 'awaiting')) return;
  const next = items.findIndex(
    (item, position) => position < lineIndex && item.status === 'pending',
  );
  const item = next === -1 ? undefined : items[next];
  if (item) item.status = 'active';
}

function fromStepStatus(status: StepStatus): TrackStatus {
  switch (status) {
    case 'running':
      return 'active';
    case 'awaiting_approval':
      return 'awaiting';
    default:
      return status;
  }
}

function fromCallStatus(status: ToolCallStatus, checkpointStepExists: boolean): TrackStatus {
  switch (status) {
    case 'awaiting_approval':
      return checkpointStepExists ? 'pending' : 'awaiting';
    case 'denied':
      return checkpointStepExists ? 'skipped' : 'rejected';
    case 'running':
      return 'active';
    case 'succeeded':
      return 'done';
    case 'failed':
      return 'failed';
  }
}

function checkpointStatus(gated: ToolCallView): TrackStatus {
  if (gated.status === 'awaiting_approval') return 'awaiting';
  if (gated.approval?.decision === 'allow') return 'done';
  if (gated.approval?.decision === 'deny' || gated.status === 'denied') return 'rejected';
  return 'pending';
}

function checkpointOrCallStatus(gated: ToolCallView): TrackStatus {
  const checkpoint = checkpointStatus(gated);
  return checkpoint === 'pending' ? fromCallStatus(gated.status, false) : checkpoint;
}
