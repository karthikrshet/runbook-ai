import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrueForgeError, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { GetSessionResponse } from '@truefoundry/trueforge-sdk/serialization';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler } from '../server/http.js';
import { SessionHub } from '../server/hub.js';
import { FixtureSource } from '../server/sources/fixture.js';
import {
  describeTrueForgeError,
  describeTrueForgeWriteError,
  TrueForgeSource,
} from '../server/sources/trueforge.js';
import type { SessionActions, SessionSource } from '../server/sources/types.js';
import { createStaticHandler } from '../server/static.js';
import { buildRunPrompt } from '../shared/run-request.js';
import type { StreamMessage } from '../shared/view.js';
import { mcpTool, toolCall } from './helpers.js';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface Harness {
  port: number;
  decisions: Parameters<SessionActions['decide']>[0][];
  runs: Parameters<SessionActions['startRun']>[0][];
  close: () => Promise<void>;
}

let root = '';

const readyAgent: TrueForgeApi.Agent = {
  id: 'agent_1',
  name: 'runbookai',
  description: 'test agent',
  createdBySubject: { subjectDisplayName: 'Test', subjectId: 't', subjectType: 'user' },
  manifest: {
    model: { name: 'openai/gpt-5.2' },
    config: { sandbox: { enabled: true } },
    mcpServers: [{ name: 'runbookai', requireApprovalForTools: ['@all'] }],
  },
};

