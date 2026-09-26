import type { RunView } from '../../shared/view';
import { incidentStatus } from '../lib/console';
import { clock } from '../lib/format';

/** What happened, compactly: the incident, its state, and the problem as reported. */
export function IncidentSummary({ view }: { view: RunView }) {
  const status = incidentStatus(view);
  const summary = view.evidence?.problemSummary ?? view.incident.summary;
  const opened = view.incident.openedAt;

  return (
    <section className="incident" aria-labelledby="incident-title">
      <div className="incident__line">
        {view.incident.id && <span className="incident-id">{view.incident.id}</span>}
        <h1 id="incident-title" className="incident__title">
          {view.incident.title}
        </h1>
        <span className={`status-pill status-pill--${status.tone}`}>
          <span className="status-pill__dot" aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <dl className="incident__facts">
        <div>
          <dt>Service</dt>
          <dd>{view.incident.service ?? 'Not reported'}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{view.incident.severity ?? 'Not reported'}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{opened ? <time dateTime={opened}>{clock(opened)}</time> : 'Not reported'}</dd>
        </div>
        <div>
          <dt>Run started</dt>
          <dd>
            <time dateTime={view.startedAt ?? undefined}>{clock(view.startedAt)}</time>
          </dd>
        </div>
      </dl>
      {summary && <p className="incident__summary">{summary}</p>}
    </section>
  );
}
