import type { RunView } from '../../shared/view';
import { approvalState, POLICY_DECISION_TEXT } from '../lib/console';
import { clock } from '../lib/format';
import { ArrowIcon } from './Icons';

type StageState = 'done' | 'active' | 'pending' | 'stopped';

interface Stage {
  actor: string;
  verb: string;
  state: StageState;
  note: string;
}

const STATE_TEXT: Record<StageState, string> = {
  done: 'done',
  active: 'in progress',
  pending: 'not yet',
  stopped: 'stopped',
};

function stagesFor(view: RunView): Stage[] {
  const call = view.gatedAction?.call ?? null;
  if (!call) {
    const working = view.phase === 'acting';
    return [
      {
        actor: 'Model',
        verb: 'Proposes',
        state: working ? 'active' : 'pending',
        note: 'Reads and tests on its own',
      },
      {
        actor: 'Policy',
        verb: 'Classifies',
        state: working ? 'active' : 'pending',
        note: 'Every tool call, deterministically',
      },
      { actor: 'Human', verb: 'Authorizes', state: 'pending', note: 'Only external changes' },
      {
        actor: 'System',
        verb: 'Executes',
        state: 'pending',
        note: 'TrueForge runs what was allowed',
      },
    ];
  }

  const approval = approvalState(view);
  const decision = POLICY_DECISION_TEXT[call.decision].label;
  const human: Stage = { actor: 'Human', verb: 'Authorizes', state: 'pending', note: '' };
  const system: Stage = {
    actor: 'System',
    verb: 'Executes',
    state: 'pending',
    note: 'Runs only after approval',
  };

  switch (approval.key) {
    case 'approval.pending':
      Object.assign(human, { state: 'active', note: 'Waiting for your decision' });
      break;
    case 'approval.required':
      Object.assign(human, { state: 'pending', note: 'Waiting for TrueForge to pause' });
      break;
    case 'approval.approved':
      Object.assign(human, { state: 'done', note: `Approved ${clock(call.approval?.decidedAt)}` });
      if (call.status === 'succeeded')
        Object.assign(system, { state: 'done', note: 'Executed by TrueForge' });
      else if (call.status === 'failed')
        Object.assign(system, { state: 'stopped', note: 'The action failed' });
      else Object.assign(system, { state: 'active', note: 'Executing in TrueForge' });
      break;
    case 'approval.rejected':
      Object.assign(human, { state: 'stopped', note: 'Rejected' });
      Object.assign(system, { state: 'stopped', note: 'Did not run' });
      break;
    case 'boundary.crossed':
      Object.assign(human, { state: 'stopped', note: 'No decision recorded' });
      Object.assign(system, { state: 'stopped', note: 'Ran without approval' });
      break;
    case 'approval.none':
      break;
  }

  return [
    { actor: 'Model', verb: 'Proposes', state: 'done', note: call.ref.tool },
    {
      actor: 'Policy',
      verb: 'Classifies',
      state: 'done',
      note: `${call.actionClass} · ${decision}`,
    },
    human,
    system,
  ];
}

/** Who holds authority at each point: the model proposes, policy classifies, a human authorizes. */
export function AuthorityFlow({ view }: { view: RunView }) {
  const stages = stagesFor(view);
  return (
    <ol className="authority" aria-label="Authority flow">
      {stages.map((stage, index) => (
        <li
          key={stage.actor}
          className={`authority__stage authority__stage--${stage.state} authority__stage--${stage.actor.toLowerCase()}`}
        >
          <span className="authority__actor">{stage.actor}</span>
          <span className="authority__verb">{stage.verb}</span>
          <span className="authority__note">
            {stage.note}
            <span className="visually-hidden"> ({STATE_TEXT[stage.state]})</span>
          </span>
          {index < stages.length - 1 && <ArrowIcon className="icon authority__arrow" />}
        </li>
      ))}
    </ol>
  );
}
