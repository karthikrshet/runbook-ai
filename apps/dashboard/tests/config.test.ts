import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';
import { TrueForgeSource } from '../server/sources/trueforge.js';

describe('dashboard configuration', () => {
  it('opens TrueForge at its API address unless a public address is set', () => {
    expect(loadConfig([], { TRUEFORGE_BASE_URL: 'http://localhost:8790/' }).trueforge).toEqual({
      baseUrl: 'http://localhost:8790',
      publicUrl: 'http://localhost:8790',
      token: undefined,
    });

    const { trueforge } = loadConfig([], {
      TRUEFORGE_BASE_URL: 'http://trueforge.agents.svc.cluster.local:8790',
      TRUEFORGE_PUBLIC_URL: 'https://trueforge.example.com/',
    });
    expect(trueforge.baseUrl).toBe('http://trueforge.agents.svc.cluster.local:8790');
    expect(trueforge.publicUrl).toBe('https://trueforge.example.com');
    // Session links are opened by a browser, so they use the public address.
    expect(new TrueForgeSource(trueforge).sessionUiUrl('ses 1')).toBe(
      'https://trueforge.example.com/sessions/ses%201',
    );
  });

  it('treats blank variables as unset', () => {
    const config = loadConfig([], { TRUEFORGE_PUBLIC_URL: ' ', DASHBOARD_SOURCE: '' });
    expect(config.trueforge.publicUrl).toBe('http://localhost:8790');
    expect(config.source).toBe('trueforge');
  });

  it('reads the data source from DASHBOARD_SOURCE, with the --source flag taking precedence', () => {
    const fixture = loadConfig([], { DASHBOARD_SOURCE: 'fixture' });
    expect(fixture.source).toBe('fixture');
    expect(fixture.decisionsEnabled).toBe(false);
    expect(fixture.startRunsEnabled).toBe(false);
    expect(loadConfig(['--source=trueforge'], { DASHBOARD_SOURCE: 'fixture' }).source).toBe(
      'trueforge',
    );
    expect(() => loadConfig([], { DASHBOARD_SOURCE: 'live' })).toThrow(/DASHBOARD_SOURCE/);
  });

  it('accepts a deployment’s public host next to the loopback addresses', () => {
    const config = loadConfig([], {
      DASHBOARD_HOST: '0.0.0.0',
      DASHBOARD_PORT: '8791',
      DASHBOARD_ALLOWED_HOSTS: 'runbook.example.com, Runbook-Other.example.com:8443',
    });
    expect(config.host).toBe('0.0.0.0');
    expect([...config.allowedHosts]).toEqual(
      expect.arrayContaining([
        'runbook.example.com',
        'runbook-other.example.com:8443',
        '127.0.0.1:8791',
        'localhost:8791',
      ]),
    );
  });
});
