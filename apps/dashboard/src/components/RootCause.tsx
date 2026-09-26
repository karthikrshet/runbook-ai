import type { RunView } from '../../shared/view';
import { plural } from '../lib/format';
import { Hypothesis } from './Evidence';

/**
 * The suspected root cause. It counts the facts the agent cites instead of showing a
 * confidence score: the agent's own number is not a defined measure, so it is not shown.
 */
export function RootCause({ view }: { view: RunView }) {
  const evidence = view.evidence;
  return (
    <section className="panel" aria-labelledby="root-cause-title">
      <div className="panel__head">
        <h2 id="root-cause-title" className="label">
          Suspected root cause
        </h2>
        {evidence && (
          <span className="chip chip--caution">
            {plural(evidence.hypothesis.supportingFacts.length, 'supporting fact')}
          </span>
        )}
      </div>
      <div className="panel__body">
        {evidence ? (
          <Hypothesis evidence={evidence} />
        ) : (
          <p className="empty">No root cause proposed yet.</p>
        )}
      </div>
    </section>
  );
}
