import type { BlastRadius } from '@runbook-ai/core';
import type { GatedActionView, RunView } from '../../shared/view';
import { POLICY_DECISION_TEXT } from '../lib/console';
import { CLASS_LABELS } from '../lib/format';

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

/** The eight facts behind the risk class, as the permission matrix records them. */
export function BlastRadiusFacts({ blast }: { blast: BlastRadius }) {
  const facts: [string, string, boolean][] = [
    ['External systems', blast.externalSystemsTouched.join(', ') || 'None', false],
    ['Resources affected', String(blast.resourcesAffected), blast.resourcesAffected > 3],
    ['Customer-facing', yesNo(blast.customerFacing), blast.customerFacing],
    ['Mutates data', yesNo(blast.mutatesData), blast.mutatesData],
    ['Destructive', yesNo(blast.destructive), blast.destructive],
    ['Reversible', yesNo(blast.reversible), !blast.reversible],
    ['Rollback available', yesNo(blast.rollbackAvailable), !blast.rollbackAvailable],
    ['Unknown dependencies', String(blast.unknownDependencies), blast.unknownDependencies > 0],
  ];
  return (
    <dl className="facts">
      {facts.map(([label, value, risky]) => (
        <div key={label} className="facts__row">
          <dt>{label}</dt>
          <dd className={risky ? 'facts__risky' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function sourceText(source: GatedActionView['blastRadiusSource']): string {
  return source === 'policy'
    ? 'Computed from the permission matrix, not by the model'
    : 'Reported by RunbookAI in the evidence package';
}

/**
 * Blast radius and policy decision for the action at the authorization line. Both are
 * deterministic outputs of RunbookAI's policy; neither is the model's opinion.
 */
export function BlastRadiusCard({ view }: { view: RunView }) {
  const gated = view.gatedAction;
  if (!gated) {
    return (
      <section className="panel" id="blast-radius" aria-labelledby="blast-title">
        <div className="panel__head">
          <h2 id="blast-title" className="label">
            Blast radius
          </h2>
        </div>
        <div className="panel__body">
          <p className="empty">
            No external mutation proposed yet. When the agent proposes one, policy computes its
            blast radius here before anything runs.
          </p>
        </div>
      </section>
    );
  }

  const { call, blastRadius: blast } = gated;
  const decision = POLICY_DECISION_TEXT[call.decision];
  return (
    <section className="panel" id="blast-radius" aria-labelledby="blast-title">
      <div className="panel__head">
        <h2 id="blast-title" className="label">
          Blast radius
        </h2>
        <code className="hint">{call.ref.tool}</code>
      </div>
      <div className="panel__body">
        <div className="risk-row">
          <p className={`risk risk--${blast.riskClass}`}>
            <span className="risk__label">Risk class</span>
            <span className="risk__class">{blast.riskClass}</span>
          </p>
          <p className={`policy policy--${decision.tone}`}>
            <span className="risk__label">Policy decision</span>
            <span className="policy__value">{decision.label}</span>
            <span className="policy__class">{CLASS_LABELS[call.actionClass]}</span>
          </p>
        </div>
        <p className="risk__source">{sourceText(gated.blastRadiusSource)}</p>
        <BlastRadiusFacts blast={blast} />
        <ul className="reasons" aria-label="Rules that set the risk class">
          {blast.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
