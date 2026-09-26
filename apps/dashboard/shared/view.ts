import type { ActionClass, BlastRadius, PolicyDecision } from '@runbook-ai/core';

/**
 * The dashboard's read-only view of one TrueForge session. The server builds it
 * from TrueForge's event log; the browser only renders it.
 */

export type SourceKind = 'trueforge' | 'fixture';

export interface SourceInfo {
  kind: SourceKind;
  /** Where the data comes from, e.g. "TrueForge at http://localhost:8790". */
  label: string;
}

/** Action class from the permission matrix; UNCLASSIFIED when the tool is not in it. */
export type DisplayClass = ActionClass | 'UNCLASSIFIED';

export type Phase =
  | 'waiting'
  | 'acting'
  | 'awaiting_authorization'
  | 'authorized'
  | 'rejected'
  | 'resolved'
  | 'finished'
  | 'failed'
  /** TrueForge paused the turn for something other than an approval; see RunView.pause. */
  | 'paused'
  /** A gated or forbidden action ran without an approval decision. */
  | 'violated';

/** Why TrueForge paused a turn when no approval is pending. */
export interface PauseView {
  /** connector_auth: a connector needs a login; user_input: the agent asked the user something. */
  reason: 'connector_auth' | 'user_input' | 'other';
  /** Connector names or the question asked, when TrueForge's record has them. */
  detail: string | null;
}

export interface ToolRefView {
  kind: 'mcp' | 'system';
  /** MCP connector name; empty for TrueForge system tools. */
  server: string;
  tool: string;
}

