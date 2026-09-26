import type { ActionClass } from '../domain/action.js';

/**
 * Typed facts about one tool. The action class and the blast radius are derived
 * from these facts, never from a model's opinion.
 */
export interface ToolPolicy {
  actionClass: ActionClass;
  /** External system the tool reaches; null for sandbox or harness-internal tools. */
  system: string | null;
  resourcesAffected: number;
  customerFacing: boolean;
  mutatesData: boolean;
  destructive: boolean;
  reversible: boolean;
  rollbackAvailable: boolean;
  unknownDependencies: number;
  summary: string;
}

/** A tool as TrueForge reports it on a tool call (`toolInfo`). */
export interface ToolRef {
  kind: 'mcp' | 'system';
  /** Configured MCP connector name; empty for TrueForge system tools. */
  server: string;
  tool: string;
}

/** Connector names as configured in TrueForge (Settings -> Connectors). */
export interface ConnectorNames {
  runbookai: string;
  github: string;
}

/** TrueForge's sandbox command tool (`SANDBOX_EXEC_TOOL_NAME` in trueforge-core). */
export const SANDBOX_EXEC_TOOL = 'exec';

function readOnly(system: string, summary: string): ToolPolicy {
  return {
    actionClass: 'READ_ONLY',
    system,
    resourcesAffected: 0,
    customerFacing: false,
    mutatesData: false,
    destructive: false,
    reversible: true,
    rollbackAvailable: true,
    unknownDependencies: 0,
    summary,
  };
}

function externalChange(
  actionClass: 'REVERSIBLE_EXTERNAL' | 'CONSEQUENTIAL',
  system: string,
  facts: Partial<Omit<ToolPolicy, 'actionClass' | 'system' | 'summary'>> & { summary: string },
): ToolPolicy {
  return {
    actionClass,
    system,
    resourcesAffected: 1,
    customerFacing: false,
    mutatesData: false,
    destructive: false,
    reversible: true,
    rollbackAvailable: true,
    unknownDependencies: 0,
    ...facts,
  };
}

const OPEN_PULL_REQUEST = externalChange('CONSEQUENTIAL', 'GitHub', {
  summary: 'Opens a pull request on the demo repository. Closing it undoes the change.',
});

/** Tools served by the RunbookAI MCP server. */
const RUNBOOKAI_TOOLS: Readonly<Record<string, ToolPolicy>> = {
  incident_get: readOnly('RunbookAI', 'Reads incident metadata.'),
  runbook_plan: readOnly('RunbookAI', 'Compiles the runbook into typed steps.'),
  evidence_build_package: readOnly(
    'RunbookAI',
    'Builds the evidence package from recorded results.',
  ),
  incident_verify_recovery: readOnly('RunbookAI', 'Checks recovery after an approved action.'),
  github_get_recent_commits: readOnly('GitHub', 'Lists recent commits on the demo repository.'),
  github_read_file: readOnly('GitHub', 'Reads one file from the demo repository.'),
  github_prepare_pull_request: readOnly(
    'GitHub',
    'Builds a pull request payload without sending it.',
  ),
  aws_get_health: readOnly('AWS', 'Reads health of the demo service.'),
  aws_get_logs: readOnly('AWS', 'Reads recent CloudWatch log events for the demo service.'),
  aws_get_deployment: readOnly('AWS', 'Describes the current and previous deployment.'),
  aws_get_metric_summary: readOnly('AWS', 'Summarises CloudWatch metrics for the demo service.'),
  github_create_pull_request: OPEN_PULL_REQUEST,
  aws_execute_demo_rollback: externalChange('CONSEQUENTIAL', 'AWS', {
    customerFacing: true,
    summary: 'Rolls the demo service back to its previous deployment. Redeploying restores it.',
  }),
};

