import type { Deadline } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { AdapterRun } from '@orchescope/schema';
import type { ManifestSet, ModuleFacts } from '@orchescope/source-analysis';
import type { BindingRegistry } from './bindings.ts';
import type { ConfigDocument } from './config-files.ts';
import type { SymbolIndex } from './symbol-index.ts';

/**
 * The adapter port.
 *
 * An adapter answers one question: given the facts of this repository, which components and relations
 * does this framework or convention contribute. Adapters never read the filesystem, never call a
 * model, and never decide severity. They add drafts with evidence to the builder and report what they
 * found so that coverage is honest about which adapters ran and which found nothing.
 *
 * Because the fact model is language neutral, one adapter usually covers a framework in both
 * ecosystems: `new Agent({ name })` in TypeScript and `Agent(name=...)` in Python reduce to the same
 * call fact with the same object entries.
 */

export type DiscoveryContext = {
  readonly projectName: string;
  readonly manifests: ManifestSet;
  readonly modules: readonly ModuleFacts[];
  readonly configs: readonly ConfigDocument[];
  readonly symbols: SymbolIndex;
  /** Shared mapping from a local variable to the component it produced. */
  readonly bindings: BindingRegistry;
  readonly deadline: Deadline;
};

export type AdapterFindings = {
  readonly componentsFound: number;
  readonly edgesFound: number;
  readonly filesInspected: number;
  readonly note?: string;
  /**
   * Set when an input the project wrote on purpose could not be used, for example a manifest the schema
   * rejects. It records the adapter run as failed, which is what makes the rejection visible in the report
   * and on the terminal instead of leaving the reader with an empty graph and no explanation.
   */
  readonly problem?: string;
};

export type AgentSystemAdapter = {
  readonly id: string;
  readonly version: string;
  readonly ecosystem: AdapterRun['ecosystem'];
  /**
   * The packages this adapter claims to read, which is a coverage claim rather than a matcher.
   *
   * Discovery compares it against what the repository actually imports, so that an adapter which claims a
   * framework the repository uses and then finds nothing in it is reported as a gap in Orchescope rather than
   * left to read as "no agent system here". An adapter that reads a convention rather than a package, such as
   * side effects or prompt literals, claims nothing.
   */
  readonly packages: readonly string[];
  /** Cheap applicability check. A false answer records `not_applicable` rather than a failure. */
  readonly appliesTo: (context: DiscoveryContext) => boolean;
  readonly discover: (context: DiscoveryContext, builder: SystemGraphBuilder) => AdapterFindings;
};
