import { redactText } from '@runbook-ai/core';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** Text of an error payload, which may be a string or MCP content parts. */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) {
    return error
      .map((part: unknown) =>
        isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return error === undefined ? '' : JSON.stringify(error);
}

const DENIAL_PREFIX = 'User denied tool call';

export interface ResponseOutcome {
  kind: 'ok' | 'error' | 'denied';
  /** Denial reason or error message, when there is one. */
  message: string | null;
}

/**
 * TrueForge stores failed tool calls as {"error": ...} and denied ones as
 * {"error": "User denied tool call: <reason>"} (see trueforge-core executeToolCalls).
 */
export function classifyResponse(content: string): ResponseOutcome {
  const json = tryParseJson(content);
  if (isRecord(json) && Object.keys(json).length === 1 && 'error' in json) {
    const message = errorText(json['error']);
    const denial = extractDenial(message);
    if (denial !== null) return { kind: 'denied', message: denial || null };
    return { kind: 'error', message: redactText(message).slice(0, 500) };
  }
  return { kind: 'ok', message: null };
}

function extractDenial(message: string): string | null {
  const index = message.indexOf(DENIAL_PREFIX);
  if (index === -1) return null;
  const rest = message.slice(index + DENIAL_PREFIX.length).replace(/^:\s*/, '');
  // Nested JSON wrapping can leave trailing quotes or braces.
  return redactText(rest.replace(/["}\]]+$/, '').trim()).slice(0, 300);
}

/**
 * The text inside a tool result. JSON results are reduced to their string values
 * so scans and excerpts see the words, not the escaping around them.
 */
export function readableText(content: string, maxChars = 200_000): string {
  const json = tryParseJson(content);
  if (json === undefined) return content;
  const parts: string[] = [];
  let size = 0;
  const visit = (value: unknown, depth: number): void => {
    if (size > maxChars || depth > 20) return;
    if (typeof value === 'string') {
      parts.push(value);
      size += value.length;
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(json, 0);
  return parts.join('\n');
}

/** Single-line, redacted preview of a tool result. */
export function previewText(content: string, maxChars = 220): string {
  const flat = redactText(content).replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

/** Plain text of a model or user message's content. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) =>
        isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
