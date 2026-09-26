import type { RunView } from '../../shared/view';
import { currentCall } from '../lib/console';
import { CallDetail } from './CallDetail';

/**
 * What the agent is doing now: the call TrueForge is running, else the latest one it
 * recorded. A failed sandbox stops here; RunbookAI never falls back to the host.
 */
export function CurrentOperation({ view }: { view: RunView }) {
  const call = currentCall(view);
  const active = view.track.items.find((item) => item.status === 'active');
  const lastRun = view.toolCalls.filter((candidate) => candidate.exec !== null).at(-1);
  const sandboxDown = lastRun?.exec?.infraError ?? null;
  const running = call?.status === 'running';

  return (
    <section className="panel operation" aria-labelledby="operation-title">
      <div className="panel__head">
        <h2 id="operation-title" className="label">
          {running ? 'Current operation' : 'Latest operation'}
        </h2>
        {active && (
          <span className="hint">
            {active.index !== null ? `Step ${String(active.index)} · ` : ''}
            {active.title}
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
          <CallDetail
            call={call}
            demo={view.source.kind === 'fixture'}
            outputOpen={running || call.exec !== null}
          />
        ) : (
          <p className="empty">
            {view.phase === 'waiting'
              ? 'Waiting for the agent to start. Give it its task in TrueForge; each step appears here as TrueForge records it.'
              : 'No tool calls yet. The agent is reading the task.'}
          </p>
        )}
      </div>
    </section>
  );
}
