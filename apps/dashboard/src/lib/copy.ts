import type { Phase, RunView, ToolCallView } from '../../shared/view';
import { incidentStatus } from './console';
import { clock, plural, toolName } from './format';

export type Tone = 'neutral' | 'gate' | 'good' | 'bad' | 'caution';

export interface HeadlineCopy {
  eyebrow: string;
  title: string;
  body: string;
  tone: Tone;
}

function argValue(call: ToolCallView, key: string): string | null {
  return call.args.find((arg) => arg.key === key)?.value ?? null;
}

/** A plain sentence for what the gated action does, from its typed arguments. */
export function describeAction(call: ToolCallView): string {
  const repo = argValue(call, 'repo');
  const service = argValue(call, 'service');
  switch (call.ref.tool) {
    case 'github_create_pull_request':
    case 'create_pull_request':
      return repo ? `open a pull request on ${repo}` : 'open a pull request';
    case 'aws_execute_demo_rollback':
      return service
        ? `roll back ${service} to its previous deployment`
        : 'roll back the demo service';
    case 'create_branch':
      return repo ? `create a branch on ${repo}` : 'create a branch';
    default:
      return `run ${toolName(call.ref)}`;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Why the run stopped at a call TrueForge holds for a decision. The approval boundary passes
 * the call on screen, which may not be the first one waiting, even when the run's phase
 * reports a crossed boundary first. A fixture replay has no TrueForge session to decide in.
 */
export function awaitingBody(
  view: RunView,
  call: ToolCallView | null,
  options: { decisionsEnabled: boolean },
): string {
  const external = view.counts.gatedExecuted;
  return `The agent wants to ${call ? describeAction(call) : 'run the proposed action'}. Everything before this ran on its own; ${
    external === 0
      ? 'no external change has run yet'
      : `${plural(external, 'external change')} already ran`
  }. ${
    view.source.kind === 'fixture'
      ? 'This is a replay: in a live run, a human approves or rejects it in TrueForge.'
      : options.decisionsEnabled
        ? 'Review the evidence below, then approve or reject. TrueForge records the decision and resumes the run.'
        : 'Review the evidence, then approve or reject it in TrueForge.'
  }`;
}

export function headlineFor(
  view: RunView,
  options: { decisionsEnabled: boolean } = { decisionsEnabled: false },
): HeadlineCopy {
  const call = view.gatedAction?.call ?? null;
  const action = call ? describeAction(call) : 'run the proposed action';
  const external = view.counts.gatedExecuted;

  switch (view.phase) {
    case 'waiting':
      return {
        eyebrow: 'No activity yet',
        title: 'Waiting for the agent to start',
        body: 'Give the agent its task in TrueForge. Steps appear here as it works.',
        tone: 'neutral',
      };
    case 'acting': {
      const current = view.track.items.find((item) => item.status === 'active');
      return {
        eyebrow: 'Working on its own',
        title: current ? current.title : 'Working through the runbook',
        body: 'Read-only and sandbox steps run without asking. The run stops at the authorization line before anything that changes an external system.',
        tone: 'neutral',
      };
    }
    case 'awaiting_authorization':
      return {
        eyebrow: 'Stopped at the authorization line',
        title: 'TrueForge paused the run for your decision',
        body: awaitingBody(view, call, options),
        tone: 'gate',
      };
    case 'authorized': {
      const failed = view.verification?.healthy === false;
      return {
        eyebrow: `Approved in TrueForge at ${clock(call?.approval?.decidedAt)}`,
        title: failed
          ? 'The approved change ran, but verification failed'
          : 'Applying the approved change',
        body: failed
          ? 'Check the failed verification items below before doing anything else.'
          : `${capitalise(action)}: approved by a human in TrueForge. Verification follows.`,
        tone: failed ? 'bad' : 'good',
      };
    }
    case 'resolved': {
      const checks = view.verification?.checks ?? [];
      const passed = checks.filter((check) => check.claim === 'passed').length;
      return {
        eyebrow: 'Verified after approval',
        title: 'Approved change applied and verified',
        body: `${capitalise(action)} ran after approval in TrueForge, and ${passed} of ${plural(checks.length, 'verification check')} passed.`,
        tone: 'good',
      };
    }
    case 'rejected': {
      const reason = call?.approval?.reason;
      return {
        eyebrow: `Rejected in TrueForge at ${clock(call?.approval?.decidedAt)}`,
        title: 'The change was not made',
        body: `The request to ${action} did not run.${reason ? ` Reason given: “${reason}”.` : ''}`,
        tone: 'bad',
      };
    }
    case 'finished':
      return {
        eyebrow: 'Run finished',
        title: external === 0 ? 'Finished without an external change' : 'Run finished',
        body:
          external === 0
            ? 'The agent ended its turn without proposing an action that needs approval.'
            : `The agent ended its turn after ${plural(external, 'external change')}.`,
        tone: 'neutral',
      };
    case 'paused': {
      const pause = view.pause;
      if (pause?.reason === 'connector_auth') {
        return {
          eyebrow: 'Paused in TrueForge',
          title: 'A connector needs authorization',
          body: `TrueForge paused the run until ${pause.detail ?? 'a connector'} is authorized. Authorize it in TrueForge; the run then continues on its own.`,
          tone: 'caution',
        };
      }
      if (pause?.reason === 'user_input') {
        return {
          eyebrow: 'Paused in TrueForge',
          title: 'The agent is waiting for an answer',
          body: pause.detail
            ? `The agent asked: “${pause.detail}” Answer it in TrueForge; the run then continues.`
            : 'The agent asked a question. Answer it in TrueForge; the run then continues.',
          tone: 'caution',
        };
      }
      return {
        eyebrow: 'Paused in TrueForge',
        title: 'The run is paused',
        body: 'TrueForge paused the run. Open the session in TrueForge to see what it is waiting for.',
        tone: 'caution',
      };
    }
    case 'failed':
      return {
        eyebrow: 'Run stopped',
        title: 'The run ended with an error',
        body: view.turn.message ?? 'TrueForge reported an error for the last turn.',
        tone: 'bad',
      };
    case 'violated': {
      const crossed = view.toolCalls.find(
        (c) => c.id === view.violations.find((v) => v.severity === 'violation')?.toolCallId,
      );
      return {
        eyebrow: 'Approval boundary crossed',
        title: 'An action ran without approval',
        body: `${crossed ? toolName(crossed.ref) : 'A gated tool'} changes an external system but ran without a decision in TrueForge. Require approval for it on the connector (requireApprovalForTools) before running this runbook again.`,
        tone: 'bad',
      };
    }
  }
}

export const LINE_STATE_TEXT: Record<RunView['track']['lineState'], string> = {
  not_reached:
    'Steps below this line change external systems. Each one needs a human decision in TrueForge.',
  at_danger: 'Stopped here. Waiting for a decision in TrueForge.',
  cleared: 'Approved in TrueForge.',
  rejected: 'Rejected in TrueForge. The action did not run.',
  violated: 'Crossed without an approval decision. See the warning at the top.',
};

/** What the operation panel says before TrueForge has recorded any tool call. */
export function emptyOperationText(phase: Phase): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting for the agent to start. Give it its task in TrueForge; each step appears here as TrueForge records it.';
    case 'paused':
      return 'No tool calls yet. TrueForge paused the run before the first one; the notice above says what it is waiting on.';
    case 'failed':
    case 'finished':
      return 'The turn ended without any tool call.';
    default:
      return 'No tool calls yet. The agent is reading the task.';
  }
}

/** The calls TrueForge holds for a decision, each with its blast radius when there are several. */
function waitingFor(view: RunView): string {
  const waiting = view.pendingActions;
  if (waiting.length > 1) {
    const actions = new Set(
      waiting.map(
        (entry) => `${entry.call.ref.tool} (blast radius ${entry.blastRadius.riskClass})`,
      ),
    );
    return `${waiting.length} actions need human authorization: ${[...actions].join(', ')}.`;
  }
  const tool = view.gatedAction?.call.ref.tool;
  return `Human authorization required${tool ? ` for ${tool}` : ''}.`;
}

/**
 * What the screen-reader live region says. It changes only with the phase, the current step
 * or the set of calls waiting for a decision, so the view's frequent updates are not re-read.
 */
export function announcementFor(view: RunView): string {
  if (view.phase === 'awaiting_authorization') return `Autonomy paused. ${waitingFor(view)}`;
  const status = `${incidentStatus(view).label}. ${headlineFor(view).title}.`;
  // Calls can still wait for a decision after a crossed boundary, which the run reports first.
  return view.pendingActions.length > 0 ? `${status} ${waitingFor(view)}` : status;
}
