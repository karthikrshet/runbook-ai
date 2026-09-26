import type { RunView } from '../../shared/view';
import { plural } from '../lib/format';

/** Always shown for fixture data, so a replay is never mistaken for a live run. */
export function SourceBanner({ view }: { view: RunView }) {
  if (view.source.kind !== 'fixture') return null;
  return (
    <div className="source-banner" role="note">
      <strong>Demo mode · synthetic fixture</strong>
      Replaying a hand-written event log for UI development. None of this happened in TrueForge.
    </div>
  );
}

/** Marks raw output that comes from the fixture, next to where real output would appear. */
export function DemoTag() {
  return (
    <span className="demo-tag" title="From the synthetic fixture, not from TrueForge">
      Demo data
    </span>
  );
}

export function BoundaryAlerts({ view }: { view: RunView }) {
  const violations = view.violations.filter((v) => v.severity === 'violation');
  const gaps = view.violations.filter((v) => v.severity === 'gap');
  return (
    <>
      {violations.map((violation) => (
        <div className="alert alert--violation" role="alert" key={violation.toolCallId}>
          <strong>Approval boundary crossed.</strong>
          {violation.message} Set <code>requireApprovalForTools</code> on this connector in
          TrueForge.
        </div>
      ))}
      {gaps.length > 0 && (
        <div className="alert alert--gap" role="status">
          <strong>{plural(gaps.length, 'tool call')} outside the permission matrix.</strong>
          Their risk is unknown until they are classified:{' '}
          {gaps.map((gap) => gap.message).join(' ')}
        </div>
      )}
    </>
  );
}

export function StreamProblem({ problem }: { problem: string | null }) {
  if (!problem) return null;
  return (
    <div className="alert alert--stream" role="status">
      {problem}
    </div>
  );
}
