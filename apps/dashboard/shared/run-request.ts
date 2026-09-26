import type { StartRunRequest } from './view.js';

/** Incident ids such as INC-001 or SEV-2041. */
export const INCIDENT_ID_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
export const RUNBOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;

/**
 * The exact message a new run sends to the agent. The start screen previews this
 * text, and the server builds it the same way, so what you read is what is sent.
 */
export function buildRunPrompt(request: StartRunRequest): string {
  const description = request.description.trim().replace(/\s+/g, ' ');
  const sentence = /[.!?]$/.test(description) ? description : `${description}.`;
  return (
    `Execute runbook ${request.runbookId} for ${request.incidentId}. ${sentence} ` +
    'Resolve whatever you safely can. Never make a consequential external change without my approval.'
  );
}
