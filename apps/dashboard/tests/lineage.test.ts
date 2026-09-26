import { TrueForgeError } from '@truefoundry/trueforge-sdk';
import { describe, expect, it } from 'vitest';
import {
  describeTrueForgeError,
  describeTrueForgeWriteError,
  mergeLineage,
} from '../server/sources/trueforge.js';
import { RunNotStartedError, type SessionEventItem } from '../server/sources/types.js';

const item = (id: string): SessionEventItem => ({
  turnId: 't',
  event: {
    type: 'sandbox.created',
    id,
    createdAt: '2026-09-26T10:42:00.000Z',
    sandboxId: 's',
    threadId: null,
  },
});
const ids = (items: SessionEventItem[]): string[] => items.map((i) => i.event.id);

// How the SDK reports failures: on Node 22 its timeout is a plain TrueForgeError whose cause
// is the abort reason, and a socket error sits under fetch's TypeError.
const timedOut = new TrueForgeError({ message: '"timeout"', cause: 'timeout' });
const socketError = (code: string) =>
  new TrueForgeError({
    message: 'fetch failed',
    cause: new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) }),
  });

describe('mergeLineage', () => {
  it('uses a full read as-is on first load', () => {
    expect(ids(mergeLineage([], [item('c'), item('b'), item('a')], null))).toEqual(['a', 'b', 'c']);
  });

  it('appends only the new events after a known one', () => {
    const cached = [item('a'), item('b')];
    expect(ids(mergeLineage(cached, [item('d'), item('c')], 'b'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops cached events from a branch the session no longer follows', () => {
    const cached = [item('a'), item('b'), item('old-branch')];
    expect(ids(mergeLineage(cached, [item('new-branch')], 'b'))).toEqual(['a', 'b', 'new-branch']);
  });
});

describe('describeTrueForgeError', () => {
  it('says how to start TrueForge, or to use the demo replay, when it is unreachable', () => {
    const message = describeTrueForgeError(new TypeError('fetch failed'), 'http://localhost:8790');
    expect(message).toContain("Can't reach TrueForge at http://localhost:8790");
    expect(message).toContain('npx @truefoundry/trueforge');
    expect(message).toContain('DASHBOARD_SOURCE=fixture');
  });

  it('promises a retry only for the session stream, which does retry', () => {
    const failed = new TrueForgeError({ statusCode: 503 });
    expect(describeTrueForgeError(failed, 'http://tf')).toContain('This view keeps retrying.');
    expect(describeTrueForgeError(failed, 'http://tf', 'request')).toBe(
      'TrueForge returned HTTP 503.',
    );
    expect(
      describeTrueForgeError(new TypeError('fetch failed'), 'http://tf', 'request'),
    ).not.toContain('reconnects');
  });

  it("recognises the SDK's timeout as it arrives on Node 22", () => {
    expect(describeTrueForgeError(timedOut, 'http://tf')).toBe(
      'TrueForge at http://tf did not answer within 10 s. This view keeps retrying.',
    );
  });
});

describe('describeTrueForgeWriteError', () => {
  it('says a refused write recorded nothing, and passes on what TrueForge said', () => {
    const refused = new TrueForgeError({
      statusCode: 404,
      body: { error: { message: 'Agent runbookai not found.' } },
    });
    expect(describeTrueForgeWriteError(refused, 'http://tf')).toEqual({
      outcome: 'refused',
      message: 'TrueForge refused the request (HTTP 404: Agent runbookai not found), so nothing was recorded.',
    });
  });

  it('says nothing was sent only when the request never reached TrueForge', () => {
    expect(describeTrueForgeWriteError(socketError('ECONNREFUSED'), 'http://tf')).toEqual({
      outcome: 'not_sent',
      message: "Can't reach TrueForge at http://tf, so nothing was sent. Check that it is running, then try again.",
    });
    const reset = describeTrueForgeWriteError(socketError('UND_ERR_SOCKET'), 'http://tf');
    expect(reset?.outcome).toBe('unknown');
    expect(reset?.message).toContain('broke before it answered. It may or may not have recorded');
  });

  it('never claims a timed-out or failed write was not recorded, nor promises a retry', () => {
    for (const error of [timedOut, new TrueForgeError({ statusCode: 500 })]) {
      const failure = describeTrueForgeWriteError(error, 'http://tf');
      expect(failure?.outcome).toBe('unknown');
      expect(failure?.message).toContain('It may or may not have recorded the request');
      expect(failure?.message).not.toMatch(/Can't reach|npx|keeps retrying|reconnects/);
    }
  });

  it('leaves errors that did not come from TrueForge to the dashboard', () => {
    expect(describeTrueForgeWriteError(new Error('a dashboard bug'), 'http://tf')).toBeNull();
  });

  it('keeps the id of a session whose first turn may be running, but not of a removed one', () => {
    const removed = describeTrueForgeWriteError(
      new RunNotStartedError('sess_1', true, new TrueForgeError({ statusCode: 400 })),
      'http://tf',
    );
    expect(removed).toEqual({
      outcome: 'refused',
      message:
        'TrueForge refused the request (HTTP 400), so the run did not start. The empty session TrueForge created for it was removed.',
    });
    const running = describeTrueForgeWriteError(
      new RunNotStartedError('sess_1', false, timedOut),
      'http://tf',
    );
    expect(running).toMatchObject({ outcome: 'unknown', sessionId: 'sess_1' });
    expect(running?.message).toContain('open the session before starting another run');
  });
});
