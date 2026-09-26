import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const TRUEFORGE_WRITE_ACKNOWLEDGEMENT = 'I_UNDERSTAND_TRUEFORGE_WRITES';

/** A blank variable, as a copied .env.example leaves it, counts as unset. */
const blankAsUnset = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(blankAsUnset, z.string().optional());
const httpUrl = z.url({ protocol: /^https?$/ });

const EnvSchema = z.object({
  TRUEFORGE_BASE_URL: httpUrl.default('http://localhost:8790'),
  TRUEFORGE_PUBLIC_URL: z.preprocess(blankAsUnset, httpUrl.optional()),
  TRUEFORGE_TOKEN: optionalString,
  RUNBOOKAI_MCP_SERVER_NAME: z.string().min(1).default('runbookai'),
  GITHUB_MCP_SERVER_NAME: z.string().min(1).default('github'),
  DASHBOARD_HOST: z.string().min(1).default('127.0.0.1'),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(8791),
  DASHBOARD_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1500),
  DASHBOARD_ALLOWED_HOSTS: optionalString,
  TRUEFORGE_AGENT_NAME: z.string().min(1).max(120).default('runbookai'),
  DASHBOARD_DECISIONS: z.enum(['on', 'off']).default('on'),
  DASHBOARD_START_RUNS: z.enum(['on', 'off']).default('on'),
  DASHBOARD_TRUEFORGE_WRITE_ACK: z.preprocess(
    blankAsUnset,
    z.literal(TRUEFORGE_WRITE_ACKNOWLEDGEMENT).optional(),
  ),
  DASHBOARD_SOURCE: z.preprocess(blankAsUnset, z.enum(['trueforge', 'fixture']).optional()),
  DASHBOARD_ENVIRONMENT: z.preprocess(blankAsUnset, z.string().trim().max(40).optional()),
  RUNBOOKAI_RUNBOOKS_DIR: optionalString,
});

export interface DashboardConfig {
  mode: 'dev' | 'production';
  source: 'trueforge' | 'fixture';
  /** Delay between fixture events during replay; 0 shows the whole fixture at once. */
  fixturePaceMs: number;
  trueforge: {
    /** Where this server calls TrueForge's API, e.g. an in-cluster service address. */
    baseUrl: string;
    /** Where a browser opens TrueForge's UI: TRUEFORGE_PUBLIC_URL, else baseUrl. */
    publicUrl: string;
    token: string | undefined;
  };
  connectors: { runbookai: string; github: string };
  host: string;
  port: number;
  pollMs: number;
  /** Host header values accepted by the server (guards against DNS rebinding). */
  allowedHosts: ReadonlySet<string>;
  /** TrueForge agent that new runs are started with. */
  agentName: string;
  /** Approve/reject may be forwarded to TrueForge. Always off for fixture replays. */
  decisionsEnabled: boolean;
  /** New runs may be started in TrueForge. Always off for fixture replays. */
  startRunsEnabled: boolean;
  runbooksDir: string;
  /** Label the header shows for the environment, e.g. "Controlled demo"; null when unset. */
  environment: string | null;
}

/** Loads the repository-root .env if present. Existing environment variables win. */
export function loadDotEnv(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): DashboardConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid dashboard configuration: ${issues}`);
  }
  const e = parsed.data;
  const flags = parseFlags(argv);

  const source = flags.get('source') ?? e.DASHBOARD_SOURCE ?? 'trueforge';
  if (source !== 'trueforge' && source !== 'fixture') {
    throw new Error(`--source must be "trueforge" or "fixture", got "${source}"`);
  }
  const fixturePaceMs = Number(flags.get('fixture-pace') ?? '700');
  if (!Number.isInteger(fixturePaceMs) || fixturePaceMs < 0 || fixturePaceMs > 60_000) {
    throw new Error('--fixture-pace must be an integer number of milliseconds (0-60000)');
  }

  const allowedHosts = new Set<string>();
  const hostNames = LOOPBACK_HOSTS.includes(e.DASHBOARD_HOST)
    ? LOOPBACK_HOSTS
    : [e.DASHBOARD_HOST, ...LOOPBACK_HOSTS];
  for (const name of hostNames) allowedHosts.add(hostHeader(name, e.DASHBOARD_PORT));
  for (const extra of (e.DASHBOARD_ALLOWED_HOSTS ?? '').split(',')) {
    if (extra.trim()) allowedHosts.add(extra.trim().toLowerCase());
  }

  const baseUrl = e.TRUEFORGE_BASE_URL.replace(/\/+$/, '');
  const writesAcknowledged =
    e.DASHBOARD_TRUEFORGE_WRITE_ACK === TRUEFORGE_WRITE_ACKNOWLEDGEMENT;
  return {
    mode: flags.has('dev') ? 'dev' : 'production',
    source,
    fixturePaceMs,
    trueforge: {
      baseUrl,
      publicUrl: e.TRUEFORGE_PUBLIC_URL?.replace(/\/+$/, '') ?? baseUrl,
      token: e.TRUEFORGE_TOKEN,
    },
    connectors: { runbookai: e.RUNBOOKAI_MCP_SERVER_NAME, github: e.GITHUB_MCP_SERVER_NAME },
    host: e.DASHBOARD_HOST,
    port: e.DASHBOARD_PORT,
    pollMs: e.DASHBOARD_POLL_MS,
    allowedHosts,
    agentName: e.TRUEFORGE_AGENT_NAME,
    decisionsEnabled: source === 'trueforge' && writesAcknowledged && e.DASHBOARD_DECISIONS === 'on',
    startRunsEnabled: source === 'trueforge' && writesAcknowledged && e.DASHBOARD_START_RUNS === 'on',
    runbooksDir:
      e.RUNBOOKAI_RUNBOOKS_DIR ?? fileURLToPath(new URL('../../../runbooks', import.meta.url)),
    environment: e.DASHBOARD_ENVIRONMENT ?? null,
  };
}

function hostHeader(name: string, port: number): string {
  return `${name.includes(':') ? `[${name}]` : name}:${port}`.toLowerCase();
}

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match?.[1]) flags.set(match[1], match[2] ?? 'true');
  }
  return flags;
}
