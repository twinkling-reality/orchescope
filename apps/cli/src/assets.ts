import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrchescopeError } from '@orchescope/domain';

/**
 * Locating the browser workspace assets.
 *
 * Two layouts exist and both are checked explicitly rather than guessed: the published package, where the bundled
 * CLI and the built interface sit side by side under `dist`, and the repository, where the interface is built into
 * `apps/web/dist`. A missing interface is reported as an environment problem with the command that builds it,
 * because a report that cannot be rendered is not a defect in the analysis.
 */

const REQUIRED_FILES = ['index.html', 'app.js', 'app.css'] as const;

const candidates = (): readonly string[] => {
  const here = dirname(fileURLToPath(import.meta.url));
  const override = process.env['ORCHESCOPE_UI_DIR'];
  return [
    ...(override === undefined ? [] : [resolve(override)]),
    // Published layout: dist/orchescope.mjs next to dist/ui
    join(here, 'ui'),
    // Repository layout: apps/cli/src -> apps/web/dist
    resolve(here, '..', '..', 'web', 'dist'),
    resolve(here, '..', '..', '..', 'apps', 'web', 'dist'),
  ];
};

export const findAssetDirectory = (): string => {
  const tried: string[] = [];
  for (const directory of candidates()) {
    tried.push(directory);
    if (REQUIRED_FILES.every((file) => existsSync(join(directory, file)))) return directory;
  }
  throw new OrchescopeError(
    'UNSUPPORTED_PLATFORM',
    'The browser workspace assets are not present.',
    {
      detail: { searched: tried.join(', ') },
      remediation:
        'In a checkout run: pnpm build:web. In an installed package this indicates an incomplete install, so reinstall Orchescope.',
    },
  );
};
