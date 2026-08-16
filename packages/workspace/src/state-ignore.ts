import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The ignore file that keeps analysis state out of a repository's history.
 *
 * It used to be written by `orchescope init` alone, and the quickstart tells a reader to run `audit`
 * first. Across a sweep of thirty three git repositories that left thirty of them showing an untracked
 * `.orchescope/`, ninety seven megabytes in total; the only two that were clean had hand written rules
 * already. So it is written on the first state write of any command rather than by the one command a
 * reader may never run.
 *
 * The rule is a deny list with two exceptions rather than a list of the directories that exist today.
 * A directory this build has not thought of yet is covered the moment it is written, which the previous
 * form, naming `state/` and `cache/`, was not.
 *
 * The file excludes itself deliberately. It is rewritten whenever a workspace is opened, so it never has
 * to be committed to be in force, and leaving it visible would put an untracked file in front of every
 * reader whose only crime was running an audit. Configuration and a manifest are the two things meant to
 * be committed, so they are the two exceptions.
 */
export const STATE_GITIGNORE = `# Orchescope writes analysis state here and rewrites this file whenever it runs, so committing it is
# unnecessary. Configuration and a manifest are meant to be committed, and are excluded from the rule.
*
!config.json
!manifest.yaml
!manifest.yml
`;

/**
 * Written with owner only permissions, like everything else under the state directory, and rewritten on
 * every open so that a file edited by hand cannot leave state exposed.
 */
export const writeStateIgnore = (orchescopeDirectory: string): void => {
  writeFileSync(join(orchescopeDirectory, '.gitignore'), STATE_GITIGNORE, { mode: 0o600 });
};
