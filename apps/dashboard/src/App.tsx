import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DashboardConfigView, Phase } from '../shared/view';
import { ApprovalBoundary } from './components/ApprovalBoundary';
import { BoundaryAlerts, SourceBanner, StreamProblem } from './components/Banners';
import { BlastRadiusCard } from './components/BlastRadius';
import { CurrentOperation } from './components/CurrentOperation';
import { DataSources } from './components/DataSources';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EventLog } from './components/EventLog';
import { EvidenceGate } from './components/EvidenceGate';
import { IncidentReport } from './components/IncidentReport';
import { IncidentSummary } from './components/IncidentSummary';
import { Masthead } from './components/Masthead';
import { Remediation } from './components/Remediation';
import { RootCause } from './components/RootCause';
import { RunbookTrack } from './components/RunbookTrack';
import { RuntimeIdentity } from './components/RuntimeIdentity';
import { SandboxRuns } from './components/SandboxRuns';
import { SandboxValidation } from './components/SandboxValidation';
import { SessionPicker } from './components/SessionPicker';
import { StartRun } from './components/StartRun';
import { StatusHeadline } from './components/StatusHeadline';
import { StatusStrip } from './components/StatusStrip';
import { StepDetail } from './components/StepDetail';
import { UntrustedContent } from './components/UntrustedContent';
import { fetchConfig, useRunStream } from './lib/api';
import { ConfigContext } from './lib/config';
import { HighlightContext, type Highlight } from './lib/highlight';

/** Loading placeholders in the console's own shape, instead of a spinner. */
function ConsoleSkeleton({ problem }: { problem: string | null }) {
  return (
    <div className="console console--loading" aria-busy="true">
      <div className="console__track">
        <div className="skeleton skeleton--list" />
      </div>
      <main className="console__main" id="main">
        <p className="hint">
          {problem ? 'Waiting for the session…' : 'Connecting to the session…'}
        </p>
        <div className="skeleton skeleton--block" />
        <div className="skeleton skeleton--block skeleton--tall" />
      </main>
      <aside className="console__aside" aria-hidden="true">
        <div className="skeleton skeleton--block skeleton--tall" />
      </aside>
    </div>
  );
}

function RunScreen({ sessionId }: { sessionId: string }) {
  const { view, problem, connection } = useRunStream(sessionId);
  const [traced, setTraced] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const lastPhase = useRef<Phase | null>(null);
  const highlight = useMemo<Highlight>(
    () => ({
      toolCallId: traced,
      trace: (id) => {
        setTraced((current) => (current === id ? null : id));
      },
    }),
    [traced],
  );

  useEffect(() => {
    if (!view) return;
    const prefix = view.phase === 'awaiting_authorization' ? '● Decision needed · ' : '';
    document.title = `${prefix}${view.incident.id ?? 'Session'} · RunbookAI`;
    // When TrueForge pauses the run, bring the operator back to the decision.
    if (view.phase === 'awaiting_authorization' && lastPhase.current !== view.phase) {
      setSelectedStep(null);
    }
    lastPhase.current = view.phase;
  }, [view]);

  const stream = { connection, problem };
  const selected = view?.track.items.find((item) => item.key === selectedStep) ?? null;

  return (
    <HighlightContext.Provider value={highlight}>
      <div className="shell shell--run">
        {view && <SourceBanner view={view} />}
        <Masthead view={view} connection={connection} placeholder="Loading session…" />
        {view && (
          <StatusStrip
            view={view}
            stream={stream}
            sourcesOpen={sourcesOpen}
            onToggleSources={() => {
              setSourcesOpen((open) => !open);
            }}
          />
        )}
        {view && sourcesOpen && <DataSources view={view} stream={stream} />}
        {view && <BoundaryAlerts view={view} />}
        <StreamProblem problem={problem} />
        {view ? (
          <ErrorBoundary>
            <div className="console">
              <div className="console__track">
                <RunbookTrack view={view} selected={selectedStep} onSelect={setSelectedStep} />
              </div>
              <main className="console__main" id="main">
                <IncidentSummary view={view} />
                {selected ? (
                  <StepDetail
                    view={view}
                    item={selected}
                    onClose={() => {
                      setSelectedStep(null);
                    }}
                  />
                ) : view.phase === 'awaiting_authorization' ? (
                  <ApprovalBoundary view={view} />
                ) : (
                  <>
                    <StatusHeadline view={view} />
                    {view.gatedAction ? (
                      <ApprovalBoundary view={view} />
                    ) : (
                      <CurrentOperation view={view} />
                    )}
                  </>
                )}
                <SandboxValidation view={view} />
                <Remediation view={view} />
                <UntrustedContent view={view} />
                <SandboxRuns view={view} />
              </main>
              <aside className="console__aside" aria-label="Evidence and context">
                <EvidenceGate view={view} />
                <BlastRadiusCard view={view} />
                <RootCause view={view} />
                <RuntimeIdentity view={view} />
              </aside>
              <EventLog view={view} />
            </div>
          </ErrorBoundary>
        ) : (
          <ConsoleSkeleton problem={problem} />
        )}
      </div>
    </HighlightContext.Provider>
  );
}

function ReportScreen({ sessionId }: { sessionId: string }) {
  const { view, problem, connection } = useRunStream(sessionId);

  useEffect(() => {
    if (view) document.title = `Report · ${view.incident.id ?? 'Session'} · RunbookAI`;
  }, [view]);

  return (
    <div className="shell">
      {view && <SourceBanner view={view} />}
      <Masthead view={view} connection={connection} placeholder="Loading report…" />
      <StreamProblem problem={problem} />
      {view ? (
        <IncidentReport view={view} />
      ) : (
        <main className="state">
          <p className="hint">Building the report from TrueForge…</p>
        </main>
      )}
    </div>
  );
}

function Page({ placeholder, children }: { placeholder: string; children: ReactNode }) {
  return (
    <div className="shell">
      <Masthead view={null} connection={null} placeholder={placeholder} />
      {children}
    </div>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  const page = params.get('view');
  const [config, setConfig] = useState<DashboardConfigView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  let content: ReactNode;
  if (sessionId && page === 'report') {
    content = <ReportScreen sessionId={sessionId} />;
  } else if (sessionId) {
    content = <RunScreen sessionId={sessionId} />;
  } else if (page === 'new') {
    content = (
      <Page placeholder="Start a run">
        <StartRun />
      </Page>
    );
  } else {
    content = (
      <Page placeholder="Sessions">
        <SessionPicker config={config} />
      </Page>
    );
  }
  return <ConfigContext.Provider value={config}>{content}</ConfigContext.Provider>;
}
