import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  buildRunPrompt,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  INCIDENT_ID_PATTERN,
  RUNBOOK_ID_PATTERN,
} from '../shared/run-request.js';
import type {
  DashboardConfigView,
  DecisionResponse,
  StartRunResponse,
  StreamMessage,
} from '../shared/view.js';
import type { DashboardConfig } from './config.js';
import type { SessionHub } from './hub.js';
import { buildPreflight } from './preflight.js';
import { projectSession } from './projection/project.js';
import { listRunbooks } from './runbooks.js';
import type { SessionActions, SessionSource } from './sources/types.js';

/** Handles everything that is not /api: the built client, or Vite in development. */
export type Fallback = (
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export interface HandlerDeps {
  config: Pick<
    DashboardConfig,
    | 'mode'
    | 'allowedHosts'
    | 'trueforge'
    | 'connectors'
    | 'agentName'
    | 'decisionsEnabled'
    | 'startRunsEnabled'
    | 'runbooksDir'
    | 'environment'
  >;
  source: SessionSource;
  /** Writes forwarded to TrueForge; null when the source cannot write (fixtures). */
  actions: SessionActions | null;
  hub: SessionHub;
  fallback: Fallback;
  describeError: (error: unknown) => string;
  log: (message: string) => void;
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const STREAM_PATH = /^\/api\/sessions\/([^/]+)\/stream$/;
const DECISION_PATH = /^\/api\/sessions\/([^/]+)\/decisions$/;
const HEARTBEAT_MS = 15_000;
const MAX_BODY_BYTES = 16 * 1024;

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DecisionSchema = z
  .object({
    toolCallId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    decision: z.enum(['allow', 'deny']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const StartRunSchema = z
  .object({
    runbookId: z.string().regex(RUNBOOK_ID_PATTERN),
    incidentId: z.string().regex(INCIDENT_ID_PATTERN),
    description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  })
  .strict();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The dashboard never changes an external system itself. Everything is GET or
 * HEAD except two routes, and both only forward a human's request to TrueForge:
 *   POST /api/sessions/:id/decisions  approve or reject a pending tool call
 *   POST /api/runs                    start a run with the configured agent
 * Both are off for fixture replays and can be switched off by configuration.
 */
export function createRequestHandler(deps: HandlerDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(deps, req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        if (!res.headersSent) sendJson(res, error.status, { error: error.message });
        return;
      }
      deps.log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
  };
}

async function handle(deps: HandlerDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (deps.config.mode === 'production') res.setHeader('Content-Security-Policy', PRODUCTION_CSP);

  const url = new URL(req.url ?? '/', 'http://dashboard.invalid');
  // Health probes (a Kubernetes kubelet, a load balancer) address the pod by IP, so
  // this is answered for any Host header. It reveals nothing.
  if (url.pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, { ok: true });
    return;
  }

  // Reject unexpected Host headers so a hostile page cannot reach this API via DNS rebinding.
  const host = (req.headers.host ?? '').toLowerCase();
  if (!deps.config.allowedHosts.has(host)) {
    deps.log(
      `refused Host ${JSON.stringify(host.slice(0, 200))}; if it is this dashboard's address, add it to DASHBOARD_ALLOWED_HOSTS`,
    );
    sendJson(res, 421, {
      error:
        'Unexpected Host header. If this is the dashboard’s address, add it to DASHBOARD_ALLOWED_HOSTS.',
    });
    return;
  }

  if (req.method === 'POST') {
    await handleWrite(deps, url, req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    await deps.fallback(url, req, res);
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  switch (url.pathname) {
    case '/api/config': {
      const body: DashboardConfigView = {
        source: deps.source.info,
        trueforgeUiUrl:
          deps.source.info.kind === 'trueforge' ? deps.config.trueforge.publicUrl : null,
        decisionsEnabled: deps.config.decisionsEnabled && deps.actions !== null,
        startRunsEnabled: deps.config.startRunsEnabled && deps.actions !== null,
        agentName: deps.actions ? deps.config.agentName : null,
        environment: deps.config.environment,
      };
      sendJson(res, 200, body);
      return;
    }
    case '/api/sessions': {
      const signal = abortOnDisconnect(res);
      try {
        sendJson(res, 200, { sessions: await deps.source.listSessions(signal) });
      } catch (error) {
        sendJson(res, 502, { error: deps.describeError(error) });
      }
      return;
    }
    case '/api/runbooks':
      sendJson(res, 200, { runbooks: await listRunbooks(deps.config.runbooksDir) });
      return;
    case '/api/preflight': {
      if (!deps.actions || !deps.config.startRunsEnabled) {
        throw new HttpError(409, 'Starting runs is not available with this data source.');
      }
      try {
        const agent = await deps.actions.findAgent(deps.config.agentName, abortOnDisconnect(res));
        sendJson(res, 200, buildPreflight(deps.config.agentName, agent, deps.config.connectors));
      } catch (error) {
        sendJson(res, 502, { error: deps.describeError(error) });
      }
      return;
    }
  }

  const stream = STREAM_PATH.exec(url.pathname);
  if (stream?.[1] !== undefined) {
    openStream(deps, sessionIdFrom(stream[1]), res);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

async function handleWrite(
  deps: HandlerDeps,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const decision = DECISION_PATH.exec(url.pathname);
  const isRun = url.pathname === '/api/runs';
  if (!decision && !isRun) {
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!deps.actions || !(isRun ? deps.config.startRunsEnabled : deps.config.decisionsEnabled)) {
    throw new HttpError(
      403,
      isRun
        ? 'Starting runs from the dashboard is switched off. Start the run in TrueForge.'
        : 'Decisions from the dashboard are switched off. Approve or reject in TrueForge.',
    );
  }
  assertSameOriginJson(deps, req);
  const body = await readJson(req);

  if (decision?.[1] !== undefined) {
    const sessionId = sessionIdFrom(decision[1]);
    const parsed = DecisionSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpError(400, 'Send a toolCallId and a decision of allow or deny.');
    sendJson(res, 202, await forwardDecision(deps, deps.actions, sessionId, parsed.data));
    return;
  }

  const parsed = StartRunSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      `Pick a runbook, an incident id like INC-001, and a description of ${String(DESCRIPTION_MIN)}-${String(DESCRIPTION_MAX)} characters.`,
    );
  }
  sendJson(res, 201, await startRun(deps, deps.actions, parsed.data, abortOnDisconnect(res)));
}

/**
 * Forwards a human decision only if TrueForge's own event log says that tool
 * call is waiting for one right now. The dashboard never decides by itself.
 */
async function forwardDecision(
  deps: HandlerDeps,
  actions: SessionActions,
  sessionId: string,
  request: z.infer<typeof DecisionSchema>,
): Promise<DecisionResponse> {
  const snapshot = await deps.source.fetchSnapshot(sessionId, new AbortController().signal);
  const view = projectSession({
    source: deps.source.info,
    session: snapshot.session,
    sessionUiUrl: null,
    events: snapshot.events,
    connectors: deps.config.connectors,
    now: new Date(),
  });
  const call = view.toolCalls.find((candidate) => candidate.id === request.toolCallId);
  if (call?.status !== 'awaiting_approval') {
    throw new HttpError(409, 'That action is no longer waiting for a decision in TrueForge.');
  }
  // Policy authorizes, not the button: a forbidden action can be rejected, never approved.
  if (request.decision === 'allow' && call.decision === 'deny') {
    throw new HttpError(
      409,
      `Policy blocks ${call.ref.tool}: it is forbidden, so it cannot be approved. Reject it instead.`,
    );
  }
  const result = await actions.decide({
    sessionId,
    threadId: call.threadId,
    toolCallId: call.id,
    decision: request.decision,
    reason: request.decision === 'deny' ? request.reason || undefined : undefined,
  });
  deps.log(
    `decision ${request.decision} sent to TrueForge: session=${sessionId} call=${call.id} tool=${call.ref.tool}`,
  );
  deps.hub.refresh(sessionId);
  return result;
}

async function startRun(
  deps: HandlerDeps,
  actions: SessionActions,
  request: z.infer<typeof StartRunSchema>,
  signal: AbortSignal,
): Promise<StartRunResponse> {
  const runbooks = await listRunbooks(deps.config.runbooksDir);
  const runbook = runbooks.find((candidate) => candidate.id === request.runbookId);
  if (!runbook) throw new HttpError(400, `There is no runbook named ${request.runbookId}.`);

  // The same pre-flight the start screen shows, enforced here as well.
  const agent = await actions.findAgent(deps.config.agentName, signal);
  const preflight = buildPreflight(deps.config.agentName, agent, deps.config.connectors);
  if (!preflight.canStart) {
    const failed = preflight.checks.filter((check) => check.status === 'fail');
    throw new HttpError(409, failed.map((check) => check.detail).join(' '));
  }

  const result = await actions.startRun({
    agentName: deps.config.agentName,
    title: `${request.incidentId} · ${runbook.title}`,
    prompt: buildRunPrompt(request),
    metadata: { runbookai_incident: request.incidentId, runbookai_runbook: request.runbookId },
  });
  deps.log(`run started in TrueForge: session=${result.sessionId} incident=${request.incidentId}`);
  return result;
}

/** Cross-site request forgery guard for the two write routes. */
function assertSameOriginJson(deps: HandlerDeps, req: IncomingMessage): void {
  const type = (req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') {
    throw new HttpError(403, 'Cross-site requests are refused.');
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new HttpError(403, 'Cross-site requests are refused.');
    }
    if (!deps.config.allowedHosts.has(originHost)) {
      throw new HttpError(403, 'Cross-site requests are refused.');
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

function sessionIdFrom(raw: string): string {
  const sessionId = safeDecode(raw);
  if (sessionId === null || !SESSION_ID.test(sessionId)) {
    throw new HttpError(400, 'Invalid session id');
  }
  return sessionId;
}

function openStream(deps: HandlerDeps, sessionId: string, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    // Stops a buffering reverse proxy (e.g. nginx) from holding events back.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const send = (message: StreamMessage): void => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };
  const unsubscribe = deps.hub.subscribe(sessionId, send);
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);
  // The response never finishes on its own, so 'close' means the client left.
  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/**
 * Aborts when the client goes away before the response is finished. Watches the
 * response: since Node 16 a request's 'close' fires once its body has been read.
 */
function abortOnDisconnect(res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
