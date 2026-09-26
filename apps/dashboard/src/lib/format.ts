import type { PolicyDecision } from '@runbook-ai/core';
import type { DisplayClass, ToolRefView, TrackStatus } from '../../shared/view';

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function clock(iso: string | null | undefined): string {
  if (!iso) return '--:--:--';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '--:--:--' : clockFormat.format(date);
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

export function since(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return clock(iso);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const CLASS_LABELS: Record<DisplayClass, string> = {
  READ_ONLY: 'Read-only',
  SANDBOX_ONLY: 'Sandbox',
  REVERSIBLE_EXTERNAL: 'Reversible',
  CONSEQUENTIAL: 'Consequential',
  FORBIDDEN: 'Forbidden',
  UNCLASSIFIED: 'Unclassified',
};

export const DECISION_LABELS: Record<PolicyDecision, string> = {
  auto: 'runs automatically',
  auto_in_sandbox: 'runs automatically, inside the sandbox',
  require_approval: 'needs approval in TrueForge',
  deny: 'never runs',
};

export const STEP_STATUS_LABELS: Record<TrackStatus, string> = {
  pending: 'Pending',
  active: 'Running',
  done: 'Succeeded',
  failed: 'Failed',
  awaiting: 'Awaiting approval',
  rejected: 'Rejected',
  skipped: 'Skipped',
};

export function toolName(ref: ToolRefView): string {
  if (ref.kind === 'system')
    return ref.tool === 'exec' ? 'sandbox · exec' : `TrueForge · ${ref.tool}`;
  return `${ref.server} · ${ref.tool}`;
}

export function shortId(id: string, keep = 12): string {
  return id.length > keep ? `${id.slice(0, keep)}…` : id;
}

export function firstLine(text: string): { line: string; more: boolean } {
  const [line = '', ...rest] = text.split('\n');
  return { line, more: rest.some((part) => part.trim() !== '') };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
