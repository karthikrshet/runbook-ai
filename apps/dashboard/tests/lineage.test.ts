import { describe, expect, it } from 'vitest';
import { describeTrueForgeError, mergeLineage } from '../server/sources/trueforge.js';
import type { SessionEventItem } from '../server/sources/types.js';

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
});
