import type { RunView, ToolCallView } from '../../shared/view';
import { clock, DECISION_LABELS, toolName } from '../lib/format';

export function DecisionChip({ call }: { call: ToolCallView }) {
  const approval = call.approval;
  if (call.status === 'awaiting_approval')
    return <span className="chip chip--gate">Awaiting decision</span>;
  if (approval?.decision === 'allow') {
    return <span className="chip chip--good">Approved {clock(approval.decidedAt)}</span>;
  }
  if (approval?.decision === 'deny' || call.status === 'denied') {
    return <span className="chip chip--bad">Rejected {clock(approval?.decidedAt)}</span>;
  }
  if (call.status === 'succeeded' || call.status === 'failed') {
    return <span className="chip chip--bad">Ran without approval</span>;
  }
  return <span className="chip">Requested</span>;
}

/** The action at the authorization line: what would run, where, and how to undo it. */
export function ProposedAction({ view, call }: { view: RunView; call: ToolCallView }) {
  const evidence = view.evidence;
  const summary =
    evidence?.proposedAction.tool === call.ref.tool
      ? evidence.proposedAction.summary
      : call.policySummary;
  const ran = call.status === 'succeeded' || call.status === 'failed';

  return (
    <section className="action" aria-labelledby="action-title">
      <h3 id="action-title" className="sublabel">
        Proposed action
      </h3>
      <div className="action__tool">
        <code className="action__name">{call.ref.tool}</code>
        <span className="action__server">
          {call.ref.kind === 'mcp' ? `via the ${call.ref.server} connector` : toolName(call.ref)}
          {call.system ? ` · ${call.system}` : ''} · {DECISION_LABELS[call.decision]}
        </span>
      </div>
      {summary && <p className="action__summary">{summary}</p>}

      {call.args.length > 0 && (
        <dl className="args" aria-label="Arguments">
          {call.args.map((arg) => (
            <div key={arg.key} className="args__row">
              <dt>{arg.key}</dt>
              <dd>{arg.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {ran && call.resultPreview && (
        <section aria-labelledby="result-title">
          <h4 id="result-title" className="sublabel">
            Result recorded by TrueForge
          </h4>
          <pre className={`result ${call.status === 'failed' ? 'result--failed' : ''}`}>
            {call.resultPreview}
          </pre>
        </section>
      )}

      {evidence && (
        <section className="rollback" aria-labelledby="rollback-title">
          <h4 id="rollback-title" className="sublabel">
            Rollback plan
          </h4>
          <p className="rollback__summary">{evidence.rollbackPlan.summary}</p>
          {evidence.rollbackPlan.steps.length > 0 && (
            <ol className="rollback__steps">
              {evidence.rollbackPlan.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {evidence.unknowns.length > 0 && (
            <p className="unknowns">Unknowns: {evidence.unknowns.join('; ')}</p>
          )}
        </section>
      )}
    </section>
  );
}
