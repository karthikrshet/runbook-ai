import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInc001Events } from '../fixtures/inc-001.js';
import { SessionHub } from '../server/hub.js';
import type { SessionSnapshot, SessionSource } from '../server/sources/types.js';
import type { StreamMessage } from '../shared/view.js';

function fakeSource(fetchSnapshot: () => Promise<SessionSnapshot>) {
  const release = vi.fn<(id: string) => void>();
  const source: SessionSource = {
    info: { kind: 'fixture', label: 'fake' },
    sessionUiUrl: () => null,
    listSessions: () => Promise.resolve([]),
    fetchSnapshot,
    release,
  };
  return { source, release };
}

const events = buildInc001Events();
const snapshot = (count: number): SessionSnapshot => ({
  session: {
    id: 's',
    title: 't',
    createdAt: '2026-09-26T10:42:00.000Z',
    updatedAt: String(count),
    turns: 1,
    costUsd: null,
  },
  events: events.slice(0, count),
});

describe('SessionHub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls once for many watchers and only pushes when the session changes', async () => {
    let count = 5;
    const fetchSnapshot = vi.fn(() => Promise.resolve(snapshot(count)));
    const { source, release } = fakeSource(fetchSnapshot);
    const hub = new SessionHub({
      source,
      connectors: { runbookai: 'runbookai', github: 'github' },
      pollMs: 100,
      describeError: String,
    });

    const first: StreamMessage[] = [];
    const second: StreamMessage[] = [];
    const stopFirst = hub.subscribe('s', (m) => first.push(m));
    await vi.advanceTimersByTimeAsync(0);
    const stopSecond = hub.subscribe('s', (m) => second.push(m));
    expect(second).toHaveLength(1); // the cached view, without another fetch

    await vi.advanceTimersByTimeAsync(300); // unchanged polls push nothing
    expect(first).toHaveLength(1);

    count = 9;
    await vi.advanceTimersByTimeAsync(100);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);

    stopFirst();
    stopSecond();
    const calls = fetchSnapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSnapshot.mock.calls.length).toBe(calls); // stopped polling
    expect(release).toHaveBeenCalledWith('s');
  });

  it('reports failures, backs off, and re-sends the view once the source recovers', async () => {
    let failing = true;
    const fetchSnapshot = vi.fn(() =>
      failing ? Promise.reject(new Error('down')) : Promise.resolve(snapshot(5)),
    );
    const { source } = fakeSource(fetchSnapshot);
    const hub = new SessionHub({
      source,
      connectors: { runbookai: 'runbookai', github: 'github' },
      pollMs: 100,
      describeError: (error) => `TrueForge is ${(error as Error).message}`,
    });

    const messages: StreamMessage[] = [];
    const stop = hub.subscribe('s', (m) => messages.push(m));
    await vi.advanceTimersByTimeAsync(0);
    expect(messages).toEqual([{ type: 'error', message: 'TrueForge is down' }]);

    await vi.advanceTimersByTimeAsync(150); // backoff doubled to 200 ms: no retry yet
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    failing = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(messages.at(-1)?.type).toBe('view');
    stop();
  });
});
