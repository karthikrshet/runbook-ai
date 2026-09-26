import {
  computeBlastRadius,
  decisionFor,
  lookupToolPolicy,
  parseEnvelope,
  redactField,
  redactText,
  SANDBOX_EXEC_TOOL,
  scanUntrustedContent,
  type ConnectorNames,
  type EvidencePackage,
  type Incident,
  type RunbookAiEnvelope,
  type RunbookPlan,
  type StepStatus,
  type ToolPolicy,
  type VerificationReport,
} from '@runbook-ai/core';
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  DisplayClass,
  GatedActionView,
  Phase,
  RunView,
  SourceInfo,
  TimelineEntryView,
  TimelineKind,
  TimelineTone,
  ToolCallStatus,
  ToolCallView,
  ToolRefView,
  VerificationView,
  ViolationView,
} from '../../shared/view.js';
import type { SessionEvent, SessionEventItem, SessionMeta } from '../sources/types.js';
import {
  classifyResponse,
  isRecord,
  messageText,
  previewText,
  readableText,
  tryParseJson,
  type ResponseOutcome,
} from './content.js';
import { buildEvidenceGate, buildEvidenceView, buildVerificationView } from './evidence.js';
import { buildExecView } from './exec.js';
import { buildTrack } from './track.js';

export interface ProjectionInput {
  source: SourceInfo;
  session: SessionMeta;
  sessionUiUrl: string | null;
  /** Oldest first. */
  events: readonly SessionEventItem[];
  connectors: ConnectorNames;
  now: Date;
}

interface CallRecord {
  id: string;
  threadId: string;
  requestedAt: string;
  toolInfo: TrueForgeApi.ToolInfo;
  args: Record<string, unknown>;
  checkpoint: { eventId: string; requestedAt: string } | null;
  decision: { decision: 'allow' | 'deny'; decidedAt: string; reason: string | null } | null;
  response: { at: string; content: string } | null;
}

interface BuiltCall {
  view: ToolCallView;
  policy: ToolPolicy | null;
  envelope: RunbookAiEnvelope | null;
}

interface Found<T> {
  data: T;
  at: string;
  toolCallId: string;
}

const MAX_TIMELINE = 500;
const INCIDENT_ID = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/;

/**
 * Builds the dashboard view from a TrueForge session's event log. Pure and
 * deterministic: the same events always give the same view.
 */
export function projectSession(input: ProjectionInput): RunView {
  const collected = collect(input.events);
  const built = [...collected.records.values()].map((record) =>
    buildCall(record, input.connectors),
  );
  const views = built.map((b) => b.view);
  const byId = new Map(views.map((view) => [view.id, view]));

  const found = collectEnvelopes(built);
  const evidence = buildEvidenceView(found.evidence, byId);
  const verification = buildVerificationView(found.verification, byId);
  const gatedAction = pickGatedAction(built, evidence);
  const violations = findViolations(views);
  const phase = derivePhase({
    hasEvents: input.events.length > 0,
    turn: collected.turn,
    calls: views,
    gated: gatedAction?.call ?? null,
    verification,
    violated: violations.some((violation) => violation.severity === 'violation'),
  });

  const plan = found.plan?.data ?? null;
  const track = buildTrack({
    plan,
    progress: found.progress,
    calls: views,
    gatedAction: gatedAction?.call ?? null,
    evidence,
    phase,
    violations,
  });

  const timeline = input.events.flatMap(({ event }) => timelineFor(event, byId, collected.threads));

  return {
    source: input.source,
    session: {
      id: input.session.id,
      title: input.session.title,
      createdAt: input.session.createdAt,
      updatedAt: input.session.updatedAt,
      uiUrl: input.sessionUiUrl,
      turns: input.session.turns,
      costUsd: input.session.costUsd,
    },
    incident: incidentView(
      found.incident?.data ?? null,
      input.session.title,
      collected.firstPrompt,
    ),
    turn: collected.turn,
    phase,
    gatedAction,
    evidence,
    gate: buildEvidenceGate(plan, track.lineIndex, evidence),
    verification,
    track,
    connectors: [...collected.connectors].map(([name, state]) => ({ name, state })),
    toolCalls: views,
    sandbox: {
      sandboxId: collected.sandbox?.id ?? null,
      createdAt: collected.sandbox?.at ?? null,
      execCallIds: views.filter((v) => v.exec !== null).map((v) => v.id),
    },
    timeline: timeline.slice(-MAX_TIMELINE),
    violations,
    counts: {
      events: input.events.length,
      toolCalls: views.length,
      automatic: views.filter((v) => v.decision === 'auto' || v.decision === 'auto_in_sandbox')
        .length,
      gatedExecuted: views.filter((v) => isGatedView(v) && ran(v.status)).length,
      untrustedFlags: views.reduce((sum, v) => sum + v.untrusted.length, 0),
    },
    startedAt: input.events[0]?.event.createdAt ?? null,
    lastEventAt: input.events.at(-1)?.event.createdAt ?? null,
    generatedAt: input.now.toISOString(),
  };
}

