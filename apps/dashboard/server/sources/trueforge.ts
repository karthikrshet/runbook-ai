import {
  TrueForge,
  TrueForgeError,
  TrueForgeTimeoutError,
  type TrueForgeApi,
} from '@truefoundry/trueforge-sdk';
import { redactText } from '@runbook-ai/core';
import type { SessionSummaryView, SourceInfo } from '../../shared/view.js';
import {
  RunNotStartedError,
  SessionNotFoundError,
  type SessionActions,
  type SessionEventItem,
  type SessionMeta,
  type SessionSnapshot,
  type SessionSource,
  type WriteFailure,
  type WriteOutcome,
} from './types.js';

const PAGE_SIZE = 100;
/** Upper bound on pages read per poll (5,000 events). */
const MAX_PAGES = 50;
/** Writes are never retried: a retry could record a decision or start a run twice. */
const NO_RETRY = { maxRetries: 0 } as const;

/**
 * Talks to a running TrueForge server through the official SDK. Reads use
 * sessions.list/get/listEvents and agents.list. The two writes, sessions.createTurn
 * with a `user.tool_approval` and sessions.create for a new run, are the same calls
 * TrueForge's own UI makes. sessions.delete only removes a new run's session again when
 * TrueForge refused its first turn.
 */
export class TrueForgeSource implements SessionSource, SessionActions {
  readonly info: SourceInfo;
  private readonly client: TrueForge;
  private readonly cache = new Map<string, SessionEventItem[]>();

  constructor(
    private readonly options: { baseUrl: string; publicUrl: string; token: string | undefined },
  ) {
    this.info = { kind: 'trueforge', label: `TrueForge at ${options.baseUrl}` };
    this.client = new TrueForge({
      baseUrl: options.baseUrl,
      ...(options.token ? { token: options.token } : {}),
      timeoutInSeconds: 10,
      maxRetries: 1,
    });
  }

  /** Opened by the browser, so it uses the public address, not the API one. */
  sessionUiUrl(sessionId: string): string {
    return `${this.options.publicUrl}/sessions/${encodeURIComponent(sessionId)}`;
  }

  async listSessions(signal: AbortSignal): Promise<SessionSummaryView[]> {
    const page = await this.client.sessions.list({ limit: 25 }, { abortSignal: signal });
    return page.data.map((session) => {
      const meta = toMeta(session);
      return {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        turns: meta.turns,
      };
    });
  }