/** A curated subset of the official GitHub MCP server's tools. */
const GITHUB_MCP_TOOLS: Readonly<Record<string, ToolPolicy>> = {
  get_file_contents: readOnly('GitHub', 'Reads a file or directory.'),
  list_commits: readOnly('GitHub', 'Lists commits on a branch.'),
  get_commit: readOnly('GitHub', 'Reads one commit and its diff.'),
  search_code: readOnly('GitHub', 'Searches code.'),
  list_branches: readOnly('GitHub', 'Lists branches.'),
  list_pull_requests: readOnly('GitHub', 'Lists pull requests.'),
  get_pull_request: readOnly('GitHub', 'Reads one pull request.'),
  list_issues: readOnly('GitHub', 'Lists issues.'),
  get_issue: readOnly('GitHub', 'Reads one issue.'),
  create_branch: externalChange('REVERSIBLE_EXTERNAL', 'GitHub', {
    summary: 'Creates a branch. Deleting it undoes the change.',
  }),
  create_pull_request: OPEN_PULL_REQUEST,
  create_or_update_file: externalChange('CONSEQUENTIAL', 'GitHub', {
    mutatesData: true,
    summary: 'Commits a file change. A revert commit undoes it.',
  }),
  push_files: externalChange('CONSEQUENTIAL', 'GitHub', {
    mutatesData: true,
    summary: 'Commits several files. A revert commit undoes it.',
  }),
  merge_pull_request: externalChange('CONSEQUENTIAL', 'GitHub', {
    mutatesData: true,
    customerFacing: true,
    unknownDependencies: 1,
    summary: 'Merges a pull request; downstream CI/CD may deploy it.',
  }),
  delete_file: externalChange('CONSEQUENTIAL', 'GitHub', {
    mutatesData: true,
    destructive: true,
    summary: 'Deletes a file from the repository.',
  }),
};

/**
 * Tool names that are never allowed, whichever connector serves them:
 * arbitrary command execution against external systems, identity and
 * audit-trail tampering, and bulk deletion.
 */
const FORBIDDEN_TOOL_PATTERNS: readonly RegExp[] = [
  /(^|_)(shell|bash|exec_command|run_command|execute_command|aws_cli|execute_aws_command)$/,
  /(^|_)delete_(repository|repo|iam|user|role|policy|bucket|stack)/,
  /(^|_)(disable|stop|delete)_(audit|cloudtrail|logging|trail)/,
  /(^|_)(put|attach)_.*(admin|administrator)/,
];

const FORBIDDEN: ToolPolicy = {
  actionClass: 'FORBIDDEN',
  system: null,
  resourcesAffected: 0,
  customerFacing: true,
  mutatesData: true,
  destructive: true,
  reversible: false,
  rollbackAvailable: false,
  unknownDependencies: 0,
  summary: 'Matches a forbidden operation. RunbookAI never runs it.',
};

const SANDBOX_EXEC: ToolPolicy = {
  actionClass: 'SANDBOX_ONLY',
  system: null,
  resourcesAffected: 0,
  customerFacing: false,
  mutatesData: false,
  destructive: false,
  reversible: true,
  rollbackAvailable: true,
  unknownDependencies: 0,
  summary: 'Runs a command inside the TrueForge sandbox.',
};

const HARNESS_INTERNAL: ToolPolicy = {
  ...readOnly('TrueForge', 'TrueForge harness tool; changes nothing outside the session.'),
  system: null,
};

function toolTable(role: keyof ConnectorNames): Readonly<Record<string, ToolPolicy>> {
  return role === 'runbookai' ? RUNBOOKAI_TOOLS : GITHUB_MCP_TOOLS;
}

/**
 * Names of the tools on a connector that the matrix classifies. For GitHub that is a
 * curated subset: the GitHub MCP server serves more tools than these.
 */
export function matrixToolNames(role: keyof ConnectorNames): string[] {
  return Object.keys(toolTable(role));
}

/** Names of the tools on a connector that RunbookAI's policy never runs without approval. */
export function gatedToolNames(role: keyof ConnectorNames): string[] {
  return Object.entries(toolTable(role))
    .filter(
      ([, policy]) => policy.actionClass !== 'READ_ONLY' && policy.actionClass !== 'SANDBOX_ONLY',
    )
    .map(([name]) => name);
}

/**
 * Looks up the typed policy for a tool. Returns null when the tool is not in the
 * matrix; callers must treat that as "requires approval" and an unknown scope.
 */
export function lookupToolPolicy(ref: ToolRef, connectors: ConnectorNames): ToolPolicy | null {
  if (ref.kind === 'system') {
    return ref.tool === SANDBOX_EXEC_TOOL ? SANDBOX_EXEC : HARNESS_INTERNAL;
  }
  const known =
    ref.server === connectors.runbookai
      ? RUNBOOKAI_TOOLS[ref.tool]
      : ref.server === connectors.github
        ? GITHUB_MCP_TOOLS[ref.tool]
        : undefined;
  if (known) return known;
  if (FORBIDDEN_TOOL_PATTERNS.some((pattern) => pattern.test(ref.tool))) return FORBIDDEN;
  return null;
}
