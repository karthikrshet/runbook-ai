import { useEffect, useState } from 'react';
import type {
  DashboardConfigView,
  DecisionRequest,
  DecisionResponse,
  PreflightView,
  RunbookSummaryView,
  RunView,
  SessionSummaryView,
  StartRunRequest,
  StartRunResponse,
  StreamMessage,
} from '../../shared/view';

/**
 * Every page lives at the app's root (pages differ only by query string), so a
 * page-relative URL always reaches the server's /api, including when a proxy
 * serves the dashboard under a path prefix such as https://host/runbook/.
 * Never make these root-absolute.
 */
function apiUrl(path: string): string {
  return `api/${path}`;
}

async function readBody<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `The dashboard server answered ${String(response.status)}.`);
  }
  return body;
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } });
  return readBody<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return readBody<T>(response);
}

/** Sends a human decision; the server forwards it to TrueForge as a tool approval. */
export function postDecision(
  sessionId: string,
  request: DecisionRequest,
): Promise<DecisionResponse> {
  return postJson<DecisionResponse>(
    apiUrl(`sessions/${encodeURIComponent(sessionId)}/decisions`),
    request,
  );
}

export function startRun(request: StartRunRequest): Promise<StartRunResponse> {
  return postJson<StartRunResponse>(apiUrl('runs'), request);
}

export async function fetchRunbooks(signal: AbortSignal): Promise<RunbookSummaryView[]> {
  const body = await getJson<{ runbooks: RunbookSummaryView[] }>(apiUrl('runbooks'), signal);
  return body.runbooks;
}

export function fetchPreflight(signal: AbortSignal): Promise<PreflightView> {
  return getJson<PreflightView>(apiUrl('preflight'), signal);
}

export function fetchConfig(signal: AbortSignal): Promise<DashboardConfigView> {
  return getJson<DashboardConfigView>(apiUrl('config'), signal);
}

export async function fetchSessions(signal: AbortSignal): Promise<SessionSummaryView[]> {
  const body = await getJson<{ sessions: SessionSummaryView[] }>(apiUrl('sessions'), signal);
  return body.sessions;
}

export type Connection = 'connecting' | 'live' | 'retrying';

export interface RunStream {
  view: RunView | null;
  /** Latest problem reported by the server or the connection, if any. */
  problem: string | null;
  connection: Connection;
}

/** Subscribes to the server's view of one session. The stream is read-only. */
export function useRunStream(sessionId: string): RunStream {
  const [state, setState] = useState<RunStream>({
    view: null,
    problem: null,
    connection: 'connecting',
  });

  useEffect(() => {
    const source = new EventSource(apiUrl(`sessions/${encodeURIComponent(sessionId)}/stream`));
    source.onopen = () => {
      setState((prev) => ({ ...prev, connection: 'live' }));
    };
    source.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as StreamMessage;
      setState((prev) =>
        message.type === 'view'
          ? { view: message.view, problem: null, connection: 'live' }
          : { ...prev, problem: message.message },
      );
    };
    source.onerror = () => {
      setState((prev) => ({
        ...prev,
        connection: 'retrying',
        problem: prev.problem ?? 'Lost the connection to the dashboard server. Reconnecting…',
      }));
    };
    return () => {
      source.close();
    };
  }, [sessionId]);

  return state;
}

/**
 * Milliseconds since the run's first event: live while the agent works, else up to its
 * last event. A fixture replay is measured in its recorded time, not the wall clock.
 */
export function useElapsed(view: RunView): number | null {
  const running =
    (view.phase === 'acting' || view.phase === 'authorized') && view.source.kind !== 'fixture';
  const now = useNow(running);
  if (!view.startedAt) return null;
  const end = running ? now : Date.parse(view.lastEventAt ?? view.generatedAt);
  return Math.max(0, end - Date.parse(view.startedAt));
}

/** Re-renders every `intervalMs` while `active`, for elapsed-time displays. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [active, intervalMs]);
  return now;
}
