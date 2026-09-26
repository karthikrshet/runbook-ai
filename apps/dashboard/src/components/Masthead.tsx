import type { DashboardConfigView, RunView } from '../../shared/view';
import type { Connection } from '../lib/api';
import { useConfig } from '../lib/config';

interface MastheadProps {
  view: RunView | null;
  /** Null on pages that do not stream a session. */
  connection: Connection | null;
  placeholder: string;
}

const CONNECTION_TEXT: Record<Connection, string> = {
  connecting: 'Connecting',
  live: 'Live',
  retrying: 'Reconnecting',
};

interface Environment {
  label: string;
  kind: 'demo' | 'live' | 'custom';
  detail: string;
}

/** Demo data is always called out; otherwise the operator's label, else "Live". */
function environmentFor(
  config: DashboardConfigView | null,
  view: RunView | null,
): Environment | null {
  const kind = view?.source.kind ?? config?.source.kind;
  if (!kind) return null;
  if (kind === 'fixture') {
    return {
      label: 'Demo data',
      kind: 'demo',
      detail: 'Synthetic fixture replay. Nothing here happened in TrueForge.',
    };
  }
  if (config?.environment) {
    return { label: config.environment, kind: 'custom', detail: 'Set by DASHBOARD_ENVIRONMENT.' };
  }
  return { label: 'Live', kind: 'live', detail: 'Reading a live TrueForge server.' };
}

export function Masthead({ view, connection, placeholder }: MastheadProps) {
  const config = useConfig();
  const replay = view?.source.kind === 'fixture';
  const state = replay ? 'replay' : connection;
  const environment = environmentFor(config, view);

  return (
    <header className="masthead">
      <div className="masthead__brand">
        {/* "./" rather than "/": the app's root, even when served under a path prefix. */}
        <a className="wordmark" href="./" aria-label="RunbookAI, all sessions">
          <span className="wordmark__lamp" aria-hidden="true" />
          RunbookAI
        </a>
        <span className="masthead__tagline">Evidence-Gated Autonomous Operations</span>
      </div>

      <div className="masthead__incident">
        {view?.incident.id && <span className="incident-id">{view.incident.id}</span>}
        {view?.incident.service && (
          <span className="masthead__service">{view.incident.service}</span>
        )}
        {view?.incident.severity && <span className="chip">{view.incident.severity}</span>}
        {/* With a session loaded, the page itself leads with the incident title. */}
        {!view && <span className="masthead__title">{placeholder}</span>}
      </div>

      <div className="masthead__meta">
        {environment && (
          <span className={`env env--${environment.kind}`} title={environment.detail}>
            {environment.label}
          </span>
        )}
        <nav className="masthead__nav" aria-label="Pages">
          <a href="./">Sessions</a>
          {config?.startRunsEnabled && <a href="?view=new">Start a run</a>}
        </nav>
        {state !== null && (
          <span className={`connection connection--${state}`}>
            <span className="connection__dot" aria-hidden="true" />
            {state === 'replay' ? 'Replay' : CONNECTION_TEXT[state]}
          </span>
        )}
      </div>
    </header>
  );
}
