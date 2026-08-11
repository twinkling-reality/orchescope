/**
 * The application shell: loading, routing, global keys, and the eight sections.
 *
 * There is no theme. A tile owns its ground and the ground is fixed by the tile's role, so the black
 * tile is black and the white tiles are white wherever the report is opened. That is what makes the
 * composition survive a reader whose machine is dark, which is the case that broke every version
 * before it: a themed palette put the page, the lifted surface and the accent band inside 1.19:1 of
 * each other and they read as one grey rectangle. With no page ground left there is nothing for a
 * theme to act on, so the control that offered one is gone rather than left doing nothing.
 */

import type { ReportBundle } from '@orchescope/schema';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import { INITIAL_STATE, reduce } from './app-state.ts';
import { REPORT_ELEMENT_ID, REPORT_ENDPOINT } from './bundle.ts';
import { indexCapabilities } from './presentation/capabilities.ts';
import { loadReport } from './client.tsx';
import { auditCommand } from './presentation/commands.ts';
import { readGallery } from './presentation/gallery.ts';
import { buildGraphIndex } from './presentation/graph-index.ts';
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
import { type AppContextValue, AppProvider, type SelectOptions } from './store.tsx';
import { Eyebrow, RefusalPanel } from './ui/primitives.tsx';
import { Shell } from './ui/shell.tsx';

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
    }
  | { readonly status: 'failed'; readonly problems: readonly string[] };

function LoadingPage() {
  return (
    <div class="standalone">
      <Eyebrow>Orchescope</Eyebrow>
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
      <Eyebrow>Orchescope</Eyebrow>
      <h1>No report to show</h1>
      <RefusalPanel
        title={`This page reads one report bundle, and neither source produced one it could use.`}
        commands={[auditCommand()]}
      >
        <p>
          {`A bundle is either embedded in a script block with the identifier ${REPORT_ELEMENT_ID}, or served from ${REPORT_ENDPOINT}.`}
        </p>
        <ul class="plain">
          {props.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p>Generate a report and open it again:</p>
      </RefusalPanel>
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
            }
          : { status: 'failed', problems: result.load.problems },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useHashRoute(dispatch);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch({ type: 'chrome', panel: null });
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        dispatch({ type: 'chrome', panel: state.chromePanel === 'help' ? null : 'help' });
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
  }, [state.chromePanel]);

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
  // Read once: the list is written into the document by the generator and never changes after load.
  const gallery = useMemo(() => readGallery(document), []);

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
      <Shell repaired={phase.repaired} gallery={gallery}>
        <h2 class="visually-hidden">{sectionLabel(state.route.section)}</h2>
        <Section />
      </Shell>
    </AppProvider>
  );
}
