import type { DisplayClass } from '../../shared/view';
import { CLASS_LABELS } from '../lib/format';

const MODIFIER: Partial<Record<DisplayClass, string>> = {
  FORBIDDEN: 'chip--forbidden',
  UNCLASSIFIED: 'chip--unclassified',
};

/** The action class from RunbookAI's permission matrix. */
export function ClassChip({ value, className = '' }: { value: DisplayClass; className?: string }) {
  return (
    <span
      className={`chip ${MODIFIER[value] ?? ''} ${className}`}
      title="Action class from the permission matrix"
    >
      {CLASS_LABELS[value]}
    </span>
  );
}
