import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RunView, TimelineKind } from '../../shared/view';
import { stepForCall } from '../lib/console';
import { clock, plural } from '../lib/format';
import { useHighlight } from '../lib/highlight';
import { useStoredFlag } from '../lib/prefs';
import { CallDetail } from './CallDetail';
import { ChevronIcon } from './Icons';

const STICK_TO_BOTTOM_PX = 80;

type FilterKey = 'all' | 'tools' | 'sandbox' | 'approvals' | 'evidence' | 'agent';

const EVIDENCE_KINDS = new Set<TimelineKind>([
  'incident.received',
  'runbook.parsed',
  'evidence.added',
  'verification.completed',
  'untrusted.flagged',
]);

const FILTERS: readonly {
  key: FilterKey;
  label: string;
  match: (kind: TimelineKind) => boolean;
}[] = [
  { key: 'all', label: 'All', match: () => true },
  {
    key: 'tools',
    label: 'Tools',
    match: (kind) => kind.startsWith('tool.') || kind.startsWith('connectors.'),
  },
  { key: 'sandbox', label: 'Sandbox', match: (kind) => kind.startsWith('sandbox.') },
  {
    key: 'approvals',
    label: 'Approvals',
    match: (kind) =>
      kind.startsWith('approval.') ||
      kind.startsWith('action.') ||
      kind === 'boundary.crossed' ||
      kind === 'run.paused',
  },
  { key: 'evidence', label: 'Evidence', match: (kind) => EVIDENCE_KINDS.has(kind) },
  {
    key: 'agent',
    label: 'Agent',
    match: (kind) =>
      kind.startsWith('agent.') ||
      kind.startsWith('run.') ||
      kind.startsWith('subagent.') ||
      kind === 'client.waiting',
  },
];

/**
 * TrueForge's event log for the session, oldest first, following new events. Each
 * entry carries a RunbookAI event kind; entries for a tool call expand to what
 * TrueForge recorded for it, with secrets already redacted by the server.
 */
export function EventLog({ view }: { view: RunView }) {
  const { toolCallId } = useHighlight();
  const listRef = useRef<HTMLOListElement>(null);
  const followRef = useRef(true);
  const [collapsed, setCollapsed] = useStoredFlag('runbookai.timeline.collapsed', false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const match = FILTERS.find((candidate) => candidate.key === filter)?.match ?? (() => true);
  const entries = view.timeline.filter((entry) => match(entry.kind));
  const calls = new Map(view.toolCalls.map((call) => [call.id, call]));
  const demo = view.source.kind === 'fixture';
  const count = entries.length;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [count, collapsed]);

  useEffect(() => {
    if (!toolCallId) return;
    const target = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [toolCallId]);

  return (
    <section className="console-timeline" aria-labelledby="log-title" data-collapsed={collapsed}>
      <div className="timeline-head">
        <button
          type="button"
          className="icon-button"
          aria-expanded={!collapsed}
          aria-controls="timeline-list"
          aria-label={collapsed ? 'Show the execution timeline' : 'Hide the execution timeline'}
          onClick={() => {
            setCollapsed(!collapsed);
          }}
        >
          <ChevronIcon className={`icon chevron ${collapsed ? '' : 'chevron--open'}`} />
        </button>
        <h2 id="log-title" className="label">
          Execution timeline
        </h2>
        <span className="panel-head__sub">{plural(view.counts.events, 'TrueForge event')}</span>
        {!collapsed && (
          <div className="filters" role="group" aria-label="Show events of one kind">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="filter"
                aria-pressed={filter === option.key}
                onClick={() => {
                  setFilter(option.key);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!collapsed && (
        <ol
          id="timeline-list"
          className="log__list"
          ref={listRef}
          tabIndex={0}
          aria-label="Session events, oldest first"
          onScroll={(event) => {
            const list = event.currentTarget;
            followRef.current =
              list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
          }}
        >
          {entries.map((entry) => {
            const call = entry.toolCallId ? calls.get(entry.toolCallId) : undefined;
            const step = stepForCall(view, entry.toolCallId);
            const expanded = openEntry === entry.id;
            const citedBy = call
              ? (view.evidence?.items ?? []).filter(
                  (item) => item.provenance?.toolCallId === call.id,
                )
              : [];
            return (
              <li
                key={entry.id}
                className={`entry entry--${entry.tone}`}
                data-highlighted={toolCallId !== null && entry.toolCallId === toolCallId}
              >
                <time dateTime={entry.at}>{clock(entry.at)}</time>
                <code className="entry__kind">{entry.kind}</code>
                <span
                  className="entry__step"
                  title={step ? `Runbook step ${String(step.index ?? '')}` : undefined}
                >
                  {step?.index != null ? String(step.index).padStart(2, '0') : '—'}
                </span>
                <span className="entry__label">
                  {entry.label}
                  {entry.threadId && <span className="entry__thread">· subagent</span>}
                </span>
                <p className="entry__title">
                  {entry.title}
                  {entry.detail && <span className="entry__detail"> · {entry.detail}</span>}
                </p>
                {call && (
                  <button
                    type="button"
                    className="entry__toggle icon-button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} what TrueForge recorded for ${entry.title}`}
                    onClick={() => {
                      setOpenEntry(expanded ? null : entry.id);
                    }}
                  >
                    <ChevronIcon className={`icon chevron ${expanded ? 'chevron--open' : ''}`} />
                  </button>
                )}
                {expanded && call && (
                  <div className="entry__details">
                    <CallDetail call={call} demo={demo} />
                    {citedBy.length > 0 && (
                      <p className="hint">
                        Cited by evidence: {citedBy.map((item) => item.label).join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {entries.length === 0 && (
            <li className="empty">
              {view.timeline.length === 0
                ? 'No timeline events yet.'
                : 'No events of this kind yet.'}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
