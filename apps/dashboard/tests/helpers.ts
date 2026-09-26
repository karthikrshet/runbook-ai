import { envelope, type EvidencePackage } from '@runbook-ai/core';
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { approvalCutIndex, buildInc001Events } from '../fixtures/inc-001.js';
import { projectSession } from '../server/projection/project.js';
import type { SessionEventItem } from '../server/sources/types.js';
import type { RunView } from '../shared/view.js';

export type Item = SessionEventItem;

export function awaitingEvents(): Item[] {
  const all = buildInc001Events();
  return all.slice(0, approvalCutIndex(all));
}

export function project(events: readonly Item[]): RunView {
  return projectSession({
    source: { kind: 'fixture', label: 'test' },
    session: {
      id: 'test-session',
      title: 'Test session',
      createdAt: events[0]?.event.createdAt ?? '2026-09-26T10:42:00.000Z',
      updatedAt: events.at(-1)?.event.createdAt ?? '2026-09-26T10:42:00.000Z',
      turns: 1,
      costUsd: null,
    },
    sessionUiUrl: 'http://localhost:8790/sessions/test-session',
    events,
    connectors: { runbookai: 'runbookai', github: 'github' },
    now: new Date('2026-09-26T10:50:00.000Z'),
  });
}

let counter = 0;
const id = (): string => `t_evt_${String(++counter)}`;

export function toolCall(
  at: string,
  callId: string,
  toolInfo: TrueForgeApi.ToolInfo,
  args: Record<string, unknown>,
): Item {
  return {
    turnId: 'fx_turn_1',
    event: {
      type: 'model.message',
      id: id(),
      createdAt: at,
      threadId: 'main',
      toolCalls: [
        {
          id: callId,
          type: 'function',
          function: { name: toolInfo.name, arguments: JSON.stringify(args) },
          toolInfo,
        },
      ],
    },
  };
}

export function toolResponse(
  at: string,
  toolCallId: string,
  content: string,
  turnId = 'fx_turn_1',
): Item {
  return {
    turnId,
    event: {
      type: 'tool.response',
      id: id(),
      createdAt: at,
      threadId: 'main',
      toolCallId,
      content,
    },
  };
}

export function approvalDecision(
  at: string,
  toolCallId: string,
  approval: TrueForgeApi.ApprovalDecision,
): Item {
  return {
    turnId: 'fx_turn_2',
    event: {
      type: 'turn.created',
      id: id(),
      createdAt: at,
      turnId: 'fx_turn_2',
      previousTurnId: 'fx_turn_1',
      threadId: null,
      state: { status: 'running' },
      input: [{ type: 'user.tool_approval', threadId: 'main', toolCallId, approval }],
    },
  };
}

export const mcpTool = (server: string, name: string): TrueForgeApi.ToolInfo => ({
  type: 'mcp',
  name,
  serverId: `id_${server}`,
  serverName: server,
});

export const execTool: TrueForgeApi.ToolInfo = { type: 'truefoundry-system', name: 'exec' };

/** The evidence envelope from the fixture, with changes applied. */
export function evidenceEnvelope(change: (evidence: EvidencePackage) => EvidencePackage): string {
  const item = buildInc001Events().find(
    (candidate) =>
      candidate.event.type === 'tool.response' && candidate.event.toolCallId === 'fx_call_evidence',
  );
  if (item?.event.type !== 'tool.response') throw new Error('fixture has no evidence response');
  const parsed = JSON.parse(item.event.content) as { data: EvidencePackage };
  return envelope('evidence_package', change(parsed.data));
}

/** Replaces the content of one tool response in an event list. */
export function withResponse(events: readonly Item[], toolCallId: string, content: string): Item[] {
  return events.map((item) =>
    item.event.type === 'tool.response' && item.event.toolCallId === toolCallId
      ? { ...item, event: { ...item.event, content } }
      : item,
  );
}