/* ---------- pass 1: collect tool calls, checkpoints, decisions, results ---------- */

function collect(events: readonly SessionEventItem[]) {
  const records = new Map<string, CallRecord>();
  const threads = new Map<string, string>();
  const connectors = new Map<string, 'initialized' | 'auth_required'>();
  let firstPrompt: string | null = null;
  let sandbox: { id: string; at: string } | null = null;
  let turn: RunView['turn'] = { status: 'none', message: null, at: null };

  for (const { event } of events) {
    switch (event.type) {
      case 'turn.created':
        turn = { status: 'running', message: null, at: event.createdAt };
        for (const item of event.input ?? []) {
          if (item.type === 'user.message') {
            firstPrompt ??= messageText(item.content);
          } else if (item.type === 'user.tool_approval') {
            const record = records.get(item.toolCallId);
            if (record) {
              const reason =
                item.approval.status === 'deny' ? (item.approval.reason ?? null) : null;
              record.decision = {
                decision: item.approval.status,
                decidedAt: event.createdAt,
                reason: reason === null ? null : redactText(reason),
              };
            }
          }
        }
        break;
      case 'model.message':
        for (const toolCall of event.toolCalls ?? []) {
          records.set(toolCall.id, {
            id: toolCall.id,
            threadId: event.threadId,
            requestedAt: event.createdAt,
            toolInfo: toolCall.toolInfo,
            args: parseArgs(toolCall.function.arguments),
            checkpoint: null,
            decision: null,
            response: null,
          });
        }
        break;
      case 'tool.approval_required':
        for (const ref of event.toolCalls) {
          const record = records.get(ref.id);
          if (record) record.checkpoint = { eventId: event.id, requestedAt: event.createdAt };
        }
        break;
      case 'tool.response': {
        const record = records.get(event.toolCallId);
        if (record) record.response = { at: event.createdAt, content: event.content };
        break;
      }
      case 'sandbox.created':
        sandbox = { id: event.sandboxId, at: event.createdAt };
        break;
      case 'thread.created':
        threads.set(event.threadId, event.title);
        break;
      case 'turn.update':
        turn = { status: event.state.status, message: null, at: event.createdAt };
        break;
      case 'turn.done':
        turn = turnFromDone(event.state, event.createdAt);
        break;
      case 'mcp.initialize':
        for (const server of event.mcpServers) connectors.set(server.name, 'initialized');
        break;
      case 'mcp.auth_required':
        for (const server of event.mcpServers) connectors.set(server.name, 'auth_required');
        break;
      default:
        break;
    }
  }
  return { records, threads, connectors, firstPrompt, sandbox, turn };
}

function turnFromDone(state: TrueForgeApi.TurnDoneEventState, at: string): RunView['turn'] {
  switch (state.status) {
    case 'done':
      return { status: state.requiredActions.length > 0 ? 'paused' : 'done', message: null, at };
    case 'error':
      return { status: 'error', message: redactText(state.message), at };
    case 'cancelled':
      return { status: 'cancelled', message: `Cancelled (${state.reason})`, at };
  }
}

function parseArgs(text: string): Record<string, unknown> {
  const json = tryParseJson(text);
  if (isRecord(json)) return json;
  return text.trim() === '' ? {} : { arguments: text };
}

/* ---------- per-call view ---------- */

function toRef(info: TrueForgeApi.ToolInfo): ToolRefView {
  return info.type === 'mcp'
    ? { kind: 'mcp', server: info.serverName, tool: info.name }
    : { kind: 'system', server: '', tool: info.name };
}