/** Starts the real request handler over the synthetic fixture, with fake TrueForge writes. */
async function startHarness(options: {
  writes: boolean;
  agent?: TrueForgeApi.Agent | null;
  source?: SessionSource;
  /** Thrown by every write, as TrueForge's SDK would throw it. */
  writeError?: Error;
  /** Real writes, e.g. a TrueForgeSource pointed at a local stand-in for TrueForge. */
  actions?: SessionActions;
}): Promise<Harness> {
  const source = options.source ?? new FixtureSource(0);
  const connectors = { runbookai: 'runbookai', github: 'github' };
  const hub = new SessionHub({
    source,
    connectors,
    pollMs: 50,
    describeError: (e) => (e instanceof Error ? e.message : 'error'),
  });
  const decisions: Harness['decisions'] = [];
  const runs: Harness['runs'] = [];
  const actions: SessionActions = options.actions ?? {
    decide: (input) => {
      if (options.writeError !== undefined) return Promise.reject(options.writeError);
      decisions.push(input);
      return Promise.resolve({ turnId: 'turn_after_decision' });
    },
    startRun: (input) => {
      if (options.writeError !== undefined) return Promise.reject(options.writeError);
      runs.push(input);
      return Promise.resolve({ sessionId: 'session_started' });
    },
    findAgent: () => Promise.resolve(options.agent === undefined ? readyAgent : options.agent),
  };

  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  server.on(
    'request',
    createRequestHandler({
      config: {
        mode: 'production',
        allowedHosts: new Set([`127.0.0.1:${String(port)}`, `localhost:${String(port)}`]),
        trueforge: {
          baseUrl: 'http://localhost:8790',
          publicUrl: 'http://localhost:8790',
          token: undefined,
        },
        connectors,
        agentName: 'runbookai',
        decisionsEnabled: options.writes,
        startRunsEnabled: options.writes,
        runbooksDir: join(root, 'runbooks'),
        environment: null,
      },
      source,
      actions: options.writes ? actions : null,
      hub,
      fallback: createStaticHandler(join(root, 'client')),
      describeError: (e, mode) => describeTrueForgeError(e, 'http://localhost:8790', mode),
      describeWriteError: (e) => describeTrueForgeWriteError(e, 'http://localhost:8790'),
      log: () => undefined,
    }),
  );
  return {
    port,
    decisions,
    runs,
    close: async () => {
      hub.stopAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

/** node:http rather than fetch, so tests can send any Host, Origin or method. */
function send(
  port: number,
  path: string,
  options: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        port,
        path,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? `127.0.0.1:${String(port)}`, ...options.headers },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

const postJson = (
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  send(port, path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${String(port)}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Reads the first server-sent message from a stream, then disconnects. */
function firstStreamMessage(
  port: number,
  path: string,
): Promise<{
  status: number;
  headers: Reply['headers'];
  type: string | undefined;
  message: StreamMessage;
}> {
  return new Promise((resolve, reject) => {
    const req = request({ port, path, headers: { host: `127.0.0.1:${String(port)}` } }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const match = /^data: (.+)$/m.exec(buffer);
        if (match?.[1]) {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            type: res.headers['content-type'],
            message: JSON.parse(match[1]) as StreamMessage,
          });
          req.destroy();
        }
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'runbookai-server-'));
  mkdirSync(join(root, 'client', 'assets'), { recursive: true });
  mkdirSync(join(root, 'runbooks'));
  writeFileSync(join(root, 'client', 'index.html'), '<!doctype html><title>RunbookAI</title>');
  writeFileSync(join(root, 'client', 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'outside the web root');
  writeFileSync(
    join(root, 'runbooks', 'checkout-incident.md'),
    '# Checkout API Incident Runbook\n\n1. Check service health.\n2. Verify recovery.\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('with writes switched off (fixture replay)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ writes: false });
  });
  afterAll(() => h.close());

  it('answers health checks with security headers', async () => {
    const reply = await send(h.port, '/api/health');
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true });
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['x-frame-options']).toBe('DENY');
    expect(reply.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('reports that it cannot decide or start runs, and never exposes the token', async () => {
    expect(JSON.parse((await send(h.port, '/api/config')).body)).toEqual({
      source: { kind: 'fixture', label: 'Synthetic fixture replay. Not a live TrueForge session.' },
      trueforgeUiUrl: null,
      decisionsEnabled: false,
      startRunsEnabled: false,
      agentName: null,
      environment: null,
    });
  });

  it('refuses decisions and new runs', async () => {
    const decision = await postJson(h.port, '/api/sessions/fixture-inc-001-awaiting/decisions', {
      toolCallId: 'fx_call_pr',
      decision: 'allow',
    });
    expect(decision.status).toBe(403);
    expect(decision.body).toContain('Approve or reject in TrueForge');
    const run = await postJson(h.port, '/api/runs', {
      runbookId: 'checkout-incident.md',
      incidentId: 'INC-9',
      description: 'something broke badly',
    });
    expect(run.status).toBe(403);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('refuses %s', async (method) => {
    const reply = await send(h.port, '/api/sessions', { method });
    expect(reply.status).toBe(405);
    expect(reply.headers['allow']).toBe('GET, HEAD');
  });

  it('refuses POST to read-only routes', async () => {
    expect(
      (await postJson(h.port, '/api/sessions/fixture-inc-001-awaiting/stream', {})).status,
    ).toBe(405);
  });

  it('rejects unexpected Host headers (DNS rebinding)', async () => {
    const reply = await send(h.port, '/api/sessions', { host: 'attacker.example' });
    expect(reply.status).toBe(421);
    expect(reply.body).toContain('DASHBOARD_ALLOWED_HOSTS');
    expect((await send(h.port, '/', { host: 'attacker.example' })).status).toBe(421);
  });

  it('answers health probes addressed to the pod IP, and nothing else', async () => {
    const probe = { host: '10.42.0.17:8791' };
    const reply = await send(h.port, '/api/health', probe);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true });
    expect(reply.headers['cache-control']).toBe('no-store');
    expect((await send(h.port, '/api/health', { ...probe, method: 'HEAD' })).status).toBe(200);
    expect((await send(h.port, '/api/config', probe)).status).toBe(421);
    expect((await send(h.port, '/api/health', { ...probe, method: 'POST' })).status).toBe(421);
  });

  it.each([
    '/api/sessions/..%2F..%2Fsecret/stream',
    '/api/sessions/has%20space/stream',
    `/api/sessions/${'x'.repeat(200)}/stream`,
  ])('rejects malformed session ids (%s)', async (path) => {
    expect((await send(h.port, path)).status).toBe(400);
  });

  it('lists sessions and runbooks', async () => {
    const sessions = JSON.parse((await send(h.port, '/api/sessions')).body) as {
      sessions: { id: string }[];
    };
    expect(sessions.sessions.map((s) => s.id)).toEqual([
      'fixture-inc-001-awaiting',
      'fixture-inc-001-resolved',
    ]);
    const runbooks = JSON.parse((await send(h.port, '/api/runbooks')).body) as {
      runbooks: unknown[];
    };
    expect(runbooks.runbooks).toEqual([
      {
        id: 'checkout-incident.md',
        title: 'Checkout API Incident Runbook',
        steps: ['Check service health.', 'Verify recovery.'],
      },
    ]);
  });

  it('streams the projected view over server-sent events', async () => {
    const { status, headers, type, message } = await firstStreamMessage(
      h.port,
      '/api/sessions/fixture-inc-001-awaiting/stream',
    );
    expect(status).toBe(200);
    expect(type).toContain('text/event-stream');
    expect(headers['x-accel-buffering']).toBe('no');
    expect(message.type === 'view' && message.view.phase).toBe('awaiting_authorization');
  });

  it('streams an error for an unknown session', async () => {
    const { message } = await firstStreamMessage(h.port, '/api/sessions/no-such-session/stream');
    expect(message).toEqual({ type: 'error', message: 'No session with id no-such-session' });
  });

  it('returns 404 for unknown API routes', async () => {
    expect((await send(h.port, '/api/approve')).status).toBe(404);
  });

  it('serves the built client and falls back to index.html for app routes', async () => {
    expect((await send(h.port, '/assets/app.js')).body).toBe('console.log(1)');
    expect((await send(h.port, '/some/app/route')).body).toContain('<title>RunbookAI</title>');
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    '/missing.js',
    '/%E0%A4%A',
  ])('never serves files outside the web root (%s)', async (path) => {
    const reply = await send(h.port, path);
    expect(reply.body).not.toContain('outside the web root');
    expect([400, 404]).toContain(reply.status);
  });
});

describe('decisions forwarded to TrueForge', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ writes: true });
  });
  afterAll(() => h.close());
  const path = '/api/sessions/fixture-inc-001-awaiting/decisions';

  it('forwards a decision for a call TrueForge is holding', async () => {
    const reply = await postJson(h.port, path, {
      toolCallId: 'fx_call_pr',
      decision: 'deny',
      reason: 'Wait for review',
    });
    expect(reply.status).toBe(202);
    expect(JSON.parse(reply.body)).toEqual({ turnId: 'turn_after_decision' });
    expect(h.decisions.at(-1)).toEqual({
      sessionId: 'fixture-inc-001-awaiting',
      threadId: 'main',
      toolCallId: 'fx_call_pr',
      decision: 'deny',
      reason: 'Wait for review',
    });
  });

  it('refuses calls that are not waiting for a decision', async () => {
    const count = h.decisions.length;
    const reply = await postJson(h.port, path, { toolCallId: 'fx_call_logs', decision: 'allow' });
    expect(reply.status).toBe(409);
    expect(h.decisions).toHaveLength(count);
  });

  it('answers 404 for a session TrueForge does not have, and says nothing was sent', async () => {
    const count = h.decisions.length;
    const reply = await postJson(h.port, '/api/sessions/no-such-session/decisions', {
      toolCallId: 'fx_call_pr',
      decision: 'allow',
    });
    expect(reply.status).toBe(404);
    expect(reply.body).toContain('No decision was sent.');
    expect(reply.body).not.toContain('retried');
    expect(h.decisions).toHaveLength(count);
  });

  it.each([
    ['a cross-origin page', { origin: 'http://attacker.example' }, 403],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }, 403],
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }, 415],
  ])('refuses %s', async (_name, headers, status) => {
    const count = h.decisions.length;
    const reply = await postJson(
      h.port,
      path,
      { toolCallId: 'fx_call_pr', decision: 'allow' },
      headers,
    );
    expect(reply.status).toBe(status);
    expect(h.decisions).toHaveLength(count);
  });

  it('validates the body', async () => {
    expect(
      (await postJson(h.port, path, { toolCallId: 'fx_call_pr', decision: 'maybe' })).status,
    ).toBe(400);
    expect((await postJson(h.port, path, '{not json')).status).toBe(400);
    expect(
      (await postJson(h.port, path, { toolCallId: 'x'.repeat(20_000), decision: 'allow' })).status,
    ).toBe(413);
  });
});

