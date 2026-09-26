import type { RunView } from '../../shared/view';
import { announcementFor } from '../lib/copy';

/**
 * Tells screen-reader users when the run changes state, including when autonomy stops at
 * the approval boundary and which actions are waiting there. The text changes only with the
 * phase, the current step or the set of waiting calls, so the view's frequent updates are
 * not re-announced.
 */
export function PhaseAnnouncer({ view }: { view: RunView }) {
  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {announcementFor(view)}
    </p>
  );
}