function buildCall(record: CallRecord, connectors: ConnectorNames): BuiltCall {
  const ref = toRef(record.toolInfo);
  const policy = lookupToolPolicy(ref, connectors);
  const actionClass: DisplayClass = policy?.actionClass ?? 'UNCLASSIFIED';
  const content = record.response?.content ?? null;
  const outcome = content === null ? null : classifyResponse(content);
  const isExec = ref.kind === 'system' && ref.tool === SANDBOX_EXEC_TOOL;
  const exec = isExec ? buildExecView(record.args, content) : null;

  const trustedServer = ref.kind === 'mcp' && ref.server === connectors.runbookai;
  const envelope =
    content !== null && outcome?.kind === 'ok' && trustedServer ? parseEnvelope(content) : null;
  const untrusted =
    content !== null && outcome?.kind === 'ok' && envelope === null
      ? scanUntrustedContent(exec ? exec.output : readableText(content))
      : [];

  const view: ToolCallView = {
    id: record.id,
    threadId: record.threadId,
    requestedAt: record.requestedAt,
    completedAt: record.response?.at ?? null,
    ref,
    actionClass,
    decision: decisionFor(policy?.actionClass ?? null),
    policySummary: policy?.summary ?? null,
    args: argsView(record.args, isExec),
    intent:
      isExec && typeof record.args['intent'] === 'string'
        ? redactText(record.args['intent'])
        : null,
    status: deriveStatus(record, outcome, exec?.view ?? null),
    approval:
      record.checkpoint || record.decision
        ? {
            checkpointEventId: record.checkpoint?.eventId ?? '',
            requestedAt:
              record.checkpoint?.requestedAt ?? record.decision?.decidedAt ?? record.requestedAt,
            decision: record.decision?.decision ?? null,
            decidedAt: record.decision?.decidedAt ?? null,
            reason: record.decision?.reason ?? null,
          }
        : null,
    exec: exec?.view ?? null,
    resultPreview:
      content === null || exec || envelope
        ? null
        : outcome?.kind === 'ok'
          ? previewText(content)
          : (outcome?.message ?? null),
    untrusted,
    envelopeKind: envelope?.kind ?? null,
    system: policy?.system ?? null,
  };
  return { view, policy, envelope };
}

function deriveStatus(
  record: CallRecord,
  outcome: ResponseOutcome | null,
  exec: ToolCallView['exec'],
): ToolCallStatus {
  if (record.decision?.decision === 'deny' || outcome?.kind === 'denied') return 'denied';
  if (outcome) {
    if (outcome.kind === 'error') return 'failed';
    if (exec && (exec.infraError !== null || (exec.exitCode !== null && exec.exitCode !== 0))) {
      return 'failed';
    }
    return 'succeeded';
  }
  if (record.checkpoint && !record.decision) return 'awaiting_approval';
  return 'running';
}

const EXEC_ARGS_SHOWN_ELSEWHERE = new Set(['command', 'intent', 'cwd']);

function argsView(args: Record<string, unknown>, isExec: boolean): ToolCallView['args'] {
  const entries: ToolCallView['args'] = [];
  for (const [key, value] of Object.entries(args)) {
    if (isExec && EXEC_ARGS_SHOWN_ELSEWHERE.has(key)) continue;
    if (key === 'env' && isRecord(value)) {
      for (const [name, envValue] of Object.entries(value)) {
        entries.push({ key: `env.${name}`, value: redactField(name, String(envValue)) });
      }
      continue;
    }
    // Arguments come from JSON.parse, so every value serialises back to a string.
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const redacted = redactField(key, text);
    entries.push({ key, value: redacted.length > 400 ? `${redacted.slice(0, 399)}…` : redacted });
  }
  return entries.slice(0, 20);
}

/* ---------- envelopes from the trusted RunbookAI connector ---------- */

