/**
 * How a TrueForge connector's `requireApprovalForTools` covers one tool:
 *   explicit    the tool is named, so TrueForge always pauses before it
 *   all         `@all`, so TrueForge pauses before every tool on the connector
 *   annotation  only `@write` / `@destructive`, so it depends on the tool's MCP
 *               annotations, which RunbookAI cannot see from here
 *   missing     TrueForge will not pause before this tool
 */
export type ApprovalCoverage = 'explicit' | 'all' | 'annotation' | 'missing';

/** TrueForge's default when a connector sets no `requireApprovalForTools`. */
export const TRUEFORGE_DEFAULT_APPROVAL_SELECTORS: readonly string[] = ['@destructive'];

export function approvalCoverage(
  tool: string,
  selectors: readonly string[] | undefined,
): ApprovalCoverage {
  const list = selectors ?? TRUEFORGE_DEFAULT_APPROVAL_SELECTORS;
  if (list.includes(tool)) return 'explicit';
  if (list.includes('@all')) return 'all';
  if (list.includes('@write') || list.includes('@destructive')) return 'annotation';
  return 'missing';
}