export interface ApprovalView {
  checkpointEventId: string;
  requestedAt: string;
  decision: 'allow' | 'deny' | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface TestSummaryView {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  failedTests: string[];
}

export interface ExecView {
  command: string;
  cwd: string | null;
  exitCode: number | null;
  /** Set when the sandbox itself failed and the command never ran. */
  infraError: string | null;
  outputTail: string;
  outputLineCount: number;
  truncated: boolean;
  tests: TestSummaryView | null;
}

export interface UntrustedFlagView {
  rule: string;
  label: string;
  excerpt: string;
}

export type ToolCallStatus = 'running' | 'awaiting_approval' | 'denied' | 'succeeded' | 'failed';

export interface ToolCallView {
  id: string;
  threadId: string;
  requestedAt: string;
  completedAt: string | null;
  ref: ToolRefView;
  actionClass: DisplayClass;
  decision: PolicyDecision;
  /** What the permission matrix says the tool does. */
  policySummary: string | null;
  args: { key: string; value: string }[];
  /** The agent's own description of a sandbox command. Written by the model. */
  intent: string | null;
  status: ToolCallStatus;
  approval: ApprovalView | null;
  exec: ExecView | null;
  resultPreview: string | null;
  untrusted: UntrustedFlagView[];
  /** Set when this result was a RunbookAI envelope from the trusted connector. */
  envelopeKind: string | null;
  /**
   * External system the tool reaches, from the permission matrix (e.g. GitHub, AWS);
   * null for the sandbox, TrueForge's own tools and unclassified tools.
   */
  system: string | null;
}

export interface ProvenanceView {
  toolCallId: string;
  /**
   * verified: TrueForge's record of that call agrees with the claim.
   * mismatch: it contradicts the claim. missing: no such call in this session.
   * pending: the call has not returned yet.
   */
  status: 'verified' | 'mismatch' | 'missing' | 'pending';
  recordedExitCode: number | null;
  note: string | null;
}

/**
 * What a claim rests on, derived from the tool call it cites (never from the claim):
 * SANDBOX_DERIVED cites a sandbox command, TOOL_DERIVED cites a connector or TrueForge
 * tool call, MODEL_HYPOTHESIS is the agent's reasoning, and UNVERIFIED cites nothing
 * TrueForge recorded.
 */
export type EvidenceBasis = 'SANDBOX_DERIVED' | 'TOOL_DERIVED' | 'MODEL_HYPOTHESIS' | 'UNVERIFIED';

export interface EvidenceItemView {
  key: string;
  label: string;
  claim: 'passed' | 'failed' | 'not_run' | 'hypothesis';
  detail: string | null;
  provenance: ProvenanceView | null;
  basis: EvidenceBasis;
}

/**
 * Status of one piece of evidence the runbook requires before the authorization line.
 * satisfied: claimed passed and TrueForge's record agrees. unverified: claimed passed
 * but nothing recorded confirms it. failed: failed, or contradicted by TrueForge.
 * missing: not reported, or not run.
 */
export type RequirementStatus = 'satisfied' | 'unverified' | 'failed' | 'missing';

/** Deterministic readiness of the evidence gate. No model is involved. */
export interface EvidenceGateView {
  /** Evidence the runbook's steps before the authorization line require, in step order. */
  required: { key: string; label: string; step: number; status: RequirementStatus }[];
  /** True only when every required item is satisfied. False when nothing is required. */
  ready: boolean;
}

export interface EvidenceView {
  reportedAt: string;
  toolCallId: string;
  problemSummary: string;
  hypothesis: { summary: string; supportingFacts: string[]; confidence: number | null };
  /** The candidate fix as the agent described it, and how many attempts it took. */
  remediation: { summary: string; attempts: number } | null;
  items: EvidenceItemView[];
  proposedAction: { tool: string; summary: string; actionClass: ActionClass };
  rollbackPlan: { summary: string; steps: string[] };
  unknowns: string[];
  blastRadius: BlastRadius | null;
}

export interface VerificationView {
  reportedAt: string;
  healthy: boolean;
  checks: EvidenceItemView[];
}

export type TrackStatus =
  'pending' | 'active' | 'done' | 'failed' | 'awaiting' | 'rejected' | 'skipped';

export interface TrackItemView {
  key: string;
  /** Step number from the runbook; null for observed stages. */
  index: number | null;
  title: string;
  detail: string | null;
  actionClass: DisplayClass | null;
  status: TrackStatus;
  gated: boolean;
  /** True when the step may not run without a human decision. */
  requiresApproval: boolean;
  /**
   * Tool calls TrueForge recorded for this step, oldest first: the call to the step's
   * tool, the calls cited by the evidence it requires, or the gated call it waits on.
   */
  toolCallIds: string[];
  /** Keys of the evidence items the runbook requires from this step. */
  evidenceKeys: string[];
}

export type LineState = 'not_reached' | 'at_danger' | 'cleared' | 'rejected' | 'violated';

export interface TrackView {
  mode: 'runbook' | 'observed';
  title: string;
  subtitle: string | null;
  items: TrackItemView[];
  /** Items before this position run without asking; the authorization line sits here. */
  lineIndex: number;
  lineState: LineState;
}

export type TimelineTone = 'neutral' | 'good' | 'bad' | 'caution' | 'gate';

/**
 * RunbookAI's own event vocabulary, mapped by the projection from TrueForge's event
 * log. These are not TrueForge API event names.
 */
export type TimelineKind =
  | 'run.started'
  | 'run.paused'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'agent.message'
  | 'connectors.initialized'
  | 'connectors.auth_required'
  | 'incident.received'
  | 'runbook.parsed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'sandbox.created'
  | 'sandbox.started'
  | 'sandbox.completed'
  | 'sandbox.failed'
  | 'evidence.added'
  | 'approval.required'
  | 'approval.approved'
  | 'approval.rejected'
  | 'action.completed'
  | 'action.not_run'
  | 'boundary.crossed'
  | 'verification.completed'
  | 'untrusted.flagged'
  | 'subagent.started'
  | 'subagent.completed'
  | 'client.waiting';

export interface TimelineEntryView {
  id: string;
  at: string;
  kind: TimelineKind;
  label: string;
  title: string;
  detail: string | null;
  tone: TimelineTone;
  toolCallId: string | null;
  threadId: string | null;
}

export interface ViolationView {
  /**
   * violation: a gated or forbidden action ran without an approval decision.
   * gap: a tool outside the permission matrix ran; its risk is unknown.
   */
  severity: 'violation' | 'gap';
  toolCallId: string;
  at: string;
  message: string;
}

export interface GatedActionView {
  call: ToolCallView;
  blastRadius: BlastRadius;
  /** runbookai: reported in the evidence package; policy: computed from the permission matrix. */
  blastRadiusSource: 'runbookai' | 'policy';
}

export type TurnStatus = 'running' | 'paused' | 'done' | 'error' | 'cancelled' | 'none';

export interface RunView {
  source: SourceInfo;
  session: {
    id: string;
    title: string | null;
    createdAt: string;
    updatedAt: string;
    /** Deep link to this session in the TrueForge UI; null when there is no real session. */
    uiUrl: string | null;
    turns: number;
    costUsd: number | null;
  };
  incident: {
    id: string | null;
    title: string;
    service: string | null;
    severity: string | null;
    summary: string | null;
    /** When the incident was opened, as RunbookAI reported it. */
    openedAt: string | null;
    fromRunbookAi: boolean;
  };
  turn: { status: TurnStatus; message: string | null; at: string | null };
  phase: Phase;
  /** Set when phase is 'paused'. */
  pause: PauseView | null;
  gatedAction: GatedActionView | null;
  /** Every call TrueForge is holding for a decision, oldest first; the first is gatedAction. */
  pendingActions: GatedActionView[];
  evidence: EvidenceView | null;
  /** Readiness of the evidence the runbook requires; computed from the runbook, not a model. */
  gate: EvidenceGateView;
  verification: VerificationView | null;
  track: TrackView;
  /** MCP connectors TrueForge reported for this session, in the order it reported them. */
  connectors: { name: string; state: 'initialized' | 'auth_required' }[];
  toolCalls: ToolCallView[];
  sandbox: { sandboxId: string | null; createdAt: string | null; execCallIds: string[] };
  timeline: TimelineEntryView[];
  violations: ViolationView[];
  counts: {
    events: number;
    toolCalls: number;
    automatic: number;
    gatedExecuted: number;
    untrustedFlags: number;
  };
  startedAt: string | null;
  lastEventAt: string | null;
  generatedAt: string;
}

export interface SessionSummaryView {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  turns: number;
}

export interface DashboardConfigView {
  source: SourceInfo;
  trueforgeUiUrl: string | null;
  /** True when approve/reject may be sent to TrueForge from this dashboard. */
  decisionsEnabled: boolean;
  /** True when new runs may be started in TrueForge from this dashboard. */
  startRunsEnabled: boolean;
  /** The TrueForge agent new runs are started with. */
  agentName: string | null;
  /** Operator-set label for the environment (DASHBOARD_ENVIRONMENT), e.g. "Controlled demo". */
  environment: string | null;
}

/** Payloads sent on /api/sessions/:id/stream. */
export type StreamMessage = { type: 'view'; view: RunView } | { type: 'error'; message: string };

/** POST /api/sessions/:id/decisions: forwarded to TrueForge as a `user.tool_approval`. */
export interface DecisionRequest {
  toolCallId: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface DecisionResponse {
  /** The TrueForge turn that carries the decision. */
  turnId: string;
}

export interface RunbookSummaryView {
  /** File name in the runbooks directory, e.g. checkout-incident.md. */
  id: string;
  title: string;
  steps: string[];
}

/** POST /api/runs: creates a TrueForge session with the configured agent and starts it. */
export interface StartRunRequest {
  runbookId: string;
  incidentId: string;
  description: string;
}

export interface StartRunResponse {
  sessionId: string;
}

export type PreflightStatus = 'ok' | 'warn' | 'fail';

export interface PreflightCheckView {
  key: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

/** Checks TrueForge's own agent configuration before a run is started. */
export interface PreflightView {
  agentName: string;
  agentFound: boolean;
  model: string | null;
  checks: PreflightCheckView[];
  /** Every tool RunbookAI's policy gates, and whether TrueForge will pause before it. */
  gates: {
    connector: string;
    tool: string;
    /** `disabled`: the connector does not expose the tool, so it cannot run at all. */
    coverage: 'explicit' | 'all' | 'annotation' | 'missing' | 'disabled';
  }[];
  /** False when a check failed; the dashboard will not start a run then. */
  canStart: boolean;
}
