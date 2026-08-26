import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPONENT_KINDS } from '../../packages/schema/src/component.ts';

/**
 * Every population keyed on a component kind, asked whether it still names kinds that exist.
 *
 * A component kind has no compile-time home. `COMPONENT_KINDS` is the published vocabulary and the eight
 * populations that decide what a kind means to a rule, a diagram or a headline were `Set<string>` and
 * `Record<string, ...>`, so each one drifted on its own. Two had already drifted when this was written:
 * `REACHABILITY_KINDS` carried `worker`, deleted from the vocabulary, and `MERMAID_SHAPE` carried `project`,
 * also deleted, while omitting `evaluator`, of which three pinned repositories declare eight.
 *
 * The fix is a type annotation on each population and it is what actually enforces this: `pnpm typecheck`
 * fails on a member that is not a kind, and fails on a missing key in the one population expressed as a
 * total record. This test exists because the annotation is the kind of thing a future edit removes without
 * noticing, and because a compiler error is not a transcript anybody keeps.
 *
 * The source is read rather than the values imported, for the reason
 * `tests/e2e/rule-input-producers.test.ts` gives about asking a file its own text: seven of the eight
 * populations are module-private, and exporting them so a test can see them would widen an API for a check.
 *
 * A membership set catches a deletion and cannot catch an addition, because a membership set is not
 * required to be exhaustive. `MERMAID_SHAPE` is total for exactly that reason and is the one population
 * that fails when a nineteenth kind arrives. That asymmetry is the honest limit of this check and it is
 * stated in [ADR 0015](../../docs/architecture/adr/0015-the-asymmetric-invariant.md).
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Population = {
  readonly name: string;
  readonly file: string;
  /** The literal region, opened by this text and closed by the first line holding only the closer. */
  readonly opens: string;
  readonly closes: string;
  /** True where every published kind must appear, not merely a subset. */
  readonly total: boolean;
};

const POPULATIONS: readonly Population[] = [
  {
    name: 'AGENT_SYSTEM_KINDS',
    file: 'packages/domain/src/audited-system.ts',
    opens: 'export const AGENT_SYSTEM_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([',
    closes: ']);',
    total: false,
  },
  {
    name: 'OBSERVABLE_KINDS',
    file: 'packages/graph/src/analysis.ts',
    opens: 'const OBSERVABLE_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([',
    closes: ']);',
    total: false,
  },
  {
    name: 'MODEL_DRIVEN_KINDS',
    file: 'packages/findings/src/rules/static-policy.ts',
    opens: 'const MODEL_DRIVEN_KINDS: readonly ComponentKind[] = [',
    closes: '];',
    total: false,
  },
  {
    name: 'REACHABILITY_KINDS',
    file: 'packages/findings/src/rules/static-policy.ts',
    opens: 'const REACHABILITY_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([',
    closes: ']);',
    total: false,
  },
  {
    name: 'EDGE_KIND_BY_TARGET',
    file: 'packages/traces/src/topology.ts',
    opens: 'const EDGE_KIND_BY_TARGET: Readonly<Partial<Record<ComponentKind, string>>> = {',
    closes: '};',
    total: false,
  },
  {
    name: 'HEADLINE_KINDS',
    file: 'apps/cli/src/terminal/source-headline.ts',
    opens: 'const HEADLINE_KINDS = [',
    closes: '] as const satisfies',
    total: false,
  },
  {
    name: 'MERMAID_SHAPE',
    file: 'packages/report/src/exports.ts',
    opens: 'const MERMAID_SHAPE: Readonly<Record<ComponentKind, [string, string]>> = {',
    closes: '};',
    total: true,
  },
];

/** The kinds a literal region names, read as the first quoted word or bare key on each of its lines. */
const kindsIn = (population: Population): readonly string[] => {
  const source = readFileSync(join(repositoryRoot, population.file), 'utf8');
  const start = source.indexOf(population.opens);
  assert.notEqual(
    start,
    -1,
    `${population.name} is not declared as ${population.opens} in ${population.file}, so its type annotation has been removed or renamed and nothing is checking it`,
  );
  const from = start + population.opens.length;
  const end = source.indexOf(population.closes, from);
  assert.notEqual(end, -1, `${population.name} has no closing ${population.closes}`);
  const body = source.slice(from, end);
  const published = new Set<string>(COMPONENT_KINDS);
  const found: string[] = [];
  for (const line of body.split('\n')) {
    /*
     * A bare key first, because a record writes the kind on the left and its value on the right, and the
     * value of `EDGE_KIND_BY_TARGET` is a relation kind that would otherwise be read as a component kind.
     * A set writes the kind quoted and has no key at all.
     */
    const bare = /^\s*([a-z_]+):/.exec(line);
    const quoted = /'([a-z_]+)'/.exec(line);
    const name = bare?.[1] ?? quoted?.[1];
    if (name !== undefined && (published.has(name) || /^[a-z_]+$/.test(name))) found.push(name);
  }
  return found;
};

describe('the populations keyed on a component kind', () => {
  const published = new Set<string>(COMPONENT_KINDS);

  for (const population of POPULATIONS) {
    it(`${population.name} names only kinds the schema publishes`, () => {
      const named = kindsIn(population);
      assert.ok(named.length > 0, `${population.name} was read as empty`);
      const unpublished = named.filter((kind) => !published.has(kind));
      assert.deepEqual(
        unpublished,
        [],
        `${population.name} in ${population.file} names ${unpublished.join(', ')}, which ${unpublished.length === 1 ? 'is not a component kind' : 'are not component kinds'}, so the branch reading it can never be taken and a filter that never matches looks exactly like a filter with nothing to match`,
      );
    });
  }

  it('MERMAID_SHAPE names every kind the schema publishes', () => {
    const population = POPULATIONS.find((entry) => entry.total);
    assert.ok(population !== undefined);
    const named = new Set(kindsIn(population));
    const missing = [...COMPONENT_KINDS].filter((kind) => !named.has(kind));
    assert.deepEqual(
      missing,
      [],
      `MERMAID_SHAPE omits ${missing.join(', ')}, so a component of that kind is drawn with the default shape and the diagram says less than the graph knows. This is the one population that is total, and it is total because it is the only one that can catch a kind being added`,
    );
  });
});
