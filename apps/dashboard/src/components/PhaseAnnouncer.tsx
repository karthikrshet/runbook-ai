import type { RunView } from '../../shared/view';
import { incidentStatus } from '../lib/console';
import { headlineFor } from '../lib/copy';

/**
 * Tells screen-reader users when the run changes state, including when autonomy stops at
 * the approval boundary. The text changes only with the phase or the current step, so the
 * view's frequent updates are not re-announced.
 */
export function PhaseAnnouncer({ view }: { view: RunView }) {
  const tool = view.gatedAction?.call.ref.tool;
  const message =
    view.phase === 'awaiting_authorization'
      ? `Autonomy paused. Human authorization required${tool ? ` for ${tool}` : ''}.`
      : `${incidentStatus(view).label}. ${headlineFor(view).title}.`;
  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {message}
    </p>
  );
}
