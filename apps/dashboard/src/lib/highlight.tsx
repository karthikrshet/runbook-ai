import { createContext, useContext } from 'react';

export interface Highlight {
  /** Tool call currently traced across the page, if any. */
  toolCallId: string | null;
  trace: (toolCallId: string) => void;
}

export const HighlightContext = createContext<Highlight>({
  toolCallId: null,
  trace: () => undefined,
});

export function useHighlight(): Highlight {
  return useContext(HighlightContext);
}
