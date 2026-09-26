import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { RunView, TrackItemView } from '../../shared/view';
import { callsDuration, POLICY_DECISION_TEXT, stepCalls, stepEvidence } from '../lib/console';
import { duration, plural } from '../lib/format';
import { CallDetail } from './CallDetail';
import { ClassChip } from './ClassChip';
import { EvidenceItems } from './Evidence';
import { STEP_STATE_TEXT } from './RunbookTrack';

interface StepDetailProps {
  view: RunView;
  item: TrackItemView;
  onClose: () => void;
}

function emptyText(item: TrackItemView): string {
  if (item.status === 'pending')
    return 'Not started. TrueForge has recorded nothing for this step yet.';
  if (item.evidenceKeys.length === 0 && item.detail === null) {
    return 'This step names no tool, and TrueForge does not record which calls belong to a step.';
  }
  return 'TrueForge has not recorded a call for this step.';
}

/** One runbook step, with the tool calls and evidence TrueForge recorded for it. */
export function StepDetail({ view, item, onClose }: StepDetailProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const calls = stepCalls(view, item);
  const evidence = stepEvidence(view, item);
  const missing = item.evidenceKeys.filter((key) => !evidence.some((entry) => entry.key === key));
  const ms = callsDuration(calls);
  const demo = view.source.kind === 'fixture';

  useEffect(() => {
    headingRef.current?.focus();
  }, [item.key]);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <section
      className="panel step-detail"
      aria-labelledby="step-detail-title"
      onKeyDown={onKeyDown}
    >
      <div className="panel__head">
        <h2 id="step-detail-title" className="label" tabIndex={-1} ref={headingRef}>
          {item.index !== null ? `Step ${String(item.index).padStart(2, '0')} · ` : ''}
          {item.title}
        </h2>
        <span className={`step-state step-state--${item.status}`}>
          {STEP_STATE_TEXT[item.status]}
        </span>
        <button type="button" className="text-button" onClick={onClose}>
          Back to the live operation
        </button>
      </div>
      <div className="panel__body">
        <dl className="kv kv--inline">
          <div className="kv__row">
            <dt>Boundary</dt>
            <dd>{item.actionClass ? <ClassChip value={item.actionClass} /> : 'Mixed'}</dd>
          </div>
          <div className="kv__row">
            <dt>Approval</dt>
            <dd>{item.requiresApproval ? 'Required before it runs' : 'Not required'}</dd>
          </div>
          {item.detail && (
            <div className="kv__row">
              <dt>Tool</dt>
              <dd>
                <code>{item.detail}</code>
              </dd>
            </div>
          )}
          <div className="kv__row">
            <dt>Duration</dt>
            <dd>{ms === null ? 'Not finished' : duration(ms)}</dd>
          </div>
          <div className="kv__row">
            <dt>Recorded</dt>
            <dd>
              {plural(calls.length, 'tool call')} · {plural(evidence.length, 'evidence item')}
            </dd>
          </div>
        </dl>

        {item.evidenceKeys.length > 0 && (
          <section className="evidence" aria-labelledby="step-evidence-title">
            <h3 id="step-evidence-title" className="sublabel">
              Evidence this step requires
            </h3>
            {evidence.length > 0 && <EvidenceItems items={evidence} />}
            {missing.length > 0 && <p className="empty">Not reported yet: {missing.join(', ')}.</p>}
          </section>
        )}

        <section aria-labelledby="step-calls-title">
          <h3 id="step-calls-title" className="sublabel">
            Tool calls TrueForge recorded
          </h3>
          {calls.length === 0 ? (
            <p className="empty">{emptyText(item)}</p>
          ) : (
            <div className="calls">
              {calls.map((call) => (
                <CallDetail key={call.id} call={call} demo={demo} />
              ))}
            </div>
          )}
          {calls.some(
            (call) => call.decision !== 'auto' && call.decision !== 'auto_in_sandbox',
          ) && (
            <p className="hint">
              Policy for these calls:{' '}
              {[...new Set(calls.map((call) => POLICY_DECISION_TEXT[call.decision].label))].join(
                ', ',
              )}
              .
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
