import type { RunView } from '../../shared/view';
import { useElapsed } from '../lib/api';
import { useConfig } from '../lib/config';
import { headlineFor } from '../lib/copy';
import { clock, duration, plural } from '../lib/format';
import { ExternalIcon } from './Icons';

export function StatusHeadline({ view }: { view: RunView }) {
  const config = useConfig();
  const decisionsEnabled = config?.decisionsEnabled ?? false;
  const copy = headlineFor(view, { decisionsEnabled });
  const elapsedMs = useElapsed(view);
  const elapsed = elapsedMs === null ? null : duration(elapsedMs);

  const sandboxRuns = view.sandbox.execCallIds.length;
  const automatic = view.counts.automatic - sandboxRuns;
  const awaiting = view.phase === 'awaiting_authorization';
  const reportHref = `?session=${encodeURIComponent(view.session.id)}&view=report`;

  return (
    <section className={`headline headline--${copy.tone}`} aria-labelledby="headline-title">
      <div aria-live="polite">
        <p className="headline__eyebrow">{copy.eyebrow}</p>
        <h2 id="headline-title" className="headline__title">
          {copy.title}
        </h2>
      </div>
      <p className="headline__body">{copy.body}</p>
      <div className="headline__actions">
        {awaiting && decisionsEnabled ? (
          <a className="link-button" href="#decision">
            Review and decide
          </a>
        ) : view.session.uiUrl ? (
          <a
            className={`link-button ${awaiting ? '' : 'link-button--quiet'}`}
            href={view.session.uiUrl}
            target="_blank"
            rel="noreferrer"
          >
            {awaiting ? 'Review and decide in TrueForge' : 'Open in TrueForge'}
            <ExternalIcon />
          </a>
        ) : (
          <span
            className="link-button link-button--disabled"
            title="Fixture replays have no TrueForge session"
          >
            No TrueForge session to open
          </span>
        )}
        <a className="link-button link-button--quiet" href={reportHref}>
          Incident report
        </a>
        <p className="headline__facts">
          <strong>{plural(Math.max(automatic, 0), 'automatic call')}</strong> ·{' '}
          <strong>{plural(sandboxRuns, 'sandbox command')}</strong> ·{' '}
          <strong>{plural(view.counts.gatedExecuted, 'external change')}</strong>
          {view.startedAt && (
            <>
              {' '}
              · started {clock(view.startedAt)}
              {elapsed && `, ${elapsed}`}
            </>
          )}
        </p>
      </div>
    </section>
  );
}
