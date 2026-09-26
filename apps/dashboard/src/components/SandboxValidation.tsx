import type { EvidenceItemView, RunView } from '../../shared/view';
import { plural } from '../lib/format';
import { Provenance } from './Evidence';

const CHECKS: readonly [key: string, label: string][] = [
  ['reproduction', 'Reproduction'],
  ['unitTests', 'Unit tests'],
  ['integrationTests', 'Integration tests'],
  ['lint', 'Lint'],
  ['typecheck', 'Typecheck'],
  ['healthProbe', 'Health probe'],
];

type CheckState =
  'passed' | 'failed' | 'not_run' | 'running' | 'unavailable' | 'contradicted' | 'unchecked';

const STATE_TEXT: Record<CheckState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_run: 'Not run',
  running: 'Running',
  unavailable: 'Unavailable',
  contradicted: 'Contradicted',
  unchecked: 'Passed · unchecked',
};

/** A check's state from the claim and from TrueForge's record of the call it cites. */
function stateOf(item: EvidenceItemView | undefined): CheckState {
  if (!item) return 'unavailable';
  if (item.claim === 'not_run') return 'not_run';
  const recorded = item.provenance?.status;
  if (recorded === 'mismatch' || recorded === 'missing') return 'contradicted';
  if (recorded === 'pending') return 'running';
  if (item.claim === 'failed') return 'failed';
  return recorded === 'verified' ? 'passed' : 'unchecked';
}

/**
 * Independent checks the agent ran in the sandbox. Every state comes from the evidence
 * package, re-checked against TrueForge's record of the command it cites.
 */
export function SandboxValidation({ view }: { view: RunView }) {
  const items = view.evidence?.items ?? [];
  const running = view.toolCalls.some((call) => call.exec !== null && call.status === 'running');
  const sandboxRuns = view.sandbox.execCallIds.length;

  return (
    <section className="panel" aria-labelledby="validation-title">
      <div className="panel__head">
        <h2 id="validation-title" className="label">
          Sandbox validation
        </h2>
        {running && <span className="chip chip--caution">Running in the sandbox…</span>}
      </div>
      <div className="panel__body">
        {view.evidence ? (
          <table className="checks-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">State</th>
                <th scope="col">Result</th>
                <th scope="col">Checked against TrueForge</th>
              </tr>
            </thead>
            <tbody>
              {CHECKS.map(([key, label]) => {
                const item = items.find((candidate) => candidate.key === key);
                const state = stateOf(item);
                return (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td>
                      <span className={`check-state check-state--${state}`}>
                        {key === 'reproduction' && state === 'passed'
                          ? 'Reproduced'
                          : STATE_TEXT[state]}
                      </span>
                    </td>
                    <td className="checks-table__detail">{item?.detail ?? '—'}</td>
                    <td>
                      {item ? <Provenance provenance={item.provenance} claim={item.claim} /> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">
            {sandboxRuns === 0
              ? 'No sandbox run available yet. Generated code runs in the TrueForge sandbox, never on the host.'
              : `${plural(sandboxRuns, 'sandbox command')} so far. Check results appear when RunbookAI reports its evidence package.`}
          </p>
        )}
      </div>
    </section>
  );
}
