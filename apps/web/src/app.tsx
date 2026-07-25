/**
 * The application shell: loading, routing, theme, global keys, and the eight sections.
 */

import type { ReportBundle } from '@orchescope/schema';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import { REPORT_ELEMENT_ID, REPORT_ENDPOINT } from './bundle.ts';
import { indexCapabilities } from './capabilities.ts';
import { loadReport, type ReportSource } from './client.tsx';
import { auditCommand } from './commands.ts';
import { buildGraphIndex } from './graph-index.ts';
import {
  formatHash,
  parseHash,
  type Route,
  SECTIONS,
  type SectionId,
  sectionLabel,
} from './routes.ts';
import { ComparisonsSection } from './sections/comparisons.tsx';
import { FindingsSection } from './sections/findings.tsx';
import { GoalsSection } from './sections/goals.tsx';
import { MapSection } from './sections/map.tsx';
import { OverviewSection } from './sections/overview.tsx';
import { PerformanceSection } from './sections/performance.tsx';
import { ResilienceSection } from './sections/resilience.tsx';
import { ScenariosSection } from './sections/scenarios.tsx';
import {
  type AppContextValue,
  AppProvider,
  INITIAL_STATE,
  reduce,
  type SelectOptions,
  type ThemeChoice,
} from './store.tsx';
import { CommandBlock, EmptyState } from './ui/atoms.tsx';
import { Shell } from './ui/shell.tsx';

const THEME_STORAGE_KEY = 'orchescope.theme';

const SECTION_COMPONENTS: Readonly<Record<SectionId, () => JSX.Element>> = {
  overview: OverviewSection,
  map: MapSection,
  findings: FindingsSection,
  performance: PerformanceSection,
  resilience: ResilienceSection,
  scenarios: ScenariosSection,
  comparisons: ComparisonsSection,
  goals: GoalsSection,
};

type LoadPhase =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly bundle: ReportBundle;
      readonly repaired: readonly string[];
      readonly source: ReportSource;
    }
  | { readonly status: 'failed'; readonly problems: readonly string[] };

function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    return 'system';
  }
  return 'system';
}

function storeTheme(theme: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* A report opened from a file may have no writable storage. The choice still applies for this visit. */
  }
}

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') {
    return choice;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function LoadingPage() {
  return (
    <div class="standalone">
      <p class="product">Orchescope</p>
      <h1>Loading the report</h1>
      <p class="muted" role="status">
        {`Reading the report from the document, or from ${REPORT_ENDPOINT} when the document carries none.`}
      </p>
    </div>
  );
}

function FailurePage(props: { readonly problems: readonly string[] }) {
  return (
    <div class="standalone">
      <p class="product">Orchescope</p>
      <EmptyState
        title="No report to show"
        body={`This page reads one report bundle, either embedded in a script block with the identifier ${REPORT_ELEMENT_ID} or served from ${REPORT_ENDPOINT}. Neither produced a bundle it could use.`}
      >
        <ul class="plain problems">
          {props.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p>Generate a report and open it again:</p>
        <CommandBlock argv={auditCommand()} />
      </EmptyState>
    </div>
  );
}

function useHashRoute(
  dispatch: (action: { readonly type: 'route'; readonly route: Route }) => void,
) {
  useEffect(() => {
    const apply = () => {
      dispatch({ type: 'route', route: parseHash(window.location.hash) });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => {
      window.removeEventListener('hashchange', apply);
    };
  }, [dispatch]);
}

/** Alt with a digit jumps to the numbered section in the navigation. */
function sectionForShortcut(event: KeyboardEvent): SectionId | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  const position = Number.parseInt(event.key, 10);
  return SECTIONS[position - 1]?.id ?? null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function App() {
  const [phase, setPhase] = useState<LoadPhase>({ status: 'loading' });
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    void loadReport().then((result) => {
      if (cancelled) {
        return;
      }
      setPhase(
        result.load.ok
          ? {
              status: 'ready',
              bundle: result.load.bundle,
              repaired: result.load.repaired,
              source: result.source,
            }
          : { status: 'failed', problems: result.load.problems },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    dispatch({ type: 'theme', theme: readStoredTheme() });
  }, []);

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolveTheme(state.theme);
    storeTheme(state.theme);
  }, [state.theme]);

  useHashRoute(dispatch);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch({ type: 'help', open: false });
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        dispatch({ type: 'help', open: true });
        return;
      }
      const target = sectionForShortcut(event);
      if (target === null) {
        return;
      }
      event.preventDefault();
      window.location.hash = formatHash(target);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (phase.status === 'ready') {
      document.title = `${phase.bundle.projectName}: Orchescope report`;
    }
  }, [phase]);

  const announce = useCallback((message: string) => {
    dispatch({ type: 'announce', message });
  }, []);

  const navigate = useCallback((section: SectionId, params?: Readonly<Record<string, string>>) => {
    window.location.hash = formatHash(section, params ?? {});
  }, []);

  const selectComponent = useCallback(
    (componentId: string | null, options?: SelectOptions) => {
      dispatch({ type: 'select', componentId });
      if (componentId !== null && options?.goToMap === true) {
        navigate('map', { component: componentId });
      }
      announce(componentId === null ? 'Selection cleared.' : `Selected ${componentId}.`);
    },
    [announce, navigate],
  );

  const runTask = useCallback(async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
    dispatch({ type: 'pending', delta: 1 });
    dispatch({ type: 'announce', message: `${label} started.` });
    try {
      return await task();
    } finally {
      dispatch({ type: 'pending', delta: -1 });
    }
  }, []);

  const bundle = phase.status === 'ready' ? phase.bundle : null;
  const index = useMemo(() => (bundle === null ? null : buildGraphIndex(bundle)), [bundle]);
  const capabilities = useMemo(() => indexCapabilities(bundle?.capabilities ?? []), [bundle]);

  if (phase.status === 'loading') {
    return <LoadingPage />;
  }
  if (phase.status === 'failed') {
    return <FailurePage problems={phase.problems} />;
  }
  if (bundle === null || index === null) {
    return <FailurePage problems={['The report bundle could not be indexed.']} />;
  }

  const value: AppContextValue = {
    bundle,
    index,
    capabilities,
    state,
    dispatch,
    navigate,
    selectComponent,
    announce,
    runTask,
  };

  const Section = SECTION_COMPONENTS[state.route.section];

  return (
    <AppProvider value={value}>
      <Shell repaired={phase.repaired} source={phase.source}>
        <h2 class="visually-hidden">{sectionLabel(state.route.section)}</h2>
        <Section />
      </Shell>
    </AppProvider>
  );
}
