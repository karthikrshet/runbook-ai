import { z } from 'zod';

/**
 * Deterministic action classes. The policy engine decides from these typed
 * classes; it never asks a model whether an action is safe.
 */
export const ACTION_CLASSES = [
  'READ_ONLY',
  'SANDBOX_ONLY',
  'REVERSIBLE_EXTERNAL',
  'CONSEQUENTIAL',
  'FORBIDDEN',
] as const;

export const ActionClassSchema = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClassSchema>;

export type PolicyDecision = 'auto' | 'auto_in_sandbox' | 'require_approval' | 'deny';

const DECISION_BY_CLASS: Record<ActionClass, PolicyDecision> = {
  READ_ONLY: 'auto',
  SANDBOX_ONLY: 'auto_in_sandbox',
  // Could be automatic, but RunbookAI gates it so the boundary stays visible.
  REVERSIBLE_EXTERNAL: 'require_approval',
  CONSEQUENTIAL: 'require_approval',
  FORBIDDEN: 'deny',
};

/** `null` means the tool is not in the permission matrix; it is never automatic. */
export function decisionFor(actionClass: ActionClass | null): PolicyDecision {
  return actionClass === null ? 'require_approval' : DECISION_BY_CLASS[actionClass];
}

/** True when the action may not run without a human decision (or at all). */
export function isGated(actionClass: ActionClass | null): boolean {
  const decision = decisionFor(actionClass);
  return decision === 'require_approval' || decision === 'deny';
}

/** True for classes that change state outside the sandbox. */
export function changesExternalState(actionClass: ActionClass): boolean {
  return (
    actionClass === 'REVERSIBLE_EXTERNAL' ||
    actionClass === 'CONSEQUENTIAL' ||
    actionClass === 'FORBIDDEN'
  );
}
