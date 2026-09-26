import type { RunView } from '../../shared/view';
import { headlineFor } from '../lib/copy';
import { CLASS_LABELS, clock, plural, STEP_STATUS_LABELS, toolName } from '../lib/format';
import { automaticCallCount, POLICY_DECISION_TEXT } from '../lib/console';
import {
  buildReportMarkdown,
  gateSummary,
  provenanceText,
  reportActions,
  runDuration,
} from '../lib/report';

function download(view: RunView): void {
  const blob = new Blob([buildReportMarkdown(view)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${view.incident.id ?? 'session'}-report.md`;
  link.click();
  URL.revokeObjectURL(url);
}

/** A printable incident report, built from the same TrueForge record as the live view. */
export function IncidentReport({ view }: { view: RunView }) {
  const copy = headlineFor(view);
  const actions = reportActions(view);
  const violated = view.violations.some((violation) => violation.severity === 'violation');
  const flagged = view.toolCalls.filter((c) => c.untrusted.length > 0);
  const liveHref = `?session=${encodeURIComponent(view.session.id)}`;

  return (
    <main className="report">
      <div className="report__actions">
        <a className="link-button link-button--quiet" href={liveHref}>
          Back to the live view
        </a>
        <button
          type="button"
          className="button"
          onClick={() => {
            window.print();
          }}
        >
          Print
        </button>
        <button
          type="button"
          className="button button--approve"
          onClick={() => {
            download(view);
          }}
        >
          Download Markdown
        </button>
      </div>

      <header className="report__head">
        <p className="label">Incident report</p>
        <h1 className="report__title">
          {view.incident.id && <span className="report__id">{view.incident.id}</span>}
          {view.incident.title}
        </h1>
        <p className={`report__outcome report__outcome--${copy.tone}`}>
          <strong>{copy.title}.</strong> {copy.body}
        </p>
      </header>

      <dl className="report__facts">
        <div>
          <dt>Incident</dt>
          <dd>
            {[view.incident.id, view.incident.severity, view.incident.service]
              .filter(Boolean)
              .join(' · ') || 'Not reported'}
          </dd>
        </div>
        {view.track.mode === 'runbook' && view.track.subtitle && (
          <div>
            <dt>Runbook</dt>
            <dd>
              <code>{view.track.subtitle}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>TrueForge session</dt>
          <dd>
            <code>{view.session.id}</code>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {clock(view.startedAt)} – {clock(view.lastEventAt)}
            {runDuration(view) ? ` (${runDuration(view) ?? ''})` : ''}
          </dd>
        </div>
        <div>
          <dt>Agent actions</dt>
          <dd>
            {plural(automaticCallCount(view), 'automatic call')},{' '}
            {plural(view.sandbox.execCallIds.length, 'sandbox command')},{' '}
            {plural(view.counts.gatedExecuted, 'external change')}
          </dd>
        </div>
        <div>
          <dt>Approval boundary</dt>
          <dd className={violated ? 'report__bad' : undefined}>
            {violated ? 'Crossed without approval' : 'Held: nothing gated ran without a decision'}
          </dd>
        </div>
        <div>
          <dt>Evidence gate</dt>
          <dd>{gateSummary(view)}</dd>
        </div>
      </dl>

      {actions.length > 0 && (
        <section className="report__section">
          <h2 className="sublabel">
            {actions.length > 1 ? `Gated actions (${String(actions.length)})` : 'Gated action'}
          </h2>
          {actions.map(({ call, blastRadius }) => (
            <div key={call.id} className="report__action">
              <p>
                <code>{toolName(call.ref)}</code> · {CLASS_LABELS[call.actionClass]} · blast radius{' '}
                <strong>{blastRadius.riskClass}</strong> · policy decision{' '}
                <strong>{POLICY_DECISION_TEXT[call.decision].label}</strong>
              </p>
              <ul className="report__list">
                {call.args.map((arg) => (
                  <li key={arg.key}>
                    <code>{arg.key}</code>: {arg.value}
                  </li>
                ))}
                <li>
                  Decision:{' '}
                  {call.approval?.decision === 'allow'
                    ? `approved in TrueForge at ${clock(call.approval.decidedAt)}`
                    : call.approval?.decision === 'deny'
                      ? `rejected in TrueForge at ${clock(call.approval.decidedAt)}${call.approval.reason ? ` (“${call.approval.reason}”)` : ''}`
                      : call.status === 'awaiting_approval'
                        ? 'waiting in TrueForge'
                        : 'no decision recorded'}
                </li>
                {call.resultPreview && (
                  <li>
                    Result recorded by TrueForge: <code>{call.resultPreview}</code>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      {view.evidence && (
        <section className="report__section">
          <h2 className="sublabel">Root cause · hypothesis</h2>
          <p>{view.evidence.hypothesis.summary}</p>
          <ul className="report__list">
            {view.evidence.hypothesis.supportingFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <h2 className="sublabel">Evidence</h2>
          <table className="report__table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Claim</th>
                <th scope="col">Checked against TrueForge</th>
              </tr>
            </thead>
            <tbody>
              {view.evidence.items.map((item) => (
                <tr key={item.key}>
                  <td>
                    {item.label}
                    {item.detail && <span className="report__muted"> · {item.detail}</span>}
                  </td>
                  <td>
                    {item.claim === 'not_run'
                      ? 'Not run'
                      : item.claim === 'hypothesis'
                        ? 'Hypothesis'
                        : item.claim === 'passed'
                          ? 'Passed'
                          : 'Failed'}
                  </td>
                  <td
                    className={
                      item.provenance?.status === 'mismatch' ||
                      item.provenance?.status === 'missing'
                        ? 'report__bad'
                        : undefined
                    }
                  >
                    {provenanceText(item)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Rollback plan:</strong> {view.evidence.rollbackPlan.summary}
          </p>
        </section>
      )}

      {view.verification && (
        <section className="report__section">
          <h2 className="sublabel">
            Verification · {view.verification.healthy ? 'healthy' : 'not healthy'}
          </h2>
          <ul className="report__list">
            {view.verification.checks.map((check) => (
              <li key={check.key}>
                {check.claim === 'passed' ? 'Passed' : 'Failed'}: {check.label}{' '}
                <span className="report__muted">({provenanceText(check)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="report__section">
        <h2 className="sublabel">Runbook steps</h2>
        <ol className="report__list">
          {view.track.items.map((item) => (
            <li key={item.key}>
              {item.title} ·{' '}
              <span className="report__muted">{STEP_STATUS_LABELS[item.status]}</span>
            </li>
          ))}
        </ol>
      </section>

      {flagged.length > 0 && (
        <section className="report__section">
          <h2 className="sublabel">Untrusted content, treated as data</h2>
          <ul className="report__list">
            {flagged.map((c) => (
              <li key={c.id}>
                <code>{toolName(c.ref)}</code>: {c.untrusted.map((f) => f.label).join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.violations.length > 0 && (
        <section className="report__section">
          <h2 className="sublabel">Boundary findings</h2>
          <ul className="report__list">
            {view.violations.map((violation) => (
              <li
                key={violation.toolCallId}
                className={violation.severity === 'violation' ? 'report__bad' : undefined}
              >
                {violation.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="report__section">
        <h2 className="sublabel">Timeline</h2>
        <table className="report__table report__table--timeline">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Kind</th>
              <th scope="col">Event</th>
            </tr>
          </thead>
          <tbody>
            {view.timeline.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <time dateTime={entry.at}>{clock(entry.at)}</time>
                </td>
                <td>{entry.label}</td>
                <td>
                  {entry.title}
                  {entry.detail && <span className="report__muted"> · {entry.detail}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="report__footer">
        Generated by RunbookAI at {clock(view.generatedAt)} from {view.source.label}. Every row
        comes from TrueForge’s event log for this session; evidence marked “Matches TrueForge” was
        checked against the recorded tool call.
      </p>
    </main>
  );
}
