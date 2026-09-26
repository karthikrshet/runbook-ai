import {
  TrueForge,
  TrueForgeError,
  TrueForgeTimeoutError,
  type TrueForgeApi,
} from '@truefoundry/trueforge-sdk';
import type { SessionSummaryView, SourceInfo } from '../../shared/view.js';
import {
  SessionNotFoundError,
  type SessionActions,
  type SessionEventItem,
  type SessionMeta,
  type SessionSnapshot,
  type SessionSource,
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
 * TrueForge's own UI makes.
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
    await this.client.sessions.createTurn(
      sessionId,
      { input: [{ type: 'user.message', content: input.prompt }] },
      NO_RETRY,
    );
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

/** Turns a failure into a message that says what went wrong and how to fix it. */
export function describeTrueForgeError(error: unknown, baseUrl: string): string {
  const unreachable =
    `Can't reach TrueForge at ${baseUrl}. Start it with "npx @truefoundry/trueforge", ` +
    'or see the labelled demo replay with DASHBOARD_SOURCE=fixture (npm run dev:fixture). ' +
    'This view reconnects on its own.';
  if (error instanceof SessionNotFoundError) return `${error.message} in TrueForge at ${baseUrl}.`;
  if (error instanceof TrueForgeTimeoutError) {
    return `TrueForge at ${baseUrl} did not answer within 10 s. This view keeps retrying.`;
  }
  if (error instanceof TrueForgeError && error.statusCode !== undefined) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return `TrueForge refused the request (${error.statusCode}). If auth is enabled, set TRUEFORGE_TOKEN for the dashboard.`;
    }
    return `TrueForge returned HTTP ${error.statusCode}. This view keeps retrying.`;
  }
  return unreachable;
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
