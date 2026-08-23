import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { modelSdkAdapter } from '../src/adapters/model-sdk.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

export const disposeChatWorkspaces = (): void => {
  for (const workspace of workspaces) workspace.dispose();
};

export const chatWorkspace = () => {
  const workspace = createTempWorkspace('orchescope-langchain-openai-chat-');
  workspaces.push(workspace);
  writePythonProject(workspace, {
    name: 'chat-app',
    dependencies: ['langchain-openai>=1.0.0'],
  });
  return workspace;
};

export const scanChatWorkspace = async (workspace: ReturnType<typeof chatWorkspace>) => {
  const clock = fixedClock(0);
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'chat-app',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 100,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
      adapters: [modelSdkAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

export type ChatScan = Awaited<ReturnType<typeof scanChatWorkspace>>;

export const chatComponentIds = (result: ChatScan): readonly string[] =>
  result.graph.components.map((component) => component.id);

export const chatRefusalReasons = (result: ChatScan): readonly string[] =>
  result.graph.coverage.topology?.unresolved.map((entry) => entry.reason) ?? [];