  async fetchSnapshot(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot> {
    try {
      const [session, events] = await Promise.all([
        this.client.sessions.get(sessionId, { abortSignal: signal }),
        this.fetchEvents(sessionId, signal),
      ]);
      return { session: toMeta(session.data), events };
    } catch (error) {
      if (error instanceof TrueForgeError && error.statusCode === 404) {
        throw new SessionNotFoundError(sessionId);
      }
      throw error;
    }
  }

  release(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  async decide(input: Parameters<SessionActions['decide']>[0]): Promise<{ turnId: string }> {
    const approval: TrueForgeApi.ApprovalDecision =
      input.decision === 'allow'
        ? { status: 'allow' }
        : { status: 'deny', ...(input.reason ? { reason: input.reason } : {}) };
    const turn = await this.client.sessions.createTurn(
      input.sessionId,
      {
        input: [
          {
            type: 'user.tool_approval',
            threadId: input.threadId,
            toolCallId: input.toolCallId,
            approval,
          },
        ],
      },
      NO_RETRY,
    );
    return { turnId: turn.data.id };
  }

  async startRun(input: Parameters<SessionActions['startRun']>[0]): Promise<{ sessionId: string }> {
    const created = await this.client.sessions.create(
      { agent: { name: input.agentName }, metadata: input.metadata },
      NO_RETRY,
    );
    const sessionId = created.data.id;
    // A title makes the session easy to find in TrueForge; the run does not depend on it.
    await this.client.sessions
      .update(sessionId, { title: input.title }, NO_RETRY)
      .catch(() => undefined);
    try {
      await this.client.sessions.createTurn(
        sessionId,
        { input: [{ type: 'user.message', content: input.prompt }] },
        NO_RETRY,
      );
    } catch (error) {
      // A session without its first turn never moves, so it is removed when the turn surely
      // did not start. When that is unknown it is kept: the agent may be working in it.
      const removed =
        (writeOutcome(error) ?? 'unknown') !== 'unknown' &&
        (await this.client.sessions.delete(sessionId, NO_RETRY).then(
          () => true,
          () => false,
        ));
      throw new RunNotStartedError(sessionId, removed, error);
    }
    return { sessionId };
  }

  async findAgent(name: string, signal: AbortSignal): Promise<TrueForgeApi.Agent | null> {
    const page = await this.client.agents.list(
      { agentName: name, limit: 100 },
      { abortSignal: signal },
    );
    return page.data.find((agent) => agent.name === name) ?? null;
  }

  /** Reads newest-first pages until it reaches an event it already has. */
  private async fetchEvents(sessionId: string, signal: AbortSignal): Promise<SessionEventItem[]> {
    const cached = this.cache.get(sessionId) ?? [];
    const known = new Set(cached.map((item) => item.event.id));
    const freshNewestFirst: SessionEventItem[] = [];
    let overlapId: string | null = null;

    let page = await this.client.sessions.listEvents(
      sessionId,
      { limit: PAGE_SIZE },
      { abortSignal: signal },
    );
    for (let pagesRead = 1; ; pagesRead++) {
      for (const item of page.data) {
        if (known.has(item.event.id)) {
          overlapId = item.event.id;
          break;
        }
        freshNewestFirst.push(item);
      }
      if (overlapId !== null || !page.hasNextPage() || pagesRead >= MAX_PAGES) break;
      page = await page.getNextPage();
    }

    const merged = mergeLineage(cached, freshNewestFirst, overlapId);
    this.cache.set(sessionId, merged);
    return merged;
  }
}

/**
 * Combines cached events (oldest first) with a fresh newest-first read that stopped
 * at `overlapId`. Events are immutable and the lineage below any known event is
 * fixed, so everything up to the overlap is kept and cached events after it are
 * replaced (they belonged to a branch the session no longer follows).
 */
export function mergeLineage(
  cached: readonly SessionEventItem[],
  freshNewestFirst: readonly SessionEventItem[],
  overlapId: string | null,
): SessionEventItem[] {
  const freshOldestFirst = [...freshNewestFirst].reverse();
  if (overlapId === null) return freshOldestFirst;
  const overlapIndex = cached.findIndex((item) => item.event.id === overlapId);
  return [...cached.slice(0, overlapIndex + 1), ...freshOldestFirst];
}

/**
 * Turns a failed read into a message that says what went wrong and how to fix it. Only
 * the session stream retries on its own; a one-off request's message does not promise it.
 */
export function describeTrueForgeError(
  error: unknown,
  baseUrl: string,
  mode: 'stream' | 'request' = 'stream',
): string {
  const retrying = mode === 'stream' ? ' This view keeps retrying.' : '';
  if (error instanceof SessionNotFoundError) return `${error.message} in TrueForge at ${baseUrl}.`;
  if (isTimeout(error)) return `TrueForge at ${baseUrl} did not answer within 10 s.${retrying}`;
  if (error instanceof TrueForgeError && error.statusCode !== undefined) {
    if (isAuthStatus(error.statusCode)) {
      return `TrueForge refused the request (${error.statusCode}).${AUTH_HINT}`;
    }
    const said = serverMessage(error.body);
    return `TrueForge returned HTTP ${error.statusCode}${said ? `: ${said}` : ''}.${retrying}`;
  }
  return (
    `Can't reach TrueForge at ${baseUrl}. Start it with "npx @truefoundry/trueforge", ` +
    'or see the labelled demo replay with DASHBOARD_SOURCE=fixture (npm run dev:fixture).' +
    (mode === 'stream' ? ' This view reconnects on its own.' : '')
  );
}

/**
 * Explains a failed write by what TrueForge may have recorded. Writes are never retried,
 * so nothing here promises a retry. Returns null for an error that did not come from
 * talking to TrueForge; that is the dashboard's own failure.
 */
export function describeTrueForgeWriteError(error: unknown, baseUrl: string): WriteFailure | null {
  const failure = error instanceof RunNotStartedError ? error.cause : error;
  const outcome = writeOutcome(failure);
  if (outcome === null) return null;
  const what = whatFailed(failure, baseUrl);
  const auth = failure instanceof TrueForgeError && isAuthStatus(failure.statusCode) ? AUTH_HINT : '';

  if (error instanceof RunNotStartedError) {
    if (error.removed) {
      return {
        outcome,
        message: `${what}, so the run did not start. The empty session TrueForge created for it was removed.${auth}`,
      };
    }
    return {
      outcome,
      sessionId: error.sessionId,
      message:
        outcome === 'unknown'
          ? `TrueForge created session ${error.sessionId} but did not confirm that its first turn started: ${what}. The agent may already be working, so open the session before starting another run.`
          : `${what}, so the run did not start. TrueForge created session ${error.sessionId} for it, which is empty and could not be removed.${auth}`,
    };
  }
  switch (outcome) {
    case 'not_sent':
      return {
        outcome,
        message: `${what}, so nothing was sent. Check that it is running, then try again.`,
      };
    case 'refused':
      return { outcome, message: `${what}, so nothing was recorded.${auth}` };
    case 'unknown':
      return {
        outcome,
        message: `${what}. It may or may not have recorded the request, and the dashboard did not retry it. Check TrueForge before trying again.`,
      };
  }
}

const AUTH_HINT = ' If auth is enabled, set TRUEFORGE_TOKEN for the dashboard.';

/** Socket errors raised before a request reached TrueForge, so it cannot have recorded it. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

/** What a failed write means for TrueForge's record; null if TrueForge was not involved. */
function writeOutcome(error: unknown): WriteOutcome | null {
  if (isTimeout(error)) return 'unknown';
  if (!(error instanceof TrueForgeError)) return null;
  if (error.statusCode === undefined) {
    const code = socketCode(error);
    return code !== undefined && NEVER_SENT.has(code) ? 'not_sent' : 'unknown';
  }
  // A 4xx is a refusal. A 5xx may come after TrueForge recorded the request.
  return error.statusCode >= 500 ? 'unknown' : 'refused';
}

/** The failure as a clause, for a write whose outcome writeOutcome() classified. */
function whatFailed(error: unknown, baseUrl: string): string {
  if (isTimeout(error)) return `TrueForge at ${baseUrl} did not answer within 10 s`;
  if (!(error instanceof TrueForgeError) || error.statusCode === undefined) {
    return writeOutcome(error) === 'not_sent'
      ? `Can't reach TrueForge at ${baseUrl}`
      : `The connection to TrueForge at ${baseUrl} broke before it answered`;
  }
  const said = serverMessage(error.body);
  const status = `HTTP ${String(error.statusCode)}${said ? `: ${said}` : ''}`;
  return error.statusCode >= 500
    ? `TrueForge failed with ${status}`
    : `TrueForge refused the request (${status})`;
}

/**
 * The SDK's own timeout. On Node 22 it arrives as a plain TrueForgeError whose cause is
 * the abort reason 'timeout', not as TrueForgeTimeoutError.
 */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof TrueForgeTimeoutError ||
    (error instanceof TrueForgeError && error.statusCode === undefined && error.cause === 'timeout')
  );
}

function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** The socket error code under the SDK's wrapping (TrueForgeError, then fetch's TypeError). */
function socketCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

/** TrueForge's own explanation from an error body, redacted and kept short. */
function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const nested = record['error'];
  const candidates = [
    typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>)['message']
      : nested,
    record['message'],
    record['detail'],
  ];
  const text = candidates.find((value): value is string => typeof value === 'string');
  if (!text) return null;
  const clean = redactText(text).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

function toMeta(session: TrueForgeApi.Session): SessionMeta {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turns: session.metrics.totalTurns,
    costUsd: session.metrics.totalCostInUsd ?? null,
  };
}
