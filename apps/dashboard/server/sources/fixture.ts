import { approvalCutIndex, buildInc001Events } from '../../fixtures/inc-001.js';
import type { SessionSummaryView, SourceInfo } from '../../shared/view.js';
import {
  SessionNotFoundError,
  type SessionEventItem,
  type SessionSnapshot,
  type SessionSource,
} from './types.js';

interface FixtureSession {
  id: string;
  title: string;
  events: SessionEventItem[];
}

/**
 * Replays the synthetic INC-001 fixture for UI development. Events appear one at a
 * time, `paceMs` apart, starting when a session is first watched. The dashboard
 * labels this source as synthetic everywhere it appears.
 */
export class FixtureSource implements SessionSource {
  readonly info: SourceInfo = {
    kind: 'fixture',
    label: 'Synthetic fixture replay. Not a live TrueForge session.',
  };
  private readonly sessions: FixtureSession[];
  private readonly replayStartedAt = new Map<string, number>();

  constructor(
    private readonly paceMs: number,
    private readonly now: () => number = Date.now,
  ) {
    const events = buildInc001Events();
    this.sessions = [
      {
        id: 'fixture-inc-001-awaiting',
        title: 'INC-001 · stops at the authorization line',
        events: events.slice(0, approvalCutIndex(events)),
      },
      { id: 'fixture-inc-001-resolved', title: 'INC-001 · approved and verified', events },
    ];
  }

  sessionUiUrl(): null {
    return null;
  }

  listSessions(): Promise<SessionSummaryView[]> {
    return Promise.resolve(
      this.sessions.map((session) => {
        const first = session.events[0]?.event.createdAt ?? new Date(0).toISOString();
        const last = session.events.at(-1)?.event.createdAt ?? first;
        return {
          id: session.id,
          title: session.title,
          createdAt: first,
          updatedAt: last,
          turns: countTurns(session.events),
        };
      }),
    );
  }

  fetchSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return Promise.reject(new SessionNotFoundError(sessionId));

    let startedAt = this.replayStartedAt.get(sessionId);
    if (startedAt === undefined) {
      startedAt = this.now();
      this.replayStartedAt.set(sessionId, startedAt);
    }
    const visible =
      this.paceMs === 0
        ? session.events.length
        : Math.min(session.events.length, 1 + Math.floor((this.now() - startedAt) / this.paceMs));
    const events = session.events.slice(0, visible);
    const createdAt = events[0]?.event.createdAt ?? new Date(this.now()).toISOString();

    return Promise.resolve({
      session: {
        id: session.id,
        title: session.title,
        createdAt,
        updatedAt: events.at(-1)?.event.createdAt ?? createdAt,
        turns: countTurns(events),
        costUsd: null,
      },
      events,
    });
  }

  /** Restarts the replay the next time the session is watched. */
  release(sessionId: string): void {
    this.replayStartedAt.delete(sessionId);
  }
}

function countTurns(events: readonly SessionEventItem[]): number {
  return events.filter((item) => item.event.type === 'turn.created').length;
}
