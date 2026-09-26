import { createContext, useContext } from 'react';
import type { DashboardConfigView } from '../../shared/view';

/** Server configuration; null until /api/config has answered. */
export const ConfigContext = createContext<DashboardConfigView | null>(null);

export function useConfig(): DashboardConfigView | null {
  return useContext(ConfigContext);
}