describe('a forbidden action held for approval', () => {
  // TrueForge pauses a call RunbookAI's policy forbids: a human may reject it, never approve it.
  const events: TrueForgeApi.SessionEventItem[] = [
    toolCall('2026-09-26T10:42:01.000Z', 'call_forbidden', mcpTool('github', 'delete_repository'), {
      repo: 'acme/app',
    }),
    {
      turnId: 'fx_turn_1',
      event: {
        type: 'tool.approval_required',
        id: 'evt_gate',
        createdAt: '2026-09-26T10:42:02.000Z',
        threadId: 'main',
        toolCalls: [{ id: 'call_forbidden', sourceEventId: 't_evt_1' }],
      },
    },
  ];
  const source: SessionSource = {
    info: { kind: 'trueforge', label: 'TrueForge at http://localhost:8790' },
    sessionUiUrl: () => null,
    listSessions: () => Promise.resolve([]),
    fetchSnapshot: (sessionId) =>
      Promise.resolve({
        session: {
          id: sessionId,
          title: 'Forbidden',
          createdAt: '2026-09-26T10:42:00.000Z',
          updatedAt: '2026-09-26T10:42:02.000Z',
          turns: 1,
          costUsd: null,
        },
        events,
      }),
    release: () => undefined,
  };
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ writes: true, source });
  });
  afterAll(() => h.close());
  const path = '/api/sessions/session_forbidden/decisions';

  it('refuses to forward an approval, whatever the button says', async () => {
    const reply = await postJson(h.port, path, { toolCallId: 'call_forbidden', decision: 'allow' });
    expect(reply.status).toBe(409);
    expect(reply.body).toContain('Policy blocks delete_repository');
    expect(h.decisions).toEqual([]);
  });

  it('still forwards a rejection', async () => {
    const reply = await postJson(h.port, path, { toolCallId: 'call_forbidden', decision: 'deny' });
    expect(reply.status).toBe(202);
    expect(h.decisions.at(-1)).toMatchObject({ toolCallId: 'call_forbidden', decision: 'deny' });
  });
});

