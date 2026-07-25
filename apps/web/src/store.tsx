/**
 * Application state and the context every section reads from.
 *
 * The state is small on purpose: the bundle is immutable, so the only things that change are where the
 * reader is, what they have selected, what is in flight and what has just been announced.
 */

import type { ReportBundle } from '@orchescope/schema';
import { type ComponentChildren, createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { CapabilityIndex } from './capabilities.ts';
import type { GraphIndex } from './graph-index.ts';
import { DEFAULT_SECTION, type Route, type SectionId } from './routes.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface AppState {
  readonly route: Route;
  readonly selected: string | null;
  readonly announcement: string;
  /** Requests in flight. */
  readonly pending: number;
  /** Requests finished since the last time nothing was in flight, so the bar has a denominator. */
  readonly completed: number;
  readonly theme: ThemeChoice;
  readonly helpOpen: boolean;
}

export const INITIAL_STATE: AppState = {
  route: { section: DEFAULT_SECTION, params: {} },
  selected: null,
  announcement: '',
  pending: 0,
  completed: 0,
  theme: 'system',
  helpOpen: false,
};

export type AppAction =
  | { readonly type: 'route'; readonly route: Route }
  | { readonly type: 'select'; readonly componentId: string | null }
  | { readonly type: 'announce'; readonly message: string }
  | { readonly type: 'pending'; readonly delta: number }
  | { readonly type: 'theme'; readonly theme: ThemeChoice }
  | { readonly type: 'help'; readonly open: boolean };

export function reduce(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'route': {
      const selected = action.route.params.component ?? state.selected;
      return { ...state, route: action.route, selected };
    }
    case 'select':
      return { ...state, selected: action.componentId };
    case 'announce':
      return { ...state, announcement: action.message };
    case 'pending': {
      const pending = Math.max(0, state.pending + action.delta);
      if (pending === 0) {
        return { ...state, pending, completed: 0 };
      }
      return {
        ...state,
        pending,
        completed: action.delta < 0 ? state.completed + 1 : state.completed,
      };
    }
    case 'theme':
      return { ...state, theme: action.theme };
    case 'help':
      return { ...state, helpOpen: action.open };
    default:
      return state;
  }
}

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