function collectEnvelopes(built: readonly BuiltCall[]) {
  let incident: Found<Incident> | null = null;
  let plan: Found<RunbookPlan> | null = null;
  let evidence: Found<EvidencePackage> | null = null;
  let verification: Found<VerificationReport> | null = null;
  const progress = new Map<number, StepStatus>();

  const ordered = built
    .filter((b): b is BuiltCall & { envelope: RunbookAiEnvelope } => b.envelope !== null)
    .sort((a, b) => Date.parse(a.view.completedAt ?? '') - Date.parse(b.view.completedAt ?? ''));

  for (const { envelope, view } of ordered) {
    const at = view.completedAt ?? view.requestedAt;
    switch (envelope.kind) {
      case 'incident':
        incident = { data: envelope.data, at, toolCallId: view.id };
        break;
      case 'runbook_plan':
        plan = { data: envelope.data, at, toolCallId: view.id };
        break;
      case 'evidence_package':
        evidence = { data: envelope.data, at, toolCallId: view.id };
        break;
      case 'verification_report':
        verification = { data: envelope.data, at, toolCallId: view.id };
        break;
    }
    for (const step of envelope.progress ?? []) progress.set(step.index, step.status);
  }
  return { incident, plan, evidence, verification, progress };
}

/* ---------- gate, violations, phase ---------- */

function isGatedView(view: ToolCallView): boolean {
  return view.decision === 'require_approval' || view.decision === 'deny';
}

