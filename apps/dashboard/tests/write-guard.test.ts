import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';

describe('TrueForge dashboard write guard', () => {
  it('keeps a live TrueForge dashboard view-only without an explicit acknowledgement', () => {
    const config = loadConfig([], {
      DASHBOARD_SOURCE: 'trueforge',
      DASHBOARD_DECISIONS: 'on',
      DASHBOARD_START_RUNS: 'on',
    });

    expect(config.source).toBe('trueforge');
    expect(config.decisionsEnabled).toBe(false);
    expect(config.startRunsEnabled).toBe(false);
  });

  it('enables only the explicitly acknowledged write capability', () => {
    const config = loadConfig([], {
      DASHBOARD_SOURCE: 'trueforge',
      DASHBOARD_DECISIONS: 'on',
      DASHBOARD_START_RUNS: 'off',
      DASHBOARD_TRUEFORGE_WRITE_ACK: 'I_UNDERSTAND_TRUEFORGE_WRITES',
    });

    expect(config.decisionsEnabled).toBe(true);
    expect(config.startRunsEnabled).toBe(false);
  });

  it('never enables writes for fixture replay, even when acknowledged', () => {
    const config = loadConfig([], {
      DASHBOARD_SOURCE: 'fixture',
      DASHBOARD_DECISIONS: 'on',
      DASHBOARD_START_RUNS: 'on',
      DASHBOARD_TRUEFORGE_WRITE_ACK: 'I_UNDERSTAND_TRUEFORGE_WRITES',
    });

    expect(config.decisionsEnabled).toBe(false);
    expect(config.startRunsEnabled).toBe(false);
  });

  it('rejects an acknowledgement value that is not exact', () => {
    expect(() =>
      loadConfig([], {
        DASHBOARD_TRUEFORGE_WRITE_ACK: 'true',
      }),
    ).toThrow('Invalid dashboard configuration');
  });
});
