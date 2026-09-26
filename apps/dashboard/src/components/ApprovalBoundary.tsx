import type { BlastRadius } from '@runbook-ai/core';
import type { RunView, ToolCallView, TrackItemView } from '../../shared/view';
import { useConfig } from '../lib/config';
import {
  approvalState,
  POLICY_DECISION_TEXT,
  stepForCall,
  type ApprovalState,
} from '../lib/console';
import { headlineFor } from '../lib/copy';
import { CLASS_LABELS, clock, plural } from '../lib/format';
import { AuthorityFlow } from './AuthorityFlow';
import { DecisionControls } from './DecisionControls';
import { EvidenceItems } from './Evidence';
import { ExternalIcon, PauseIcon } from './Icons';
import { DecisionChip, ProposedAction } from './ProposedAction';

const HEADINGS: Record<ApprovalState['key'], { eyebrow: string; title: string }> = {
  'approval.none': { eyebrow: 'Approval boundary', title: 'No approval required yet' },
  'approval.required': { eyebrow: 'Approval boundary', title: 'Approval required' },
  'approval.pending': { eyebrow: 'Autonomy paused', title: 'Human authorization required' },
  'approval.approved': {
    eyebrow: 'Approval boundary',
    title: 'Authorized by a human in TrueForge',
  },
  'approval.rejected': { eyebrow: 'Approval boundary', title: 'Rejected by a human in TrueForge' },
  'boundary.crossed': {
    eyebrow: 'Approval boundary',
    title: 'Crossed without an approval decision',
  },
};

