import type { RunView } from '../../shared/view';
import { toolName } from '../lib/format';

/** Instruction-like text found in tool outputs. It is shown, never followed. */
export function UntrustedContent({ view }: { view: RunView }) {
  const flagged = view.toolCalls.filter((call) => call.untrusted.length > 0);
  if (flagged.length === 0) return null;

  return (
    <section className="card" aria-labelledby="untrusted-title">
      <div className="card__head">
        <h2 id="untrusted-title" className="label">
          Untrusted content
        </h2>
        <span className="chip chip--caution">Treated as data</span>
      </div>
      <p className="hint card__note">
        External content can contain instructions aimed at the agent. They cannot move the
        authorization line: what runs automatically is decided by the permission matrix, not by text
        in a tool output.
      </p>
      <ul>
        {flagged.map((call) => (
          <li key={call.id} className="untrusted__item">
            <p className="untrusted__source">
              Found in the output of <code>{toolName(call.ref)}</code>
            </p>
            <div className="untrusted__rules">
              {call.untrusted.map((finding) => (
                <span key={finding.rule} className="chip chip--caution">
                  {finding.label}
                </span>
              ))}
            </div>
            {call.untrusted[0] && <p className="untrusted__excerpt">{call.untrusted[0].excerpt}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
