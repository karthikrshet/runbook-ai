import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadDotEnv } from './config.js';
import { createRequestHandler, type Fallback } from './http.js';
import { SessionHub } from './hub.js';
import { createStaticHandler } from './static.js';
import { FixtureSource } from './sources/fixture.js';
import { describeTrueForgeError, TrueForgeSource } from './sources/trueforge.js';
import { SessionNotFoundError, type SessionActions, type SessionSource } from './sources/types.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const log = (message: string): void => {
  console.log(`${new Date().toISOString()} dashboard ${message}`);
};

loadDotEnv();
const config = loadConfig(process.argv.slice(2), process.env);

const trueforge = config.source === 'trueforge' ? new TrueForgeSource(config.trueforge) : null;
const source: SessionSource = trueforge ?? new FixtureSource(config.fixturePaceMs);
// Writes exist only against a live TrueForge, and each one can be switched off.
const actions: SessionActions | null =
  trueforge && (config.decisionsEnabled || config.startRunsEnabled) ? trueforge : null;

const describeError = (error: unknown): string => {
  if (config.source === 'trueforge') return describeTrueForgeError(error, config.trueforge.baseUrl);
  return error instanceof SessionNotFoundError ? error.message : 'The fixture could not be loaded.';
};

const hub = new SessionHub({
  source,
  connectors: config.connectors,
  pollMs: config.source === 'fixture' ? 250 : config.pollMs,
  describeError,
});

const server = createServer();
let fallback: Fallback;
if (config.mode === 'dev') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.ts'),
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });
  fallback = (_url, req, res) => {
    vite.middlewares(req, res, () => {
      res.writeHead(404).end('Not found');
    });
  };
} else {
  const clientRoot = join(appRoot, 'dist', 'client');
  if (!existsSync(join(clientRoot, 'index.html'))) {
    console.error('The dashboard has not been built. Run "npm run build" first, or "npm run dev".');
    process.exit(1);
  }
  fallback = createStaticHandler(clientRoot);
}

server.on(
  'request',
  createRequestHandler({ config, source, actions, hub, fallback, describeError, log }),
);
server.listen(config.port, config.host, () => {
  const { baseUrl, publicUrl } = config.trueforge;
  const where =
    config.source === 'fixture'
      ? 'synthetic fixture (not live)'
      : `${baseUrl}${publicUrl === baseUrl ? '' : ` ui=${publicUrl}`}`;
  log(
    `listening on http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`,
  );
  log(`mode=${config.mode} source=${where} token=${config.trueforge.token ? 'set' : 'not set'}`);
  log(
    `decisions=${config.decisionsEnabled ? 'on' : 'off'} start-runs=${config.startRunsEnabled ? 'on' : 'off'} agent="${config.agentName}"`,
  );
  log(
    `trusted RunbookAI connector="${config.connectors.runbookai}" github connector="${config.connectors.github}"`,
  );
});

const shutdown = (): void => {
  hub.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
