import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { SessionSummaryView, SourceInfo } from '../../shared/view.js';

export type SessionEventItem = TrueForgeApi.SessionEventItem;
export type SessionEvent = TrueForgeApi.SessionEvent;

export interface SessionMeta {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  turns: number;
  costUsd: number | null;
}

export interface SessionSnapshot {
  session: SessionMeta;
  /** The session's current branch, oldest event first. */
  events: SessionEventItem[];
}

/**
 * The only writes the dashboard can make, each forwarded to TrueForge's API.
 * Only the live TrueForge source implements them; a fixture never can.
 */
export interface SessionActions {
  /** Records a human decision on a pending tool approval, exactly as TrueForge's own UI does. */
  decide(input: {
    sessionId: string;
    threadId: string;
    toolCallId: string;
    decision: 'allow' | 'deny';
    reason: string | undefined;
  }): Promise<{ turnId: string }>;
  /** Creates a session bound to a named TrueForge agent and starts its first turn. */
  startRun(input: {
    agentName: string;
    title: string;
    prompt: string;
    metadata: Record<string, string>;
  }): Promise<{ sessionId: string }>;
  /** Reads a named agent's configuration for pre-flight checks. */
  findAgent(name: string, signal: AbortSignal): Promise<TrueForgeApi.Agent | null>;
}

/** Where session data comes from. */
export interface SessionSource {
  readonly info: SourceInfo;
  /** Deep link to a session in the TrueForge UI, or null when there is no real session. */
  sessionUiUrl(sessionId: string): string | null;
  listSessions(signal: AbortSignal): Promise<SessionSummaryView[]>;
  fetchSnapshot(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot>;
  /** Called when nobody is watching a session any more, so caches can be released. */
  release(sessionId: string): void;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`No session with id ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}
