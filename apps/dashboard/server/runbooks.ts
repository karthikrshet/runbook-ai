import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RUNBOOK_ID_PATTERN } from '../shared/run-request.js';
import type { RunbookSummaryView } from '../shared/view.js';

const MAX_BYTES = 64 * 1024;
const MAX_STEPS = 50;

/**
 * Lists the Markdown runbooks in `dir` for the start screen. This is a preview
 * only: RunbookAI's MCP server compiles the runbook when the agent runs it.
 */
export async function listRunbooks(dir: string): Promise<RunbookSummaryView[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const runbooks: RunbookSummaryView[] = [];
  for (const name of names.filter((n) => RUNBOOK_ID_PATTERN.test(n)).sort()) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_BYTES) continue;
    runbooks.push(parseRunbook(name, await readFile(path, 'utf8')));
  }
  return runbooks;
}

export function parseRunbook(id: string, markdown: string): RunbookSummaryView {
  const title = /^#\s+(.+?)\s*$/m.exec(markdown)?.[1] ?? id;
  const steps: string[] = [];
  for (const match of markdown.matchAll(/^\s*\d+\.\s+(.+?)\s*$/gm)) {
    if (match[1]) steps.push(match[1]);
    if (steps.length >= MAX_STEPS) break;
  }
  return { id, title, steps };
}
