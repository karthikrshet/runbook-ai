import type { ToolCallView } from '../../shared/view';
import { callsDuration, POLICY_DECISION_TEXT, runtimeFor } from '../lib/console';
import { clock, duration, plural, shortId, toolName } from '../lib/format';
import { DemoTag } from './Banners';
import { ClassChip } from './ClassChip';

/** A call's outcome in words: running, waiting, rejected, or what TrueForge recorded. */
export function CallStatus({ call }: { call: ToolCallView }) {
  const exec = call.exec;
  switch (call.status) {
    case 'running':
      return <span className="call-status call-status--caution">Running</span>;
    case 'awaiting_approval':
      return <span className="call-status call-status--gate">Awaiting approval</span>;
    case 'denied':
      return <span className="call-status call-status--bad">Rejected</span>;
    case 'succeeded':
      return (
        <span className="call-status call-status--good">
          {exec ? `exit ${String(exec.exitCode ?? '?')}` : 'Succeeded'}
        </span>
      );
    case 'failed':
      return (
        <span className="call-status call-status--bad">
          {exec?.infraError
            ? 'Sandbox error'
            : exec
              ? `exit ${String(exec.exitCode ?? '?')}`
              : 'Failed'}
        </span>
      );
  }
}

interface CallDetailProps {
  call: ToolCallView;
  /** Output from a fixture replay is labelled, never passed off as TrueForge output. */
  demo: boolean;
  /** Show the output without a disclosure; used for the operation in focus. */
  outputOpen?: boolean;
}

/** One tool call exactly as TrueForge recorded it, with secrets already redacted by the server. */
export function CallDetail({ call, demo, outputOpen = false }: CallDetailProps) {
  const exec = call.exec;
  const ms = callsDuration([call]);
  const decision = POLICY_DECISION_TEXT[call.decision];

  return (
    <article className="call" aria-label={`Tool call ${toolName(call.ref)}`}>
      <header className="call__head">
        <code className="call__tool">{toolName(call.ref)}</code>
        <ClassChip value={call.actionClass} />
        <CallStatus call={call} />
      </header>
      {exec && call.intent && (
        <p className="call__intent">
          {call.intent}
          {call.status === 'running' && <span className="activity" aria-hidden="true" />}
          <span className="call__by">described by the agent</span>
        </p>
      )}
      <dl className="kv kv--compact">
        <div className="kv__row">
          <dt>Runtime</dt>
          <dd>{runtimeFor(call)}</dd>
        </div>
        <div className="kv__row">
          <dt>Boundary</dt>
          <dd>
            {call.actionClass} · {decision.label}
          </dd>
        </div>
        <div className="kv__row">
          <dt>Started</dt>
          <dd>
            <time dateTime={call.requestedAt}>{clock(call.requestedAt)}</time>
            {ms !== null && ` · ${duration(ms)}`}
            <code className="call__id">{shortId(call.id, 16)}</code>
          </dd>
        </div>
        {exec?.cwd && (
          <div className="kv__row">
            <dt>Directory</dt>
            <dd>
              <code>{exec.cwd}</code>
            </dd>
          </div>
        )}
      </dl>

      {exec ? (
        <>
          <pre className="call__command">
            <code>{exec.command}</code>
          </pre>
          {exec.tests && (
            <p className={`tests ${exec.tests.failed > 0 ? 'tests--fail' : 'tests--pass'}`}>
              Tests {exec.tests.passed}/{exec.tests.total} passed
              {exec.tests.failed > 0 && ` · ${String(exec.tests.failed)} failed`}
            </p>
          )}
          {exec.infraError && <p className="run__infra">Sandbox error: {exec.infraError}</p>}
          {exec.outputTail ? (
            <details className="call__output" open={outputOpen}>
              <summary>
                Output · {plural(exec.outputLineCount, 'line')}
                {exec.truncated ? ', showing the end' : ''}
                {demo && <DemoTag />}
              </summary>
              <pre>{exec.outputTail}</pre>
            </details>
          ) : (
            call.status !== 'running' && <p className="hint">No output recorded.</p>
          )}
        </>
      ) : (
        <>
          {call.args.length > 0 && (
            <dl className="args" aria-label="Arguments, secrets redacted">
              {call.args.map((arg) => (
                <div key={arg.key} className="args__row">
                  <dt>{arg.key}</dt>
                  <dd>{arg.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {call.resultPreview && (
            <div className="call__result">
              <p className="sublabel">
                Result recorded {demo ? 'in the fixture' : 'by TrueForge'}
                {demo && <DemoTag />}
              </p>
              <pre className={`result ${call.status === 'failed' ? 'result--failed' : ''}`}>
                {call.resultPreview}
              </pre>
            </div>
          )}
          {call.envelopeKind && (
            <p className="hint">
              Structured RunbookAI result ({call.envelopeKind}), shown in its panel.
            </p>
          )}
        </>
      )}
    </article>
  );
}