function ran(status: ToolCallStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/** The action at the authorization line: the one awaiting a decision, else the latest gated one. */
function pickGatedAction(
  built: readonly BuiltCall[],
  evidence: ReturnType<typeof buildEvidenceView>,
): GatedActionView | null {
  const candidates = built.filter((b) => isGatedView(b.view) || b.view.approval !== null);
  const chosen =
    candidates.find((b) => b.view.status === 'awaiting_approval') ?? candidates.at(-1) ?? null;
  if (!chosen) return null;
  const reported =
    evidence?.blastRadius && evidence.proposedAction.tool === chosen.view.ref.tool
      ? evidence.blastRadius
      : null;
  return {
    call: chosen.view,
    blastRadius: reported ?? computeBlastRadius(chosen.policy),
    blastRadiusSource: reported ? 'runbookai' : 'policy',
  };
}

function toolLabel(view: ToolCallView | undefined): string {
  if (!view) return 'unknown tool';
  if (view.ref.kind === 'system') {
    return view.ref.tool === SANDBOX_EXEC_TOOL ? 'sandbox · exec' : `TrueForge · ${view.ref.tool}`;
  }
  return `${view.ref.server} · ${view.ref.tool}`;
}

/** Audits the approval boundary against what TrueForge actually executed. */
function findViolations(views: readonly ToolCallView[]): ViolationView[] {
  const violations: ViolationView[] = [];
  for (const view of views) {
    if (!ran(view.status)) continue;
    const at = view.completedAt ?? view.requestedAt;
    const approved = view.approval?.decision === 'allow';
    if (view.actionClass === 'FORBIDDEN') {
      violations.push({
        severity: 'violation',
        toolCallId: view.id,
        at,
        message: `${toolLabel(view)} is forbidden by policy but ran.`,
      });
    } else if (view.actionClass === 'UNCLASSIFIED') {
      if (!approved) {
        violations.push({
          severity: 'gap',
          toolCallId: view.id,
          at,
          message: `${toolLabel(view)} is not in the permission matrix and ran without approval.`,
        });
      }
    } else if (isGatedView(view) && !approved) {
      violations.push({
        severity: 'violation',
        toolCallId: view.id,
        at,
        message: `${toolLabel(view)} changes an external system but ran without an approval decision in TrueForge.`,
      });
    }
  }
  return violations;
}

function derivePhase(input: {
  hasEvents: boolean;
  turn: RunView['turn'];
  calls: readonly ToolCallView[];
  gated: ToolCallView | null;
  verification: VerificationView | null;
  violated: boolean;
}): Phase {
  if (!input.hasEvents) return 'waiting';
  // A crossed boundary outranks everything: the headline must never hide it.
  if (input.violated) return 'violated';
  if (input.calls.some((call) => call.status === 'awaiting_approval'))
    return 'awaiting_authorization';
  if (input.turn.status === 'error' || input.turn.status === 'cancelled') return 'failed';
  const decision = input.gated?.approval?.decision ?? null;
  if (decision === 'deny' || input.gated?.status === 'denied') return 'rejected';
  if (decision === 'allow') {
    const decidedAt = Date.parse(input.gated?.approval?.decidedAt ?? '');
    const verifiedAfter =
      input.verification !== null && Date.parse(input.verification.reportedAt) >= decidedAt;
    return verifiedAfter && input.verification?.healthy ? 'resolved' : 'authorized';
  }
  if (input.turn.status === 'done') return 'finished';
  return 'acting';
}

function incidentView(
  incident: Incident | null,
  sessionTitle: string | null,
  firstPrompt: string | null,
): RunView['incident'] {
  if (incident) {
    return {
      id: incident.id,
      title: incident.title,
      service: incident.service,
      severity: incident.severity ?? null,
      summary: incident.summary ?? null,
      openedAt: incident.openedAt ?? null,
      fromRunbookAi: true,
    };
  }
  return {
    id: INCIDENT_ID.exec(firstPrompt ?? '')?.[0] ?? null,
    title: sessionTitle ?? (firstPrompt ? previewText(firstPrompt, 120) : 'Untitled session'),
    service: null,
    severity: null,
    summary: null,
    openedAt: null,
    fromRunbookAi: false,
  };
}

/* ---------- pass 2: audit timeline ---------- */

const ENVELOPE_TITLES: Record<RunbookAiEnvelope['kind'], string> = {
  incident: 'Incident loaded',
  runbook_plan: 'Runbook compiled into typed steps',
  evidence_package: 'Evidence package built',
  verification_report: 'Verification report',
};

const ENVELOPE_KINDS: Record<RunbookAiEnvelope['kind'], TimelineKind> = {
  incident: 'incident.received',
  runbook_plan: 'runbook.parsed',
  evidence_package: 'evidence.added',
  verification_report: 'verification.completed',
};

type AddEntry = (
  kind: TimelineKind,
  label: string,
  title: string,
  detail: string | null,
  tone: TimelineTone,
  toolCallId?: string | null,
  threadId?: string | null,
) => void;

function timelineFor(
  event: SessionEvent,
  calls: ReadonlyMap<string, ToolCallView>,
  threads: ReadonlyMap<string, string>,
): TimelineEntryView[] {
  const entries: TimelineEntryView[] = [];
  const add: AddEntry = (kind, label, title, detail, tone, toolCallId = null, threadId = null) => {
    entries.push({
      id: `${event.id}:${entries.length}`,
      at: event.createdAt,
      kind,
      label,
      title,
      detail,
      tone,
      toolCallId,
      threadId,
    });
  };

  switch (event.type) {
    case 'turn.created':
      for (const item of event.input ?? []) {
        if (item.type === 'user.message') {
          add(
            'run.started',
            'Prompt',
            'Task given to the agent',
            previewText(messageText(item.content), 240),
            'neutral',
          );
        } else if (item.type === 'user.tool_approval') {
          const view = calls.get(item.toolCallId);
          const allowed = item.approval.status === 'allow';
          add(
            allowed ? 'approval.approved' : 'approval.rejected',
            'Decision',
            `${allowed ? 'Approved' : 'Rejected'} in TrueForge: ${toolLabel(view)}`,
            item.approval.status === 'deny' && item.approval.reason
              ? redactText(item.approval.reason)
              : null,
            allowed ? 'good' : 'bad',
            item.toolCallId,
          );
        }
      }
      break;
    case 'model.message': {
      const text = messageText(event.content).trim();
      const thread = event.threadId === 'main' ? null : event.threadId;
      if (text)
        add('agent.message', 'Agent', previewText(text, 200), null, 'neutral', null, thread);
      for (const toolCall of event.toolCalls ?? []) {
        const view = calls.get(toolCall.id);
        if (!view) continue;
        const detail = view.exec
          ? (view.intent ?? firstLine(view.exec.command))
          : (view.policySummary ?? null);
        add(
          view.exec ? 'sandbox.started' : 'tool.started',
          view.exec ? 'Sandbox' : 'Tool',
          `Called ${toolLabel(view)}`,
          detail,
          isGatedView(view) ? 'gate' : 'neutral',
          view.id,
          thread,
        );
      }
      break;
    }
    case 'tool.approval_required': {
      const names = event.toolCalls.map((ref) => toolLabel(calls.get(ref.id))).join(', ');
      add(
        'approval.required',
        'Checkpoint',
        `Stopped for approval: ${names}`,
        'TrueForge paused the run until a human decides.',
        'gate',
        event.toolCalls[0]?.id ?? null,
      );
      break;
    }
    case 'tool.response': {
      const view = calls.get(event.toolCallId);
      if (!view) {
        add('tool.completed', 'Result', 'Tool returned', null, 'neutral', event.toolCallId);
        break;
      }
      responseEntry(view, add);
      if (view.untrusted.length > 0) {
        add(
          'untrusted.flagged',
          'Untrusted',
          `Instruction-like text in ${toolLabel(view)} output, treated as data`,
          view.untrusted.map((finding) => finding.label).join(' · '),
          'caution',
          view.id,
        );
      }
      break;
    }
    case 'sandbox.created':
      add('sandbox.created', 'Sandbox', 'Sandbox created', event.sandboxId, 'neutral');
      break;
    case 'turn.update':
      if (event.state.status === 'paused')
        add('run.paused', 'Run', 'Paused until a decision is made in TrueForge', null, 'gate');
      break;
    case 'turn.done':
      if (event.state.status === 'error')
        add('run.failed', 'Run', 'Run failed', redactText(event.state.message), 'bad');
      else if (event.state.status === 'cancelled')
        add('run.cancelled', 'Run', 'Run cancelled', null, 'bad');
      else if (event.state.requiredActions.length === 0)
        add('run.completed', 'Run', 'Turn finished', null, 'neutral');
      break;
    case 'mcp.initialize':
      add(
        'connectors.initialized',
        'Connectors',
        `Connected ${event.mcpServers.map((server) => server.name).join(', ') || 'no MCP servers'}`,
        null,
        'neutral',
      );
      break;
    case 'thread.created':
      add(
        'subagent.started',
        'Subagent',
        `Started subagent: ${event.title}`,
        null,
        'neutral',
        event.parent.toolCallId,
        event.threadId,
      );
      break;
    case 'thread.done':
      add(
        'subagent.completed',
        'Subagent',
        `Subagent finished: ${threads.get(event.threadId) ?? event.title}`,
        null,
        event.state.status === 'error' ? 'bad' : 'neutral',
        null,
        event.threadId,
      );
      break;
    case 'tool.response_required':
      add('client.waiting', 'Client', 'Waiting for a client-side tool result', null, 'caution');
      break;
    case 'mcp.auth_required':
      add(
        'connectors.auth_required',
        'Connectors',
        'A connector needs authorization',
        event.mcpServers.map((server) => server.name).join(', '),
        'caution',
      );
      break;
  }
  return entries;
}

function responseEntry(view: ToolCallView, add: AddEntry): void {
  if (view.status === 'denied') {
    add(
      'action.not_run',
      'Result',
      `${toolLabel(view)} did not run`,
      view.approval?.reason ?? 'Rejected in TrueForge',
      'bad',
      view.id,
    );
    return;
  }
  if (view.exec) {
    const { exec } = view;
    if (exec.infraError !== null) {
      add(
        'sandbox.failed',
        'Sandbox',
        'Sandbox error: the command did not run',
        exec.infraError,
        'bad',
        view.id,
      );
      return;
    }
    const tests = exec.tests ? ` · tests ${exec.tests.passed}/${exec.tests.total} passed` : '';
    const exit = exec.exitCode === null ? 'finished' : `exited ${exec.exitCode}`;
    add(
      'sandbox.completed',
      'Sandbox',
      `Command ${exit}${tests}`,
      view.intent,
      exec.exitCode === 0 ? 'good' : 'bad',
      view.id,
    );
    return;
  }
  if (view.envelopeKind) {
    const kind = view.envelopeKind as RunbookAiEnvelope['kind'];
    add(ENVELOPE_KINDS[kind], 'RunbookAI', ENVELOPE_TITLES[kind], null, 'neutral', view.id);
    return;
  }
  if (view.status === 'failed') {
    add('tool.failed', 'Result', `${toolLabel(view)} failed`, view.resultPreview, 'bad', view.id);
    return;
  }
  if (isGatedView(view)) {
    const approved = view.approval?.decision === 'allow';
    add(
      approved ? 'action.completed' : 'boundary.crossed',
      'Action',
      `${toolLabel(view)} ran${approved ? ' after approval' : ' without approval'}`,
      view.resultPreview,
      approved ? 'good' : 'bad',
      view.id,
    );
    return;
  }
  add(
    'tool.completed',
    'Result',
    `${toolLabel(view)} returned`,
    view.resultPreview,
    'neutral',
    view.id,
  );
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}
