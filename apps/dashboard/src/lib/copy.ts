import type { RunView, ToolCallView } from '../../shared/view';
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
        body: `The agent wants to ${action}. Everything before this ran on its own; ${
          external === 0
            ? 'no external change has run yet'
            : `${plural(external, 'external change')} already ran`
        }. ${
          options.decisionsEnabled
            ? 'Review the evidence below, then approve or reject. TrueForge records the decision and resumes the run.'
            : 'Review the evidence, then approve or reject it in TrueForge.'
        }`,
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
