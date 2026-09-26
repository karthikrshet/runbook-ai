import { useEffect, useState } from 'react';
import type { DashboardConfigView, SessionSummaryView } from '../../shared/view';
import { fetchSessions, useNow } from '../lib/api';
import { plural, since } from '../lib/format';
import { ArrowIcon } from './Icons';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; sessions: SessionSummaryView[] }
  | { state: 'failed'; message: string };

export function SessionPicker({ config }: { config: DashboardConfigView | null }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchSessions(controller.signal)
      .then((sessions) => {
        setLoad({ state: 'ready', sessions });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          state: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const now = useNow(false);
  const fixture = config?.source.kind === 'fixture';

  return (
    <main className="state">
      <p className="label">
        {fixture ? 'Synthetic fixture replay' : (config?.source.label ?? 'TrueForge')}
      </p>
      <h1 className="state__title">Pick a session to watch</h1>
      <p className="state__body">
        Each session is TrueForge running an incident runbook. RunbookAI shows what the agent did on
        its own, what it proved, and where it stopped for a human. It acts until acting becomes
        dangerous; every decision is recorded in TrueForge.
      </p>
      {(config?.startRunsEnabled || fixture) && (
        <p>
          <a className="link-button" href="?view=new">
            {fixture ? 'Preview starting a run' : 'Start a run'}
          </a>
        </p>
      )}

      {load.state === 'loading' && <p className="hint">Loading sessions…</p>}

      {load.state === 'failed' && (
        <div className="alert alert--stream" role="alert">
          {load.message}{' '}
          <button
            type="button"
            className="prov"
            onClick={() => {
              setLoad({ state: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {load.state === 'ready' && load.sessions.length === 0 && (
        <p className="state__body">
          No sessions yet. Start one in TrueForge
          {config?.trueforgeUiUrl ? (
            <>
              {' '}
              at{' '}
              <a href={config.trueforgeUiUrl} target="_blank" rel="noreferrer">
                {config.trueforgeUiUrl}
              </a>
            </>
          ) : null}
          , then reload this page.
        </p>
      )}

      {load.state === 'ready' && load.sessions.length > 0 && (
        <ul className="sessions">
          {load.sessions.map((session) => (
            <li key={session.id}>
              <a href={`?session=${encodeURIComponent(session.id)}`}>
                <span className="sessions__title">
                  {session.title ?? 'Untitled session'}
                  {fixture && <span className="chip chip--demo">Demo</span>}
                </span>
                <span className="sessions__id">
                  {session.id} · {plural(session.turns, 'turn')} · updated{' '}
                  {since(session.updatedAt, now)}
                </span>
                <span className="sessions__open">
                  Open console
                  <ArrowIcon />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
