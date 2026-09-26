import type { ConnectorNames } from '@runbook-ai/core';
import type { StreamMessage } from '../shared/view.js';
import { projectSession } from './projection/project.js';
import type { SessionSource } from './sources/types.js';

type Listener = (message: StreamMessage) => void;

interface Watcher {
  listeners: Set<Listener>;
  controller: AbortController;
  timer: NodeJS.Timeout | null;
  signature: string | null;
  last: StreamMessage | null;
  failures: number;
  stopped: boolean;
  polling: boolean;
  /** A refresh was asked for while a poll was in flight; poll again right after it. */
  refreshQueued: boolean;
}

export interface HubOptions {
  source: SessionSource;
  connectors: ConnectorNames;
  pollMs: number;
  describeError: (error: unknown) => string;
  now?: () => Date;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * Polls each watched session once, however many browsers are watching it, and
 * pushes a fresh view to all of them when the session changes.
 */
export class SessionHub {
  private readonly watchers = new Map<string, Watcher>();

  constructor(private readonly options: HubOptions) {}

  subscribe(sessionId: string, listener: Listener): () => void {
    let watcher = this.watchers.get(sessionId);
    if (!watcher) {
      watcher = {
        listeners: new Set(),
        controller: new AbortController(),
        timer: null,
        signature: null,
        last: null,
        failures: 0,
        stopped: false,
        polling: false,
        refreshQueued: false,
      };
      this.watchers.set(sessionId, watcher);
      void this.poll(sessionId, watcher);
    } else if (watcher.last) {
      listener(watcher.last);
    }
    watcher.listeners.add(listener);

    const current = watcher;
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) this.stop(sessionId, current);
    };
  }

  stopAll(): void {
    for (const [sessionId, watcher] of this.watchers) this.stop(sessionId, watcher);
  }

  /** Polls a watched session now, e.g. right after a decision was sent to TrueForge. */
  refresh(sessionId: string): void {
    const watcher = this.watchers.get(sessionId);
    if (!watcher || watcher.stopped) return;
    if (watcher.polling) {
      watcher.refreshQueued = true;
      return;
    }
    if (watcher.timer) clearTimeout(watcher.timer);
    void this.poll(sessionId, watcher);
  }

  /** Read through a call: `stop()` can flip the flag while a poll is awaiting. */
  private isStopped(watcher: Watcher): boolean {
    return watcher.stopped;
  }

  private async poll(sessionId: string, watcher: Watcher): Promise<void> {
    watcher.polling = true;
    watcher.timer = null;
    try {
      const snapshot = await this.options.source.fetchSnapshot(
        sessionId,
        watcher.controller.signal,
      );
      if (this.isStopped(watcher)) return;
      watcher.failures = 0;
      const lastId = snapshot.events.at(-1)?.event.id ?? '';
      const signature = `${snapshot.events.length}|${lastId}|${snapshot.session.updatedAt}|${snapshot.session.title ?? ''}`;
      if (signature !== watcher.signature) {
        watcher.signature = signature;
        const view = projectSession({
          source: this.options.source.info,
          session: snapshot.session,
          sessionUiUrl: this.options.source.sessionUiUrl(sessionId),
          events: snapshot.events,
          connectors: this.options.connectors,
          now: this.options.now?.() ?? new Date(),
        });
        this.broadcast(watcher, { type: 'view', view });
      }
    } catch (error) {
      if (this.isStopped(watcher)) return;
      watcher.failures += 1;
      // Forget the signature so the next successful poll re-sends the view.
      watcher.signature = null;
      this.broadcast(watcher, { type: 'error', message: this.options.describeError(error) });
    } finally {
      watcher.polling = false;
    }
    if (this.isStopped(watcher)) return;
    const delay = watcher.refreshQueued
      ? 0
      : Math.min(this.options.pollMs * 2 ** Math.min(watcher.failures, 4), MAX_BACKOFF_MS);
    watcher.refreshQueued = false;
    watcher.timer = setTimeout(() => void this.poll(sessionId, watcher), delay);
  }

  private broadcast(watcher: Watcher, message: StreamMessage): void {
    watcher.last = message;
    for (const listener of watcher.listeners) listener(message);
  }

  private stop(sessionId: string, watcher: Watcher): void {
    watcher.stopped = true;
    if (watcher.timer) clearTimeout(watcher.timer);
    watcher.controller.abort();
    this.watchers.delete(sessionId);
    this.options.source.release(sessionId);
  }
}
