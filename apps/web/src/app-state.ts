import { DEFAULT_SECTION, type Route } from './routes.ts';

export type ChromePanel = 'report' | 'help' | 'gallery' | null;

export interface AppState {
  readonly route: Route;
  readonly selected: string | null;
  readonly announcement: string;
  readonly pending: number;
  readonly completed: number;
  readonly chromePanel: ChromePanel;
}

export const INITIAL_STATE: AppState = {
  route: { section: DEFAULT_SECTION, params: {} },
  selected: null,
  announcement: '',
  pending: 0,
  completed: 0,
  chromePanel: null,
};

export type AppAction =
  | { readonly type: 'route'; readonly route: Route }
  | { readonly type: 'select'; readonly componentId: string | null }
  | { readonly type: 'announce'; readonly message: string }
  | { readonly type: 'pending'; readonly delta: number }
  | { readonly type: 'chrome'; readonly panel: ChromePanel };

export function reduce(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'route': {
      const selected = action.route.params['component'] ?? state.selected;
      return { ...state, route: action.route, selected };
    }
    case 'select':
      return { ...state, selected: action.componentId };
    case 'announce':
      return { ...state, announcement: action.message };
    case 'pending': {
      const pending = Math.max(0, state.pending + action.delta);
      if (pending === 0) return { ...state, pending, completed: 0 };
      return {
        ...state,
        pending,
        completed: action.delta < 0 ? state.completed + 1 : state.completed,
      };
    }
    case 'chrome':
      return { ...state, chromePanel: action.panel };
    default:
      return state;
  }
}
