import type { Component, ComponentKind } from '@orchescope/schema';
import { isModelCallFrame } from './inferred-entry-point.ts';

/**
 * Component kinds whose presence means this repository builds something worth auditing as an agent system.
 *
 * Beside `partOfAuditedSystem` because detection asks both in one breath: a component counts only where its
 * kind is one of these and it belongs to the system rather than to whoever works on the repository. Kept
 * here rather than beside the one call site so that a check on what detection can be moved by reads the set
 * detection decides with, instead of a copy of it that goes stale the day a kind is added.
 */
export const AGENT_SYSTEM_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  'agent',
  'workflow',
  'model',
  'tool',
  'mcp_server',
]);

/**
 * The difference between the system under audit and the tools of whoever works on it.
 *
 * A repository can hold configuration that belongs to a developer's editor or coding agent rather than
 * to the software it builds. A `.mcp.json` naming a server is the clearest case: it tells one person's
 * tool where to connect, and it says nothing about what the repository is. Reading one as a declaration
 * reported a 220 component Cloudflare Workers application as a detected agent system holding no agent,
 * no tool and no model, and the reachability rule then raised a finding against that repository because
 * nothing in it could reach the server the developer's editor talks to.
 *
 * A component only a test declares is the same distinction and the larger half of it. A test suite is
 * written by whoever works on the repository, for them, and what it declares is exercised by nothing the
 * repository ships. On the frameworks this build reads it is most of the graph, and on one application
 * built with pydantic-ai it was ten of the sixteen agents reported, three of them copies of one
 * `_make_test_agent` helper and two of them local variables in a test about teams.
 *
 * The vocabulary is here rather than beside any consumer because the detection flag, the topology rule and
 * every rule whose population is the system rather than the repository ask the same question, and a
 * repository that answers it one way for one of them and the other way for the other is exactly how that
 * contradiction got reported as a finding.
 *
 * What this excludes stays in the graph. A developer's tooling is a true fact about a repository, and
 * hiding it would trade one wrong answer for a missing one. `coverage.componentsDeclaredInTest` says how
 * many were set aside, because a population quietly smaller than the graph is a number with no whole.
 */
export const partOfAuditedSystem = (component: Component): boolean =>
  component.declaredInTest !== true &&
  !(component.details?.for === 'mcp_server' && component.details.role === 'developer_tooling');

/**
 * Whether this component is enough to say its repository implements an agent system.
 *
 * A consumed MCP server is part of the topology when an agent in the same repository reaches it, but the
 * server alone says only that this repository is a client. An unqualified server keeps the version 1
 * manifest meaning, and an implemented server establishes detection.
 *
 * A model call frame answers too, and it is the only kind of component here that is not one of the kinds
 * above. A repository that calls a model implements an agent system, and normally the `model` component
 * says so; a repository whose client takes a base URL chosen at run time and a model chosen from a
 * variable has no model this build can name, so nothing was left to say it. That repository is the
 * blind evaluation positive for candidate `df99c97c`, pinned because the sentence "no agent system was
 * detected" about it blocked a release, and until this it was carried by a component invented from the
 * call site and called an `agent`. The invention is gone; the observation it stood for is real and is
 * asked for directly.
 *
 * This does not widen detection where a model can be named, because a named model already answers. It
 * changes exactly one answer: the repository that calls a model this build cannot identify. A repository
 * that makes no generation call has no frame and is unaffected, which is what keeps the pinned negatives
 * where they are.
 */
export const establishesAgentSystem = (component: Component): boolean =>
  partOfAuditedSystem(component) &&
  (isModelCallFrame(component) ||
    (AGENT_SYSTEM_KINDS.has(component.kind) &&
      !(component.details?.for === 'mcp_server' && component.details.role === 'consumed')));
