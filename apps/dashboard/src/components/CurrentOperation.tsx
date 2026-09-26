import type { RunView } from '../../shared/view';
import { currentCall, stepForCall } from '../lib/console';
import { emptyOperationText } from '../lib/copy';
import { CallDetail } from './CallDetail';

/**
 * What the agent is doing now: the call TrueForge is running, else the latest one it
 * recorded. A failed sandbox stops here; RunbookAI never falls back to the host.
 */
export function CurrentOperation({ view }: { view: RunView }) {
  const call = currentCall(view);
  // Name a runbook step only when TrueForge's record links this call to it; the track's
  // current step can be a different one (steps link calls through their evidence).
  const step = call ? stepForCall(view, call.id) : null;
  const lastRun = view.toolCalls.filter((candidate) => candidate.exec !== null).at(-1);
  const sandboxDown = lastRun?.exec?.infraError ?? null;
  const running = call?.status === 'running';

  return (
    <section className="panel operation" aria-labelledby="operation-title">
      <div className="panel__head">
        <h2 id="operation-title" className="label">
          {running ? 'Current operation' : 'Latest operation'}
        </h2>
        {step && (
          <span className="hint">
            {step.index !== null ? `Step ${String(step.index)} · ` : ''}
            {step.title}
          </span>
        )}
      </div>
      <div className="panel__body">
        {sandboxDown && (
          <div className="callout callout--bad" role="alert">
            <strong>Sandbox unavailable.</strong> Execution cannot continue because the configured
            sandbox runtime is not available: {sandboxDown}. RunbookAI never falls back to running
            generated code on the host.
          </div>
        )}
        {call ? (
          <>
            <CallDetail
              call={call}
              demo={view.source.kind === 'fixture'}
              outputOpen={running || call.exec !== null}
            />
            {running && call.exec && (
              <p className="hint">
                TrueForge records a command&rsquo;s output when it finishes; it appears here then.
              </p>
            )}
          </>
        ) : (
          <p className="empty">{emptyOperationText(view.phase)}</p>
        )}
      </div>
    </section>
  );
}