describe('starting runs', () => {
  it('starts a run with the exact previewed prompt once pre-flight passes', async () => {
    const h = await startHarness({ writes: true });
    const request = {
      runbookId: 'checkout-incident.md',
      incidentId: 'INC-002',
      description: 'checkout-api fails for some carts',
    };
    const reply = await postJson(h.port, '/api/runs', request);
    expect(reply.status).toBe(201);
    expect(JSON.parse(reply.body)).toEqual({ sessionId: 'session_started' });
    expect(h.runs).toEqual([
      {
        agentName: 'runbookai',
        title: 'INC-002 · Checkout API Incident Runbook',
        prompt: buildRunPrompt(request),
        metadata: { runbookai_incident: 'INC-002', runbookai_runbook: 'checkout-incident.md' },
      },
    ]);
    const preflight = JSON.parse((await send(h.port, '/api/preflight')).body) as {
      canStart: boolean;
    };
    expect(preflight.canStart).toBe(true);
    await h.close();
  });

  it('refuses to start when TrueForge would not pause before a gated tool', async () => {
    const unsafe: TrueForgeApi.Agent = {
      ...readyAgent,
      manifest: {
        ...readyAgent.manifest,
        mcpServers: [{ name: 'runbookai', requireApprovalForTools: [] }],
      },
    };
    const h = await startHarness({ writes: true, agent: unsafe });
    const reply = await postJson(h.port, '/api/runs', {
      runbookId: 'checkout-incident.md',
      incidentId: 'INC-003',
      description: 'checkout-api fails for some carts',
    });
    expect(reply.status).toBe(409);
    expect(reply.body).toContain(
      'would run github_create_pull_request, aws_execute_demo_rollback without asking',
    );
    expect(h.runs).toEqual([]);
    await h.close();
  });

  it('refuses unknown runbooks and malformed incident ids', async () => {
    const h = await startHarness({ writes: true });
    expect(
      (
        await postJson(h.port, '/api/runs', {
          runbookId: 'missing.md',
          incidentId: 'INC-4',
          description: 'checkout-api fails for some carts',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postJson(h.port, '/api/runs', {
          runbookId: 'checkout-incident.md',
          incidentId: 'not an id',
          description: 'checkout-api fails for some carts',
        })
      ).status,
    ).toBe(400);
    expect(h.runs).toEqual([]);
    await h.close();
  });
});

describe('a write TrueForge fails', () => {
  const decide = (h: Harness) =>
    postJson(h.port, '/api/sessions/fixture-inc-001-awaiting/decisions', {
      toolCallId: 'fx_call_pr',
      decision: 'allow',
    });
  // How the SDK reports a request that never connected, and one it stopped waiting for
  // (on Node 22 its timeout is a plain TrueForgeError whose cause is 'timeout').
  const unreachable = new TrueForgeError({
    message: 'fetch failed',
    cause: new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    }),
  });
  const timedOut = new TrueForgeError({ message: '"timeout"', cause: 'timeout' });

  it('says nothing was sent when TrueForge cannot be reached', async () => {
    const h = await startHarness({ writes: true, writeError: unreachable });
    const reply = await decide(h);
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body)).toEqual({
      error:
        "Can't reach TrueForge at http://localhost:8790, so nothing was sent. Check that it is running, then try again.",
      outcome: 'not_sent',
    });
    await h.close();
  });

  it('never tells the user a decision that timed out was not recorded', async () => {
    const h = await startHarness({ writes: true, writeError: timedOut });
    const reply = await decide(h);
    expect(reply.status).toBe(502);
    const body = JSON.parse(reply.body) as { error: string; outcome: string };
    expect(body.outcome).toBe('unknown');
    expect(body.error).toContain('did not answer within 10 s. It may or may not have recorded');
    expect(body.error).not.toContain("Can't reach");
    await h.close();
  });

  it('keeps a failure inside the dashboard an internal error, not a TrueForge one', async () => {
    const h = await startHarness({ writes: true, writeError: new Error('a dashboard bug') });
    const reply = await decide(h);
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Internal error' });
    await h.close();
  });
});

