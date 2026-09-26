import type { EvidenceItemView, EvidenceView, ProvenanceView } from '../../shared/view';
import { useHighlight } from '../lib/highlight';
import { shortId } from '../lib/format';
import { CheckIcon, CrossIcon, DashIcon, RingIcon } from './Icons';

const MARKS = {
  passed: CheckIcon,
  failed: CrossIcon,
  not_run: DashIcon,
  hypothesis: RingIcon,
} as const;

const CLAIM_TEXT: Record<EvidenceItemView['claim'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_run: 'Not run',
  hypothesis: 'Hypothesis, not proof',
};

function provenanceText(p: ProvenanceView): string {
  switch (p.status) {
    case 'verified':
      return p.recordedExitCode === null
        ? 'Matches TrueForge'
        : `Matches TrueForge · exit ${p.recordedExitCode}`;
    case 'mismatch':
      return 'Contradicted by TrueForge';
    case 'missing':
      return 'No such call in TrueForge';
    case 'pending':
      return 'Waiting for the result';
  }
}

/** Shows which TrueForge tool call backs a claim; clicking traces it across the page. */
export function Provenance({
  provenance,
  claim,
}: {
  provenance: ProvenanceView | null;
  claim: EvidenceItemView['claim'];
}) {
  const { trace } = useHighlight();
  if (!provenance) {
    return (
      <span
        className="prov prov--none"
        title="The claim does not cite a tool call, so it cannot be checked"
      >
        {claim === 'hypothesis'
          ? 'Reasoning'
          : claim === 'not_run'
            ? 'Nothing to check'
            : 'Unchecked'}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`prov prov--${provenance.status}`}
      onClick={() => {
        trace(provenance.toolCallId);
      }}
      title={`Show tool call ${provenance.toolCallId} in the sandbox list and event log`}
    >
      {provenanceText(provenance)}
      <code>{shortId(provenance.toolCallId, 14)}</code>
    </button>
  );
}

export function EvidenceItems({ items }: { items: EvidenceItemView[] }) {
  return (
    <ul className="evidence__list">
      {items.map((item) => {
        const Mark = MARKS[item.claim];
        return (
          <li key={item.key} className={`ev ev--${item.claim}`}>
            <Mark className="ev__mark" />
            <span className="ev__label">
              {item.label}
              <span className="visually-hidden">: {CLAIM_TEXT[item.claim]}</span>
            </span>
            <span className="ev__prov">
              <Provenance provenance={item.provenance} claim={item.claim} />
            </span>
            {item.detail && <span className="ev__detail">{item.detail}</span>}
            {item.provenance?.note && item.provenance.status !== 'pending' && (
              <span className="ev__note">{item.provenance.note}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The suspected root cause. Always labelled a hypothesis: it is reasoning, not proof. */
export function Hypothesis({ evidence }: { evidence: EvidenceView }) {
  return (
    <div className="hypothesis">
      <p className="hypothesis__label">Model hypothesis · not verified</p>
      <p className="hypothesis__summary">{evidence.hypothesis.summary}</p>
      {evidence.hypothesis.supportingFacts.length > 0 && (
        <ul className="hypothesis__facts">
          {evidence.hypothesis.supportingFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