/** Why the run stopped here, in facts the policy and the runbook state. */
function WhyNow({ call, step }: { call: ToolCallView; step: TrackItemView | null }) {
  const decision = POLICY_DECISION_TEXT[call.decision];
  return (
    <section className="why" aria-labelledby="why-title">
      <h3 id="why-title" className="sublabel">
        Why now?
      </h3>
      <ul className="why__list">
        <li>
          Policy classifies <code>{call.ref.tool}</code> as{' '}
          <strong>{CLASS_LABELS[call.actionClass]}</strong>.{' '}
          {call.policySummary ?? 'It is not in the permission matrix, so its scope is unknown.'}
        </li>
        {call.system && (
          <li>
            It changes <strong>{call.system}</strong>, an external system outside the sandbox.
          </li>
        )}
        {step && (
          <li>
            Runbook step {step.index}: {step.title}.
          </li>
        )}
        <li>
          Policy decision: <strong>{decision.label}</strong>.{' '}
          {call.approval?.checkpointEventId
            ? 'TrueForge paused the run at its approval checkpoint.'
            : 'TrueForge has not recorded an approval checkpoint for it.'}
        </li>
      </ul>
    </section>
  );
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/** The decision in one line: evidence readiness, blast radius, reversibility, rollback. */
function DecisionFacts({ view, blast }: { view: RunView; blast: BlastRadius }) {
  const { required, ready } = view.gate;
  const satisfied = required.filter((item) => item.status === 'satisfied').length;
  return (
    <dl className="decision-facts">
      <div>
        <dt>Evidence</dt>
        <dd>
          <a href="#evidence-gate">
            {required.length === 0
              ? view.evidence
                ? plural(view.evidence.items.length, 'item')
                : 'None reported'
              : `${ready ? 'Ready' : 'Not ready'} · ${String(satisfied)}/${String(required.length)} verified`}
          </a>
        </dd>
      </div>
      <div>
        <dt>Blast radius</dt>
        <dd>
          <a href="#blast-radius" className={`risk-inline risk-inline--${blast.riskClass}`}>
            {blast.riskClass}
          </a>
        </dd>
      </div>
      <div>
        <dt>System</dt>
        <dd>{blast.externalSystemsTouched.join(', ') || 'None'}</dd>
      </div>
      <div>
        <dt>Resources</dt>
        <dd>{blast.resourcesAffected}</dd>
      </div>
      <div>
        <dt>Reversible</dt>
        <dd>{yesNo(blast.reversible)}</dd>
      </div>
      <div>
        <dt>Rollback</dt>
        <dd>{blast.rollbackAvailable ? 'Available' : 'None'}</dd>
      </div>
    </dl>
  );
}

/** Shown in demo mode: the decision controls exist, but nothing is connected to act on. */
function PreviewDecision() {
  return (
    <div className="decide decide--preview">
      <div className="decide__text">
        <p className="decide__label">
          UI preview <span className="demo-tag">Not connected</span>
        </p>
        <p>
          Demo mode replays a fixture, so there is no TrueForge session to decide in. In a live run,
          Approve and Reject are sent to TrueForge’s native tool approval; this console never runs
          the action itself.
        </p>
      </div>
      <div className="decide__buttons">
        <button type="button" className="button button--approve" disabled>
          Approve…
        </button>
        <button type="button" className="button button--reject" disabled>
          Reject…
        </button>
      </div>
    </div>
  );
}

/**
 * The approval boundary. Before it the agent works on its own; at it, TrueForge holds
 * the call until a human decides. Approve and Reject here are forwarded to TrueForge's
 * native approval and are never the security boundary themselves.
 */
export function ApprovalBoundary({ view }: { view: RunView }) {
  const config = useConfig();
  const gated = view.gatedAction;
  if (!gated) return null;

  const { call, blastRadius } = gated;
  const state = approvalState(view);
  const heading = HEADINGS[state.key];
  const pending = state.key === 'approval.pending';
  const demo = view.source.kind === 'fixture';
  const decisionsEnabled = config?.decisionsEnabled ?? false;
  const step = stepForCall(view, call.id);
  const ran = call.status === 'succeeded' || call.status === 'failed';

  return (
    <section
      className={`boundary boundary--${state.key.replace('.', '-')}`}
      aria-labelledby="boundary-title"
    >
      <header className="boundary__head">
        <span className="boundary__lamp" aria-hidden="true">
          {pending && <PauseIcon className="icon boundary__pause" />}
        </span>
        <div className="boundary__heading">
          <p className="boundary__eyebrow">{heading.eyebrow}</p>
          <h2 id="boundary-title" className="boundary__title">
            {heading.title}
          </h2>
          {pending && (
            <p className="boundary__body">
              {headlineFor(view, { decisionsEnabled: decisionsEnabled && !demo }).body}
            </p>
          )}
        </div>
        <div className="boundary__state">
          <DecisionChip call={call} />
          <code>{state.key}</code>
          <span>{state.detail}</span>
        </div>
      </header>

      <AuthorityFlow view={view} />

      <div className="boundary__grid">
        <ProposedAction view={view} call={call} />
        <WhyNow call={call} step={step} />
      </div>

      <DecisionFacts view={view} blast={blastRadius} />

      {ran && view.verification && (
        <section className="evidence verification" aria-labelledby="verification-title">
          <h3 id="verification-title" className="sublabel">
            Verification after the action
          </h3>
          <p className={`verdict ${view.verification.healthy ? 'verdict--good' : 'verdict--bad'}`}>
            {view.verification.healthy ? 'Healthy' : 'Not healthy'}
            <span className="hint"> · reported {clock(view.verification.reportedAt)}</span>
          </p>
          <EvidenceItems items={view.verification.checks} />
        </section>
      )}

      <footer className="boundary__foot" id="decision">
        {pending && demo ? (
          <PreviewDecision />
        ) : pending && decisionsEnabled ? (
          <DecisionControls
            key={call.id}
            sessionId={view.session.id}
            call={call}
            trueforgeUrl={view.session.uiUrl}
          />
        ) : (
          <div className="boundary__note">
            <span>
              {pending
                ? 'Approve or reject in TrueForge; the run resumes from there.'
                : 'Every decision is recorded in TrueForge.'}
            </span>
            {view.session.uiUrl && (
              <a className="tf-link" href={view.session.uiUrl} target="_blank" rel="noreferrer">
                {pending ? 'Decide in TrueForge' : 'Open session in TrueForge'}
                <ExternalIcon />
              </a>
            )}
          </div>
        )}
      </footer>
    </section>
  );
}
