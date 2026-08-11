'use strict';

/**
 * Architectural boundaries for Orchescope, enforced in CI.
 *
 * Layering, innermost first:
 *   schema      versioned data contracts, no internal dependencies
 *   domain      identities, invariants and pure policy, may only use node:crypto
 *   core        graph, traces, discovery, findings, scenarios, benchmark, chaos, comparison, goals, report, ...
 *   adapters    persistence, artifacts, runtime, source-analysis, adapters, semantic-analysis
 *   assembly    workspace, usecases
 *   edges       apps/cli, packages/mcp, packages/report-server, apps/web, apps/demo
 *
 * A package may depend inward, never outward.
 */

const CORE = [
  'graph',
  'policy',
  'traces',
  'discovery',
  'adapters',
  'findings',
  'semantic-analysis',
  'scenarios',
  'benchmark',
  'chaos',
  'comparison',
  'goals',
  'report',
  'source-analysis',
  'runtime',
  'artifacts',
  'redaction',
  'observability',
].join('|');

const OUTWARD_FROM_CORE = 'workspace|usecases|mcp|report-server|persistence';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cyclic dependencies between modules are not allowed.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Every source module must be reachable from a package entry point.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '^scripts/',
          '^packages/[^/]+/src/index\\.ts$',
          '^apps/[^/]+/src/main\\.ts$',
          '^apps/web/',
        ],
      },
      to: {},
    },
    {
      name: 'schema-is-pure',
      severity: 'error',
      comment:
        'packages/schema holds versioned contracts and must not depend on other Orchescope packages.',
      from: { path: '^packages/schema/src' },
      to: { path: '^packages/(?!schema/)', pathNot: '^packages/schema/' },
    },
    {
      name: 'schema-has-no-runtime-io',
      severity: 'error',
      comment: 'packages/schema must not touch the filesystem, process or network.',
      from: { path: '^packages/schema/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'domain-depends-on-schema-only',
      severity: 'error',
      comment: 'The domain core may only depend on packages/schema.',
      from: { path: '^packages/domain/src' },
      to: {
        path: '^packages/',
        pathNot: '^packages/(domain|schema)/',
      },
    },
    {
      name: 'domain-uses-only-node-crypto',
      severity: 'error',
      comment:
        'The domain core computes stable identities with node:crypto and must not reach any other platform API.',
      from: { path: '^packages/domain/src' },
      // dependency-cruiser reports a core module by its bare name, so both spellings are named here.
      to: { dependencyTypes: ['core'], pathNot: '^(node:)?crypto$' },
    },
    {
      name: 'core-does-not-depend-outward',
      severity: 'error',
      comment: 'Core packages must not depend on assembly, storage or edge packages.',
      from: { path: `^packages/(${CORE})/src` },
      to: { path: `^packages/(${OUTWARD_FROM_CORE})/src` },
    },
    {
      name: 'packages-do-not-depend-on-apps',
      severity: 'error',
      comment: 'Library packages must never import an application.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-only-sees-schema',
      severity: 'error',
      comment: 'The browser workspace may only share the versioned schema package with the CLI.',
      from: { path: '^apps/web/src' },
      to: { path: '^packages/', pathNot: '^packages/schema/' },
    },
    {
      name: 'web-presentation-is-pure',
      severity: 'error',
      comment:
        'Presentation binders decide what each slot holds and must not import the replaceable skin.',
      from: { path: '^apps/web/src/presentation/' },
      to: { path: '^apps/web/src/(ui|sections)/' },
    },
    {
      name: 'web-ui-does-not-import-sections',
      severity: 'error',
      comment:
        'UI primitives are shared across screens and must not depend on a section implementation.',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/sections/' },
    },
    {
      name: 'cli-goes-through-usecases',
      severity: 'error',
      comment:
        'The CLI must not reach storage adapters directly; it composes through workspace and usecases.',
      from: { path: '^apps/cli/src' },
      to: { path: '^packages/(persistence|artifacts)/src' },
    },
    {
      name: 'demo-is-standalone',
      severity: 'error',
      comment:
        'The demonstration agent system is an audit target and must not import Orchescope packages.',
      from: { path: '^apps/demo/src' },
      to: { path: '^packages/' },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core modules are not allowed.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|constants)$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Runtime source must not import a development dependency.',
      from: { path: '^(packages|apps)/[^/]+/src', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'], pathNot: 'node_modules/@types/' },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'error',
      comment: 'A dependency must be declared exactly once per package.',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|fixtures)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
