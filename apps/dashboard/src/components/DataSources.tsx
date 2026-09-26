import type { RunView } from '../../shared/view';
import { integrationIndicators, type StreamState } from '../lib/console';
import { useConfig } from '../lib/config';
import { plural } from '../lib/format';

type Kind = 'real' | 'local' | 'demo' | 'none';

interface Row {
  area: string;
  source: string;
  kind: Kind;
  status: string;
}

const KIND_TEXT: Record<Kind, string> = {
  real: 'TrueForge record',
  local: 'Local RunbookAI code',
  demo: 'Demo data',
  none: 'Not available',
};

/**
 * Where every part of the console comes from. Policy and blast radius are always
 * computed by RunbookAI's own code; everything else is read from TrueForge, or from
 * the synthetic fixture in demo mode.
 */
export function DataSources({ view, stream }: { view: RunView; stream: StreamState }) {
  const config = useConfig();
  const demo = view.source.kind === 'fixture';
  const recorded: Kind = demo ? 'demo' : 'real';
  const indicators = new Map(integrationIndicators(view, stream).map((i) => [i.key, i]));

  const rows: Row[] = [
    {
      area: 'Incident',
      source: view.incident.fromRunbookAi
        ? 'RunbookAI connector (incident_get), recorded by TrueForge'
        : 'Session title and first prompt; no incident was reported',
      kind: recorded,
      status: view.incident.id ?? 'Unnamed',
    },
    {
      area: 'Runbook',
      source:
        view.track.mode === 'runbook'
          ? `${view.track.subtitle ?? 'Runbook'} compiled by the RunbookAI connector (runbook_plan)`
          : 'No compiled runbook; stages are grouped from observed calls',
      kind: view.track.mode === 'runbook' ? recorded : 'none',
      status: plural(view.track.items.length, 'step'),
    },
    {
      area: 'Tool calls and timeline',
      source: `TrueForge event log: ${plural(view.counts.events, 'event')}`,
      kind: recorded,
      status: plural(view.counts.toolCalls, 'call'),
    },
    {
      area: 'Action policy',
      source: 'Permission matrix in @runbook-ai/core; deterministic, no model involved',
      kind: 'local',
      status: 'Always on',
    },
    {
      area: 'Blast radius',
      source:
        view.gatedAction?.blastRadiusSource === 'runbookai'
          ? 'Reported in the RunbookAI evidence package'
          : 'Computed by @runbook-ai/core from the permission matrix',
      kind: view.gatedAction
        ? view.gatedAction.blastRadiusSource === 'runbookai'
          ? recorded
          : 'local'
        : 'none',
      status: view.gatedAction ? view.gatedAction.blastRadius.riskClass : 'No action proposed',
    },
    {
      area: 'Evidence',
      source:
        'RunbookAI connector (evidence_build_package); every claim re-checked against TrueForge',
      kind: view.evidence ? recorded : 'none',
      status: view.evidence ? plural(view.evidence.items.length, 'item') : 'Not reported yet',
    },
    {
      area: 'Evidence gate readiness',
      source: 'Evidence the runbook requires (evidenceRequired), checked by dashboard code',
      kind: view.gate.required.length > 0 ? 'local' : 'none',
      status:
        view.gate.required.length > 0
          ? view.gate.ready
            ? 'Ready'
            : 'Not ready'
          : 'No requirements',
    },
    {
      area: 'Approvals',
      source: demo
        ? 'Disabled: a fixture has no TrueForge session to decide in'
        : config?.decisionsEnabled
          ? 'Forwarded to TrueForge’s native tool approval (user.tool_approval)'
          : 'Made in TrueForge; decisions from this dashboard are switched off',
      kind: demo ? 'demo' : 'real',
      status: demo ? 'UI preview' : config?.decisionsEnabled ? 'Connected' : 'In TrueForge',
    },
    ...(['trueforge', 'sandbox', 'github', 'aws'] as const).map((key): Row => {
      const indicator = indicators.get(key);
      return {
        area: indicator?.name ?? key,
        source: indicator?.basis ?? '',
        kind: demo ? 'demo' : indicator?.tone === 'neutral' ? 'none' : 'real',
        status: indicator?.state ?? 'Unknown',
      };
    }),
  ];

  return (
    <section id="data-sources" className="data-sources" aria-labelledby="data-sources-title">
      <div className="data-sources__head">
        <h2 id="data-sources-title" className="label">
          Data sources
        </h2>
        <p className="hint">
          {demo
            ? 'Demo mode: the run is a synthetic fixture. Policy code is real and runs on it.'
            : `Live: read from ${view.source.label}.`}
        </p>
      </div>
      <table className="data-sources__table">
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">Where it comes from</th>
            <th scope="col">Kind</th>
            <th scope="col">Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.area}>
              <th scope="row">{row.area}</th>
              <td>{row.source}</td>
              <td>
                <span className={`source-kind source-kind--${row.kind}`}>
                  {KIND_TEXT[row.kind]}
                </span>
              </td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
