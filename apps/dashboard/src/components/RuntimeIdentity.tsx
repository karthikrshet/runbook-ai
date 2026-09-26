import type { ReactNode } from 'react';
import type { RunView } from '../../shared/view';
import { approvalState } from '../lib/console';
import { shortId } from '../lib/format';
import { ExternalIcon } from './Icons';

/** TrueForge is the agent runtime: its session, calls, sandbox runs and approval state. */
export function RuntimeIdentity({ view }: { view: RunView }) {
  const sandboxRuns = view.sandbox.execCallIds.length;
  const approval = approvalState(view);
  const demo = view.source.kind === 'fixture';

  const rows: [string, ReactNode][] = [
    [
      'Agent session',
      view.session.uiUrl ? (
        <a href={view.session.uiUrl} target="_blank" rel="noreferrer" className="tf-link">
          <code>{shortId(view.session.id, 16)}</code>
          <ExternalIcon />
        </a>
      ) : (
        <span className="hint">{demo ? 'None: demo replay' : shortId(view.session.id, 16)}</span>
      ),
    ],
    ['Turns', String(view.session.turns)],
    ['Tool calls', String(view.counts.toolCalls)],
    ['Sandbox runs', String(sandboxRuns)],
    ['Approval state', <code key="approval">{approval.key}</code>],
  ];
  if (view.session.costUsd !== null)
    rows.push(['Model cost', `$${view.session.costUsd.toFixed(2)}`]);

  return (
    <section className="panel runtime" aria-labelledby="runtime-title">
      <div className="panel__head">
        <h2 id="runtime-title" className="label">
          Powered by TrueForge
        </h2>
        {demo && <span className="chip chip--demo">Demo</span>}
      </div>
      <div className="panel__body">
        <p className="hint">
          TrueForge runs the agent, the tools and the sandbox, and holds every approval. This
          console reads its event log and never acts on its own.
        </p>
        <dl className="kv">
          {rows.map(([label, value]) => (
            <div key={label} className="kv__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
