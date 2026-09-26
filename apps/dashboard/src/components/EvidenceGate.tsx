import type { EvidenceItemView, RequirementStatus, RunView } from '../../shared/view';
import { BASIS_ORDER, BASIS_TEXT } from '../lib/console';
import { plural } from '../lib/format';
import { EvidenceItems } from './Evidence';

const REQUIREMENT_TEXT: Record<RequirementStatus, string> = {
  satisfied: 'verified',
  unverified: 'claimed, not verified',
  failed: 'failed or contradicted',
  missing: 'not reported',
};

function Readiness({ view }: { view: RunView }) {
  const { required, ready } = view.gate;
  if (required.length === 0) {
    return (
      <p className="gate-readiness gate-readiness--none">
        {view.track.mode === 'runbook'
          ? 'The runbook names no evidence required before the authorization line.'
          : 'No compiled runbook, so there are no evidence requirements to check.'}
      </p>
    );
  }
  const satisfied = required.filter((item) => item.status === 'satisfied').length;
  return (
    <div className={`gate-readiness ${ready ? 'gate-readiness--ready' : ''}`}>
      <p className="gate-readiness__text">
        <strong>
          {ready ? 'Evidence sufficient for an approval request' : 'Evidence not sufficient yet'}
        </strong>
        <span>
          {satisfied} of {plural(required.length, 'required item')} verified against TrueForge
        </span>
      </p>
      <ol className="meter" aria-label="Required evidence, in runbook order">
        {required.map((item) => (
          <li
            key={item.key}
            className={`meter__cell meter__cell--${item.status}`}
            title={`Step ${String(item.step)} · ${item.label}: ${REQUIREMENT_TEXT[item.status]}`}
          >
            <span className="visually-hidden">
              {item.label}: {REQUIREMENT_TEXT[item.status]}
            </span>
          </li>
        ))}
      </ol>
      <p className="hint">
        Deterministic: every item the runbook requires must pass and match TrueForge’s record. No
        model scores this.
      </p>
    </div>
  );
}

function group(items: readonly EvidenceItemView[]) {
  const ran = items.filter((item) => item.claim !== 'not_run');
  return {
    groups: BASIS_ORDER.map((basis) => ({
      basis,
      items: ran.filter((item) => item.basis === basis),
    })).filter((entry) => entry.items.length > 0),
    notRun: items.filter((item) => item.claim === 'not_run'),
  };
}

/** What the agent actually knows before it asks to act, grouped by what each claim rests on. */
export function EvidenceGate({ view }: { view: RunView }) {
  const evidence = view.evidence;
  const { groups, notRun } = group(evidence?.items ?? []);

  return (
    <section className="panel" id="evidence-gate" aria-labelledby="evidence-gate-title">
      <div className="panel__head">
        <h2 id="evidence-gate-title" className="label">
          Evidence gate
        </h2>
        {view.gate.required.length > 0 && (
          <span className={`chip ${view.gate.ready ? 'chip--good' : 'chip--caution'}`}>
            {view.gate.ready ? 'Ready' : 'Not ready'}
          </span>
        )}
      </div>
      <div className="panel__body">
        <Readiness view={view} />
        {evidence ? (
          <>
            {groups.map(({ basis, items }) => (
              <div key={basis} className={`evidence basis basis--${basis}`}>
                <h3 className="basis__title" title={BASIS_TEXT[basis].description}>
                  {BASIS_TEXT[basis].label}
                  <span className="basis__count">{items.length}</span>
                </h3>
                <EvidenceItems items={items} />
              </div>
            ))}
            {notRun.length > 0 && (
              <div className="evidence basis basis--not-run">
                <h3 className="basis__title">
                  Not run
                  <span className="basis__count">{notRun.length}</span>
                </h3>
                <EvidenceItems items={notRun} />
              </div>
            )}
          </>
        ) : (
          <p className="empty">
            No evidence collected yet. RunbookAI reports an evidence package before the agent asks
            to act; until then, what TrueForge recorded is in the timeline.
          </p>
        )}
      </div>
    </section>
  );
}
