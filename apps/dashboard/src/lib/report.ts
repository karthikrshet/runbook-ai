import type { EvidenceItemView, RunView } from '../../shared/view';
import { POLICY_DECISION_TEXT } from './console';
import { headlineFor } from './copy';
import { CLASS_LABELS, clock, duration, plural, STEP_STATUS_LABELS, toolName } from './format';

const CLAIM_TEXT: Record<EvidenceItemView['claim'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_run: 'Not run',
  hypothesis: 'Hypothesis',
};

export function provenanceText(item: EvidenceItemView): string {
  const p = item.provenance;
  if (!p) return item.claim === 'hypothesis' ? 'Reasoning, not checkable' : 'No tool call cited';
  switch (p.status) {
    case 'verified':
      return `Matches TrueForge (${p.toolCallId}${p.recordedExitCode === null ? '' : `, exit ${String(p.recordedExitCode)}`})`;
    case 'mismatch':
      return `Contradicted by TrueForge (${p.toolCallId}): ${p.note ?? ''}`;
    case 'missing':
      return `No such call in TrueForge (${p.toolCallId})`;
    case 'pending':
      return `Waiting for ${p.toolCallId}`;
  }
}

/** The evidence gate in one line, as the console shows it. */
export function gateSummary(view: RunView): string {
  const { required, ready } = view.gate;
  if (required.length === 0) return 'No evidence requirements in the runbook';
  const verified = required.filter((item) => item.status === 'satisfied').length;
  return `${ready ? 'Ready' : 'Not ready'}: ${String(verified)} of ${String(required.length)} required items verified against TrueForge`;
}

export function runDuration(view: RunView): string | null {
  if (!view.startedAt || !view.lastEventAt) return null;
  return duration(Date.parse(view.lastEventAt) - Date.parse(view.startedAt));
}

/** Escapes text for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** The incident report as Markdown, built only from the view (TrueForge's record). */
export function buildReportMarkdown(view: RunView): string {
  const copy = headlineFor(view);
  const gated = view.gatedAction;
  const lines: string[] = [];
  const push = (...more: string[]): void => {
    lines.push(...more);
  };

  push(`# Incident report: ${view.incident.id ?? 'session'} ${view.incident.title}`, '');
  if (view.source.kind === 'fixture') {
    push(
      '> **Synthetic fixture.** This report was generated from a hand-written event log for UI development. None of it happened in TrueForge.',
      '',
    );
  }
  push(`**Outcome:** ${copy.title}. ${copy.body}`, '');
  push('| | |', '|---|---|');
  push(
    `| Incident | ${cell([view.incident.id, view.incident.severity, view.incident.service].filter(Boolean).join(' · ') || 'Not reported')} |`,
  );
  if (view.track.mode === 'runbook' && view.track.subtitle)
    push(`| Runbook | ${cell(view.track.subtitle)} |`);
  push(`| TrueForge session | ${cell(view.session.id)} |`);
  push(`| Started | ${view.startedAt ?? 'n/a'} |`);
  push(
    `| Last event | ${view.lastEventAt ?? 'n/a'}${runDuration(view) ? ` (${runDuration(view) ?? ''})` : ''} |`,
  );
  push(
    `| Agent actions | ${plural(view.counts.automatic, 'automatic call')}, ${plural(view.sandbox.execCallIds.length, 'sandbox command')}, ${plural(view.counts.gatedExecuted, 'external change')} |`,
  );
  const boundary = view.violations.some((v) => v.severity === 'violation')
    ? 'Crossed without approval (see violations)'
    : 'Held: nothing gated ran without a decision in TrueForge';
  push(`| Approval boundary | ${boundary} |`);
  push(`| Evidence gate | ${cell(gateSummary(view))} |`, '');

  if (gated) {
    const call = gated.call;
    push('## Gated action', '');
    push(`- Tool: \`${toolName(call.ref)}\` (${CLASS_LABELS[call.actionClass]})`);
    for (const arg of call.args) push(`- ${arg.key}: \`${arg.value}\``);
    const decision = call.approval?.decision;
    push(
      `- Decision: ${decision === 'allow' ? `approved in TrueForge at ${call.approval?.decidedAt ?? ''}` : decision === 'deny' ? `rejected in TrueForge at ${call.approval?.decidedAt ?? ''}${call.approval?.reason ? ` ("${call.approval.reason}")` : ''}` : call.status === 'awaiting_approval' ? 'waiting in TrueForge' : 'no decision recorded'}`,
    );
    if (call.resultPreview) push(`- Result recorded by TrueForge: \`${call.resultPreview}\``);
    const blast = gated.blastRadius;
    push(
      `- Policy decision: **${POLICY_DECISION_TEXT[call.decision].label}** (deterministic, from the permission matrix)`,
    );
    push(
      `- Blast radius: **${blast.riskClass}** (${gated.blastRadiusSource === 'policy' ? 'computed from the permission matrix' : 'reported by RunbookAI'}); ${blast.reasons.join('; ')}`,
      '',
    );
  }

  if (view.evidence) {
    push('## Root cause (hypothesis)', '', view.evidence.hypothesis.summary, '');
    for (const fact of view.evidence.hypothesis.supportingFacts) push(`- ${fact}`);
    push('', '## Evidence', '', '| Check | Claim | Checked against TrueForge |', '|---|---|---|');
    for (const item of view.evidence.items) {
      push(
        `| ${cell(item.label)}${item.detail ? ` (${cell(item.detail)})` : ''} | ${CLAIM_TEXT[item.claim]} | ${cell(provenanceText(item))} |`,
      );
    }
    push('', `**Rollback plan:** ${view.evidence.rollbackPlan.summary}`, '');
    if (view.evidence.unknowns.length > 0)
      push(`**Unknowns:** ${view.evidence.unknowns.join('; ')}`, '');
  }

  if (view.verification) {
    push(`## Verification: ${view.verification.healthy ? 'healthy' : 'not healthy'}`, '');
    for (const check of view.verification.checks)
      push(`- ${CLAIM_TEXT[check.claim]}: ${check.label} (${provenanceText(check)})`);
    push('');
  }

  push('## Runbook steps', '');
  for (const item of view.track.items) {
    push(
      `${item.index === null ? '-' : `${String(item.index)}.`} ${item.title}: ${STEP_STATUS_LABELS[item.status]}`,
    );
  }
  push('');

  const flagged = view.toolCalls.filter((call) => call.untrusted.length > 0);
  if (flagged.length > 0) {
    push('## Untrusted content (treated as data)', '');
    for (const call of flagged) {
      push(`- ${toolName(call.ref)}: ${call.untrusted.map((f) => f.label).join(', ')}`);
    }
    push('');
  }

  if (view.violations.length > 0) {
    push('## Boundary findings', '');
    for (const violation of view.violations)
      push(
        `- ${violation.severity === 'violation' ? 'Violation' : 'Policy gap'}: ${violation.message}`,
      );
    push('');
  }

  push('## Timeline', '', '| Time | Kind | Event |', '|---|---|---|');
  for (const entry of view.timeline) {
    push(
      `| ${clock(entry.at)} | ${entry.label} | ${cell(entry.title)}${entry.detail ? ` (${cell(entry.detail)})` : ''} |`,
    );
  }
  push(
    '',
    `_Generated by RunbookAI at ${view.generatedAt} from ${view.source.label}. Every row comes from TrueForge's event log for session ${view.session.id}; evidence marked "Matches TrueForge" was checked against the recorded tool call._`,
    '',
  );
  return lines.join('\n');
}
