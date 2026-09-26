import { useEffect, useRef } from 'react';
import type { RunView, ToolCallView } from '../../shared/view';
import { clock, firstLine, plural, shortId } from '../lib/format';
import { useHighlight } from '../lib/highlight';
import { DemoTag } from './Banners';

function ExitBadge({ call }: { call: ToolCallView }) {
  const exec = call.exec;
  if (!exec || call.status === 'running') return <span className="exit exit--none">running</span>;
  if (exec.infraError !== null) return <span className="exit exit--fail">error</span>;
  if (exec.exitCode === null) return <span className="exit exit--none">exit ?</span>;
  return (
    <span className={`exit ${exec.exitCode === 0 ? 'exit--ok' : 'exit--fail'}`}>
      exit {exec.exitCode}
    </span>
  );
}

function Run({
  call,
  highlighted,
  demo,
}: {
  call: ToolCallView;
  highlighted: boolean;
  demo: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlighted]);

  const exec = call.exec;
  if (!exec) return null;
  const command = firstLine(exec.command);
  const tests = exec.tests;

  return (
    <li className="run" ref={ref} data-highlighted={highlighted} id={`run-${call.id}`}>
      <time className="run__time" dateTime={call.requestedAt}>
        {clock(call.requestedAt)}
      </time>
      <ExitBadge call={call} />
      <div className="run__body">
        <p className="run__intent">{call.intent ?? 'No description given'}</p>
        <code className="run__cmd" title={exec.command}>
          {command.line}
          {command.more ? ' …' : ''}
        </code>
        {tests && (
          <span className={`tests ${tests.failed > 0 ? 'tests--fail' : 'tests--pass'}`}>
            Tests {tests.passed}/{tests.total} passed
            {tests.failed > 0 && ` · ${tests.failed} failed`}
          </span>
        )}
        {tests && tests.failedTests.length > 0 && (
          <ul className="run__failed" aria-label="Failing tests">
            {tests.failedTests.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
        {exec.infraError && <p className="run__infra">Sandbox error: {exec.infraError}</p>}
        {exec.outputTail && (
          <details className="run__output">
            <summary>
              Output · {plural(exec.outputLineCount, 'line')}
              {exec.truncated ? ', showing the end' : ''} · <code>{shortId(call.id, 14)}</code>
              {demo && <DemoTag />}
            </summary>
            <pre>{exec.outputTail}</pre>
          </details>
        )}
      </div>
    </li>
  );
}

export function SandboxRuns({ view }: { view: RunView }) {
  const { toolCallId } = useHighlight();
  const runs = view.toolCalls.filter((call) => call.exec !== null);

  return (
    <section className="card" aria-labelledby="sandbox-title">
      <div className="card__head">
        <h2 id="sandbox-title" className="label">
          Sandbox
        </h2>
        {view.sandbox.sandboxId && <code className="hint">{view.sandbox.sandboxId}</code>}
        <span className="chip">{plural(runs.length, 'command')}</span>
      </div>
      {runs.length === 0 ? (
        <div className="card__body">
          <p className="hint">
            No sandbox commands yet. Generated code runs here, never on the host.
          </p>
        </div>
      ) : (
        <>
          <p className="hint card__note">
            Descriptions are written by the agent. Exit codes and output are what TrueForge
            recorded.
          </p>
          <ol className="runs">
            {runs.map((call) => (
              <Run
                key={call.id}
                call={call}
                highlighted={toolCallId === call.id}
                demo={view.source.kind === 'fixture'}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
