/**
 * Application state and the context every section reads from.
 *
 * The state is small on purpose: the bundle is immutable, so the only things that change are where the
 * reader is, what they have selected, what is in flight and what has just been announced.
 */

import type { ReportBundle } from '@orchescope/schema';
import { type ComponentChildren, createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { AppAction, AppState } from './app-state.ts';
import type { CapabilityIndex } from './presentation/capabilities.ts';
import type { GraphIndex } from './presentation/graph-index.ts';
import type { SectionId } from './routes.ts';

export interface SelectOptions {
  /** Move the reader to the map as well as changing the selection. */
  readonly goToMap?: boolean;
}

export interface AppContextValue {
  readonly bundle: ReportBundle;
  readonly index: GraphIndex;
  readonly capabilities: CapabilityIndex;
  readonly state: AppState;
  readonly dispatch: (action: AppAction) => void;
  readonly navigate: (section: SectionId, params?: Readonly<Record<string, string>>) => void;
  readonly selectComponent: (componentId: string | null, options?: SelectOptions) => void;
  readonly announce: (message: string) => void;
  /** Wraps a request so the progress bar and the live region both reflect it. */
  readonly runTask: <T>(label: string, task: () => Promise<T>) => Promise<T>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider(props: {
  readonly value: AppContextValue;
  readonly children: ComponentChildren;
}) {
  return <AppContext.Provider value={props.value}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) {
    throw new Error('useApp was called outside the report provider.');
  }
  return value;
}
