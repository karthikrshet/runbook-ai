import { useEffect, useState, type SubmitEvent } from 'react';
import {
  buildRunPrompt,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  INCIDENT_ID_PATTERN,
} from '../../shared/run-request';
import type { PreflightView, RunbookSummaryView } from '../../shared/view';
import { fetchPreflight, fetchRunbooks, startRun } from '../lib/api';
import { useConfig } from '../lib/config';
import { CheckIcon, CrossIcon, DashIcon } from './Icons';

type Load<T> =
  { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; message: string };

const COVERAGE_TEXT: Record<PreflightView['gates'][number]['coverage'], string> = {
  explicit: 'Pauses: named in requireApprovalForTools',
  all: 'Pauses: connector requires approval for @all',
  annotation: 'Pauses only if marked write or destructive',
  missing: 'Would run without asking',
  disabled: 'Not exposed by the connector',
};

function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled: boolean,
  attempt: number,
): Load<T> {
  const [result, setResult] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        setResult({ state: 'ready', value });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            state: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      controller.abort();
    };
  }, [load, enabled, attempt]);
  return result;
}

function Preflight({ load, onRetry }: { load: Load<PreflightView>; onRetry: () => void }) {
  return (
    <section className="card" aria-labelledby="preflight-title">
      <div className="card__head">
        <h2 id="preflight-title" className="label">
          Pre-flight
        </h2>
        <span className="chip">Read from TrueForge</span>
      </div>
      <div className="card__body">
        {load.state === 'loading' && (
          <p className="hint">Reading the agent’s configuration from TrueForge…</p>
        )}
        {load.state === 'failed' && (
          <p className="preflight__error" role="alert">
            {load.message}{' '}
            <button type="button" className="prov" onClick={onRetry}>
              Check again
            </button>
          </p>
        )}
        {load.state === 'ready' && (
          <>
            <ul className="checks">
              {load.value.checks.map((check) => (
                <li key={check.key} className={`check check--${check.status}`}>
                  {check.status === 'ok' ? (
                    <CheckIcon className="check__mark" />
                  ) : check.status === 'warn' ? (
                    <DashIcon className="check__mark" />
                  ) : (
                    <CrossIcon className="check__mark" />
                  )}
                  <span className="check__label">{check.label}</span>
                  <span className="check__detail">{check.detail}</span>
                </li>
              ))}
            </ul>
            {load.value.gates.length > 0 && (
              <div className="gates">
                <h3 className="sublabel">Tools RunbookAI never runs without approval</h3>
                <ul>
                  {load.value.gates.map((gate) => (
                    <li
                      key={`${gate.connector}/${gate.tool}`}
                      className={`gate gate--${gate.coverage}`}
                    >
                      <code>{gate.tool}</code>
                      <span>{COVERAGE_TEXT[gate.coverage]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** What pre-flight checks in a live run; demo mode has no TrueForge agent to read. */
function PreflightPreview() {
  const checks = [
    ['Agent', 'The configured agent exists in TrueForge'],
    ['Sandbox', 'Generated code runs in the TrueForge sandbox, never on the host'],
    ['Connector', 'The RunbookAI connector is attached to the agent'],
    ['Approvals', 'TrueForge pauses before every tool RunbookAI’s policy gates'],
  ] as const;
  return (
    <section className="card" aria-labelledby="preflight-title">
      <div className="card__head">
        <h2 id="preflight-title" className="label">
          Pre-flight
        </h2>
        <span className="chip chip--demo">Not checked in demo</span>
      </div>
      <div className="card__body">
        <ul className="checks">
          {checks.map(([label, detail]) => (
            <li key={label} className="check check--preview">
              <DashIcon className="check__mark" />
              <span className="check__label">{label}</span>
              <span className="check__detail">{detail}</span>
            </li>
          ))}
        </ul>
        <p className="hint">In a live run, a failed check blocks the start.</p>
      </div>
    </section>
  );
}

/** Hands an incident to the TrueForge agent. The agent does the work; this only starts it. */
export function StartRun() {
  const config = useConfig();
  const enabled = config?.startRunsEnabled ?? false;
  // Demo mode shows the real form as a preview: nothing can be started without TrueForge.
  const preview = config?.source.kind === 'fixture';
  const [attempt, setAttempt] = useState(0);
  const runbooks = useLoad<RunbookSummaryView[]>(fetchRunbooks, enabled || preview, 0);
  const preflight = useLoad<PreflightView>(fetchPreflight, enabled, attempt);

  const [runbookId, setRunbookId] = useState('');
  const [incidentId, setIncidentId] = useState('INC-001');
  const [description, setDescription] = useState(
    'checkout-api started returning 500 responses after the latest release.',
  );
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const available = runbooks.state === 'ready' ? runbooks.value : [];
  const selected = available.find((r) => r.id === runbookId) ?? available[0] ?? null;
  const idValid = INCIDENT_ID_PATTERN.test(incidentId);
  const descriptionLength = description.trim().length;
  const descriptionValid =
    descriptionLength >= DESCRIPTION_MIN && descriptionLength <= DESCRIPTION_MAX;
  const ready = preflight.state === 'ready' && preflight.value.canStart;
  const canSubmit = selected !== null && idValid && descriptionValid && ready && !submitting;
  const prompt = selected
    ? buildRunPrompt({ runbookId: selected.id, incidentId, description })
    : null;

  if (config && !enabled && !preview) {
    return (
      <main className="state">
        <p className="label">Start a run</p>
        <h1 className="state__title">Starting runs is off here</h1>
        <p className="state__body">
          Start the run in TrueForge’s chat instead, or set DASHBOARD_START_RUNS=on for the
          dashboard.
        </p>
        {config.trueforgeUiUrl && (
          <a className="link-button" href={config.trueforgeUiUrl} target="_blank" rel="noreferrer">
            Open TrueForge
          </a>
        )}
      </main>
    );
  }

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    // canSubmit implies a runbook is selected; TypeScript narrows `selected` through it.
    if (!canSubmit) return;
    setSubmitting(true);
    setProblem(null);
    startRun({ runbookId: selected.id, incidentId, description })
      .then(({ sessionId }) => {
        window.location.assign(`?session=${encodeURIComponent(sessionId)}`);
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <main className="start">
      <header className="start__intro">
        <p className="label">Start a run</p>
        <h1 className="state__title">Hand an incident to the agent</h1>
        <p className="state__body">
          RunbookAI starts a TrueForge session with the{' '}
          {config?.agentName ? <code>{config.agentName}</code> : 'configured'} agent. Read-only and
          sandbox steps run on their own; anything that changes an external system stops for your
          approval.
        </p>
        {preview && (
          <p className="callout callout--demo">
            <strong>UI preview · not connected.</strong> Demo mode has no TrueForge to start a run
            in. The form and the message the agent would receive are real; starting is disabled.
          </p>
        )}
      </header>

      <form className="card start__form" onSubmit={submit} noValidate>
        <div className="card__head">
          <h2 className="label">Incident</h2>
        </div>
        <div className="card__body">
          <label className="field">
            <span className="field__label">Runbook</span>
            <select
              value={selected?.id ?? ''}
              onChange={(event) => {
                setRunbookId(event.target.value);
              }}
              disabled={available.length === 0}
            >
              {available.map((runbook) => (
                <option key={runbook.id} value={runbook.id}>
                  {runbook.title} ({runbook.id})
                </option>
              ))}
            </select>
            {runbooks.state === 'ready' && available.length === 0 && (
              <span className="field__error">
                No runbooks found. Add a Markdown file to runbooks/.
              </span>
            )}
          </label>

          <label className="field">
            <span className="field__label">Incident id</span>
            <input
              value={incidentId}
              onChange={(event) => {
                setIncidentId(event.target.value.toUpperCase());
              }}
              aria-invalid={!idValid}
              spellCheck={false}
              autoComplete="off"
            />
            {!idValid && <span className="field__error">Use a form like INC-001.</span>}
          </label>

          <label className="field">
            <span className="field__label">What is happening</span>
            <textarea
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              aria-invalid={!descriptionValid}
            />
            {!descriptionValid && (
              <span className="field__error">
                Describe the incident in {DESCRIPTION_MIN} to {DESCRIPTION_MAX} characters.
              </span>
            )}
          </label>

          {prompt && (
            <div className="field">
              <span className="field__label">Message the agent receives</span>
              <p className="prompt">{prompt}</p>
            </div>
          )}

          {problem && (
            <p className="field__error" role="alert">
              {problem}
            </p>
          )}
        </div>
        <div className="card__foot">
          <span>
            {preview
              ? 'Not connected: a live run starts a TrueForge session and opens it here.'
              : ready
                ? 'Starts a new session in TrueForge and opens it here.'
                : 'Resolve the failed pre-flight checks to start a run.'}
          </span>
          <button type="submit" className="button button--approve" disabled={!canSubmit}>
            {submitting ? 'Starting…' : 'Start run in TrueForge'}
          </button>
        </div>
      </form>

      <div className="start__side">
        {preview ? (
          <PreflightPreview />
        ) : (
          <Preflight
            load={preflight}
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {selected && (
          <section className="card" aria-labelledby="runbook-title">
            <div className="card__head">
              <h2 id="runbook-title" className="label">
                Runbook
              </h2>
              <code className="hint">{selected.id}</code>
            </div>
            <ol className="runbook-steps">
              {selected.steps.map((step, index) => (
                <li key={`${String(index)}-${step}`}>
                  <span className="runbook-steps__num">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