describe('a run whose first turn TrueForge does not start', () => {
  // A local stand-in for TrueForge's API, not TrueForge: it creates a session, then answers
  // the first turn with `turnStatus`.
  let turnStatus = 400;
  const seen: string[] = [];
  const created: TrueForgeApi.Session = {
    id: 'sess_new',
    title: null,
    createdAt: '2026-09-26T10:42:00.000Z',
    updatedAt: '2026-09-26T10:42:00.000Z',
    metadata: {},
    source: null,
    agent: { type: 'reference', id: 'agent_1', name: 'runbookai' },
    createdBySubject: readyAgent.createdBySubject,
    metrics: { totalTurns: 0, totalDurationMs: 0 },
  };
  const standIn = createServer((req, res) => {
    seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.method === 'DELETE') res.writeHead(204).end();
    else if (req.url?.endsWith('/turns')) {
      res.writeHead(turnStatus).end(JSON.stringify({ error: { message: 'Turn refused' } }));
    } else res.end(JSON.stringify(GetSessionResponse.jsonOrThrow({ data: created })));
  });
  let h: Harness;
  beforeAll(async () => {
    await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${String((standIn.address() as AddressInfo).port)}`;
    const trueforge = new TrueForgeSource({ baseUrl, publicUrl: baseUrl, token: undefined });
    h = await startHarness({
      writes: true,
      actions: {
        decide: (input) => trueforge.decide(input),
        startRun: (input) => trueforge.startRun(input),
        findAgent: () => Promise.resolve(readyAgent),
      },
    });
  });
  afterAll(async () => {
    await h.close();
    standIn.closeAllConnections();
    await new Promise<void>((resolve) =>
      standIn.close(() => {
        resolve();
      }),
    );
  });
  const start = () =>
    postJson(h.port, '/api/runs', {
      runbookId: 'checkout-incident.md',
      incidentId: 'INC-005',
      description: 'checkout-api fails for some carts',
    });

  it('removes the empty session when TrueForge refuses the first turn', async () => {
    turnStatus = 400;
    seen.length = 0;
    const reply = await start();
    expect(reply.status).toBe(502);
    const body = JSON.parse(reply.body) as Record<string, unknown>;
    expect(body).toMatchObject({ outcome: 'refused' });
    expect(body).not.toHaveProperty('sessionId');
    expect(body['error']).toContain(
      'so the run did not start. The empty session TrueForge created for it was removed.',
    );
    expect(seen).toContain('DELETE /api/v1/sessions/sess_new');
  });

  it('keeps the session and returns its id when the first turn may have started', async () => {
    turnStatus = 503;
    seen.length = 0;
    const reply = await start();
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body)).toMatchObject({ outcome: 'unknown', sessionId: 'sess_new' });
    expect(reply.body).toContain('open the session before starting another run');
    expect(seen.filter((line) => line.startsWith('DELETE'))).toEqual([]);
  });
});
