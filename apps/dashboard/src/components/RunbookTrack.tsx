import { useEffect, useRef, useState } from 'react';
import type { RunView, TrackItemView, TrackStatus } from '../../shared/view';
import { callsDuration, stepCalls, stepEvidence } from '../lib/console';
import { LINE_STATE_TEXT } from '../lib/copy';
import { clock, duration, STEP_STATUS_LABELS } from '../lib/format';
import { ClassChip } from './ClassChip';
import { ChevronIcon, ExternalIcon } from './Icons';

/** Step states in words, so status never depends on colour alone. */
export const STEP_STATE_TEXT: Record<TrackStatus, string> = STEP_STATUS_LABELS;

function stateLabel(item: TrackItemView): string {
  // Policy never runs a forbidden step, so a pending one is blocked, not merely waiting.
  if (item.actionClass === 'FORBIDDEN' && item.status === 'pending') return 'Blocked';
  return STEP_STATE_TEXT[item.status];
}

/** The integration a step used, as TrueForge recorded it; before it runs, the tool it names. */
function integrationFor(view: RunView, item: TrackItemView): string | null {
  if (item.detail === null && item.requiresApproval && item.actionClass !== 'SANDBOX_ONLY') {
    return 'Human decision';
  }
  // The class chip already says SANDBOX; the room goes to duration and evidence.
  if (item.actionClass === 'SANDBOX_ONLY') return null;
  const calls = stepCalls(view, item);
  const own = calls.find((call) => call.ref.tool === item.detail) ?? calls[0];
  if (own) return own.exec ? 'Sandbox' : (own.system ?? own.ref.server);
  return item.detail;
}

interface StepProps {
  item: TrackItemView;
  view: RunView;
  selected: boolean;
  onSelect: (key: string | null) => void;
}

function Step({ item, view, selected, onSelect }: StepProps) {
  const ms = callsDuration(stepCalls(view, item));
  const evidence = stepEvidence(view, item).length;
  const meta = [
    integrationFor(view, item),
    ms === null ? null : duration(ms),
    item.evidenceKeys.length > 0
      ? `${String(evidence)}/${String(item.evidenceKeys.length)} evidence`
      : null,
  ].filter((part): part is string => part !== null);
  const approval = item.requiresApproval ? ', needs a human decision' : '';
  const state = stateLabel(item);
  // Routine states are shown by the node's shape (filled or hollow); exceptions get a word too.
  const routine = item.status === 'done' || state === 'Pending';

  return (
    <li
      className={`step step--${item.status} ${selected ? 'step--selected' : ''}`}
      aria-current={item.status === 'active' ? 'step' : undefined}
    >
      <button
        type="button"
        className="step__button"
        aria-pressed={selected}
        title={item.detail ? `Tool: ${item.detail}` : undefined}
        onClick={() => {
          onSelect(selected ? null : item.key);
        }}
      >
        <span className="step__node" aria-hidden="true" />
        <span className="step__num">
          {item.index === null ? '' : String(item.index).padStart(2, '0')}
        </span>
        <span className="step__title">
          {item.title}
          {approval && <span className="visually-hidden">{approval}</span>}
        </span>
        <span className="step__meta">
          <span className={routine ? 'visually-hidden' : `step-state step-state--${item.status}`}>
            {state}
          </span>
          {meta.length > 0 && <span className="step__detail">{meta.join(' · ')}</span>}
          {item.actionClass && <ClassChip value={item.actionClass} className="step__chip" />}
        </span>
      </button>
    </li>
  );
}

function AuthorizationLine({ view }: { view: RunView }) {
  const { lineState } = view.track;
  const ref = useRef<HTMLDivElement>(null);
  const decidedAt = view.gatedAction?.call.approval?.decidedAt;

  // When TrueForge stops the run, bring the line into view in its own column.
  useEffect(() => {
    if (lineState === 'at_danger')
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lineState]);
  const text =
    lineState === 'cleared' && decidedAt
      ? `Approved in TrueForge at ${clock(decidedAt)}.`
      : lineState === 'rejected' && decidedAt
        ? `Rejected in TrueForge at ${clock(decidedAt)}. The action did not run.`
        : LINE_STATE_TEXT[lineState];

  return (
    <div
      ref={ref}
      className={`authline authline--${lineState}`}
      role="group"
      aria-label="Authorization line"
    >
      <span className="authline__lamp" aria-hidden="true" />
      <div className="authline__body">
        <p className="authline__label">Authorization line</p>
        <p className="authline__state">{text}</p>
        {lineState === 'at_danger' && view.session.uiUrl && (
          <a className="authline__link" href={view.session.uiUrl} target="_blank" rel="noreferrer">
            Decide in TrueForge
            <ExternalIcon />
          </a>
        )}
      </div>
    </div>
  );
}

/** Narrow screens start with the steps folded away; wide ones always show them. */
function useNarrow(query: string): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => {
      setNarrow(list.matches);
    };
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return narrow;
}

interface RunbookTrackProps {
  view: RunView;
  selected: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * The runbook as a track. Steps above the authorization line run on their own;
 * steps below it wait in a hatched zone until TrueForge records a human decision.
 * Selecting a step opens what TrueForge recorded for it.
 */
export function RunbookTrack({ view, selected, onSelect }: RunbookTrackProps) {
  const { track } = view;
  const narrow = useNarrow('(max-width: 1023px)');
  const [folded, setFolded] = useState(narrow);
  const before = track.items.slice(0, track.lineIndex);
  const after = track.items.slice(track.lineIndex);
  const done = track.items.filter((item) => item.status === 'done').length;
  const showSteps = !narrow || !folded;

  return (
    <nav className={`track track--${track.lineState}`} aria-labelledby="track-title">
      <div className="panel-head">
        <h2 id="track-title" className="label">
          {track.mode === 'runbook' ? 'Incident runbook' : track.title}
        </h2>
        {track.subtitle && <span className="panel-head__sub">{track.subtitle}</span>}
      </div>
      <p className="track__progress">
        {done} of {track.items.length} steps succeeded
        {narrow && (
          <button
            type="button"
            className="text-button"
            aria-expanded={showSteps}
            onClick={() => {
              setFolded(!folded);
            }}
          >
            {showSteps ? 'Hide steps' : 'Show steps'}
            <ChevronIcon className={`icon chevron ${showSteps ? 'chevron--open' : ''}`} />
          </button>
        )}
      </p>
      {showSteps && before.length > 0 && (
        <ol className="track__list">
          {before.map((item) => (
            <Step
              key={item.key}
              item={item}
              view={view}
              selected={selected === item.key}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
      <AuthorizationLine view={view} />
      {showSteps && after.length > 0 && (
        <ol className="track__list track__list--gated">
          {after.map((item) => (
            <Step
              key={item.key}
              item={item}
              view={view}
              selected={selected === item.key}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </nav>
  );
}
