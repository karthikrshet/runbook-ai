import {
  approvalCoverage,
  gatedToolNames,
  matrixToolNames,
  TRUEFORGE_DEFAULT_APPROVAL_SELECTORS,
  type ConnectorNames,
} from '@runbook-ai/core';
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { PreflightCheckView, PreflightStatus, PreflightView } from '../shared/view.js';

type Gate = PreflightView['gates'][number];

/**
 * Checks a TrueForge agent's own configuration before a run starts: the sandbox
 * is on, the RunbookAI connector is attached, and TrueForge will pause before
 * every tool RunbookAI's policy gates. A failed check blocks the start.
 */
export function buildPreflight(
  agentName: string,
  agent: TrueForgeApi.Agent | null,
  connectors: ConnectorNames,
): PreflightView {
  if (!agent) {
    return {
      agentName,
      agentFound: false,
      model: null,
      checks: [
        {
          key: 'agent',
          label: `Agent "${agentName}" in TrueForge`,
          status: 'fail',
          detail: `TrueForge has no agent with this name. Create it under Agents with the ${connectors.runbookai} connector and a sandbox, or set TRUEFORGE_AGENT_NAME.`,
        },
      ],
      gates: [],
      canStart: false,
    };
  }

  const spec = agent.manifest;
  const servers = spec.mcpServers ?? [];
  const runbookai = servers.find((server) => server.name === connectors.runbookai);
  const github = servers.find((server) => server.name === connectors.github);
  const sandbox = spec.config?.sandbox?.enabled === true;

  const gates: Gate[] = [
    ...(runbookai ? gatesFor(runbookai, gatedToolNames('runbookai')) : []),
    ...(github ? gatesFor(github, gatedToolNames('github')) : []),
  ];
  const missing = gates.filter((gate) => gate.coverage === 'missing').map((gate) => gate.tool);
  const annotation = gates
    .filter((gate) => gate.coverage === 'annotation')
    .map((gate) => gate.tool);

  const checks: PreflightCheckView[] = [
    {
      key: 'agent',
      label: `Agent "${agentName}"`,
      status: 'ok',
      detail: `Found in TrueForge. Model: ${spec.model.name}.`,
    },
    {
      key: 'sandbox',
      label: 'Sandbox for generated code',
      status: sandbox ? 'ok' : 'fail',
      detail: sandbox
        ? 'On. Generated code runs in the TrueForge sandbox, never on this machine.'
        : 'Off. Turn on the sandbox for this agent; RunbookAI never runs generated code on the host.',
    },
    {
      key: 'connector',
      label: `${connectors.runbookai} connector`,
      status: runbookai ? 'ok' : 'fail',
      detail: runbookai
        ? 'Attached to the agent.'
        : `Not attached. Add the ${connectors.runbookai} MCP connector to the agent.`,
    },
    {
      key: 'approvals',
      label: 'TrueForge pauses before gated tools',
      status: missing.length > 0 ? 'fail' : annotation.length > 0 ? 'warn' : 'ok',
      detail:
        missing.length > 0
          ? `TrueForge would run ${missing.join(', ')} without asking. Add them to requireApprovalForTools on the connector.`
          : annotation.length > 0
            ? `${annotation.join(', ')} pause only if the connector marks them as write or destructive. Name them in requireApprovalForTools to be certain.`
            : gates.length > 0
              ? 'Every gated tool is named in requireApprovalForTools.'
              : 'No gated tools are enabled on the attached connectors.',
    },
  ];

  // The permission matrix classifies every RunbookAI tool, but only a curated subset of the
  // GitHub MCP server's, which serves more.
  if (github) checks.push(githubUnlisted(github));

  // A tool on any other connector is unclassified: the console reports each call as a policy
  // gap, and TrueForge pauses before it only if the connector requires approval for all tools.
  const others = servers.filter(
    (server) => server.name !== connectors.runbookai && server.name !== connectors.github,
  );
  if (others.length > 0) {
    const unguarded = others.filter((server) => !server.requireApprovalForTools?.includes('@all'));
    const names = (list: typeof others): string => list.map((server) => server.name).join(', ');
    checks.push({
      key: 'unclassified',
      label: 'Connectors outside the permission matrix',
      status: unguarded.length > 0 ? 'warn' : 'ok',
      detail:
        unguarded.length > 0
          ? `${names(unguarded)}: RunbookAI's policy does not classify these tools, and TrueForge would run them without asking. Set requireApprovalForTools to ["@all"] on the connector, or detach it.`
          : `${names(others)}: not classified by RunbookAI's policy, but TrueForge pauses before every tool.`,
    });
  }

  return {
    agentName,
    agentFound: true,
    model: spec.model.name,
    checks,
    gates,
    canStart: checks.every((check) => check.status !== 'fail'),
  };
}

