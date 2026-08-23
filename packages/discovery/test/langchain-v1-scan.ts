import { createDeadline, fixedClock } from '@orchescope/domain';
import type { ScanResult } from '../src/discover.ts';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

export const scanLangChainV1 = async (
  files: Readonly<Record<string, string>>,
): Promise<ScanResult> => {
  const workspace = createTempWorkspace('orchescope-langchain-v1-');
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(120_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'langchain-v1-fixture',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal,
      concurrency: 2,
    });
  } finally {
    deadline.dispose();
    workspace.dispose();
  }
};

export const adapterRun = (result: ScanResult) =>
  result.graph.coverage.adapters.find(
    (run) => run.adapterId === 'adapter:langchain-v1-create-agent',
  );
