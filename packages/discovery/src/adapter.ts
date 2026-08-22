import type { Deadline } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { CitationSnapshot, ManifestSet, ModuleFacts } from '@orchescope/source-analysis';
import type { BindingRegistry } from './bindings.ts';
import type { CallSiteEffects } from './call-site-effect.ts';
import type { ConfigDocument } from './config-files.ts';
import type { ImplementationSpanRegistry } from './implementation-span.ts';
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
  /**
   * Every file the traversal walked, by path, with the size where the traversal took one.
   *
   * `modules` answers only for the languages this build parses, and the one input that exists precisely for
   * the languages it does not is the manifest: a component declared `definedIn: src/orchestrator.rb` is the
   * case the manifest is documented for. Without this the engine accepts a citation to a file that is not
   * there, and it does, which is what makes a manifest unfalsifiable.
   *
   * This is the traversal's own product rather than a licence to read anything: an adapter still never opens
   * a file. The size is absent for a language no parser reads, because taking one would be a stat per file
   * on files nothing will open. Where it is present, a line number beyond the byte count is one that file
   * cannot have, which is as far as a citation can be refuted without reading it.
   */
  readonly files: readonly { readonly path: string; readonly byteLength?: number }[];
  /** Versioned manifest citation facts read by discovery under traversal and byte ceilings. */
  readonly citations: readonly CitationSnapshot[];
  readonly symbols: SymbolIndex;
  /** Shared mapping from a local variable to the component it produced. */
  readonly bindings: BindingRegistry;
  /**
   * Source ranges an adapter recorded as the body of a component it declared.
   *
   * An adapter that reads a declaration is the only one that knows which argument is the body, and a
   * later adapter is the only one that can see every component the body reaches. Recording the span
   * here is how the two halves meet without either one knowing about the other.
   */
  readonly implementations: ImplementationSpanRegistry;
  /**
   * The operation each call site produced, for the calls no name stands for.
   *
   * `bindings` answers for a name someone declared and answers nothing for `fetch(...)` written in
   * place, so a body whose handler makes the request itself reached nothing while the same body
   * extracted into a named function reached the write. Two spellings of one program, one of them
   * legible, and the illegible one is the shape the frameworks document.
   *
   * Kept beside `bindings` because the two answer the same question from opposite ends: a name that
   * was declared, and a call site that declared nothing.
   */
  readonly callSiteEffects: CallSiteEffects;
  readonly deadline: Deadline;
};

export type AdapterFindings = {
  readonly componentsFound: number;
  readonly edgesFound: number;
  /**
   * The files this run inspected, by path.
   *
   * Paths rather than a count, because the languages a run read are a fact about those files and an
   * adapter is the wrong thing to ask: one adapter covers a framework in both ecosystems, so any answer
   * it could give in advance is wrong for half the repositories it runs on.
   */
  readonly filesInspected: readonly string[];
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