/**
 * The GitHub MCP server's tools outside the matrix (create_issue, create_repository, ...)
 * run unclassified. They are covered when TrueForge pauses before them, or when the
 * connector names the tools it enables and lists none of them.
 */
function githubUnlisted(server: TrueForgeApi.McpServer): PreflightCheckView {
  const approvals = server.requireApprovalForTools ?? TRUEFORGE_DEFAULT_APPROVAL_SELECTORS;
  const enabled = server.enableTools ?? ['@all'];
  const known = new Set(matrixToolNames('github'));
  // Enabled by name, outside the matrix, and not paused by name.
  const unlisted = enabled.filter(
    (tool) =>
      !tool.startsWith('@') &&
      !known.has(tool) &&
      !approvals.includes(tool) &&
      !server.disableTools?.includes(tool),
  );
  const selectors = enabled.filter((tool) => tool.startsWith('@'));
  // `@all` (or any selector but `@read-only`) lets in tools nobody listed.
  const open = selectors.some((selector) => selector !== '@read-only');
  const check = (status: PreflightStatus, detail: string): PreflightCheckView => ({
    key: 'github-unlisted',
    label: 'GitHub tools outside the permission matrix',
    status,
    detail,
  });

  if (approvals.includes('@all')) {
    return check(
      'ok',
      `TrueForge pauses before every tool on ${server.name}, including ones RunbookAI's policy does not classify.`,
    );
  }
  if (!open && unlisted.length === 0) {
    return selectors.length === 0
      ? check('ok', `${server.name} exposes only tools RunbookAI's policy classifies.`)
      : check(
          'warn',
          `${server.name} exposes only tools the GitHub server marks read-only, so tools RunbookAI's policy does not classify stay hidden only if those marks are right. Name the enabled tools in enableTools to be certain.`,
        );
  }
  if (approvals.includes('@write')) {
    return check(
      'warn',
      `Tools on ${server.name} that RunbookAI's policy does not classify pause only if the GitHub server marks them as write tools. List only permission-matrix tools in enableTools to be certain.`,
    );
  }
  const them = unlisted.length === 1 ? 'it' : 'them';
  return check(
    'warn',
    open
      ? `${server.name} serves tools RunbookAI's policy does not classify, such as create_issue and create_repository, and TrueForge would run them without asking. List only permission-matrix tools in enableTools, or add "@write" to requireApprovalForTools.`
      : `${unlisted.join(', ')} on ${server.name}: not classified by RunbookAI's policy, and TrueForge would run ${them} without asking. Remove ${them} from enableTools, or name ${them} in requireApprovalForTools.`,
  );
}

function gatesFor(server: TrueForgeApi.McpServer, tools: readonly string[]): Gate[] {
  return tools.map((tool) => ({
    connector: server.name,
    tool,
    coverage: isDisabled(server, tool)
      ? 'disabled'
      : approvalCoverage(tool, server.requireApprovalForTools),
  }));
}

/**
 * Conservative: a tool counts as disabled only when the connector names it in
 * disableTools, or lists enabled tools by name without it. Selector-based lists
 * (`@all`, `@read-only`) depend on annotations, so the tool is assumed enabled.
 */
function isDisabled(server: TrueForgeApi.McpServer, tool: string): boolean {
  if (server.disableTools?.includes(tool)) return true;
  const enabled = server.enableTools;
  if (!enabled || enabled.some((selector) => selector.startsWith('@'))) return false;
  return !enabled.includes(tool);
}
