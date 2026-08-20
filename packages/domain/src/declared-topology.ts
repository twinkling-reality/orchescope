import type { Edge } from '@orchescope/schema';

/**
 * The difference between the topology a repository declares and the paths a run happened to take.
 *
 * A relation reconciliation could not match against any declaration is kept, because a run reaching
 * somewhere nobody wrote down is one of the four deltas this product exists to report. It is not part of
 * the declared topology, and a rule whose subject is that topology may not walk it.
 *
 * Reading them was how the declared answer came to depend on whether anyone had traced the system. The
 * OpenAI Agents instrumentor opens a span for the trace it wraps a run in, nothing points at it, so it
 * qualified as a root and reached the whole agent graph through relations only that run produced. The
 * same commit reported seventeen components unreachable when scanned and one when scanned with a run in
 * the project, and the second number was the tracing library's.
 *
 * The vocabulary is here rather than beside either consumer for the same reason `partOfAuditedSystem` is:
 * the delta, the coverage fraction and every rule about the declared shape ask the same question, and a
 * graph answering it one way for one of them and another way for the other is how the contradiction
 * arrived as a finding.
 *
 * What this excludes stays in the graph, and the exercised against declared delta is where it is
 * reported. This predicate says which population a question is about, never which facts are kept.
 */
export const partOfDeclaredTopology = (edge: Edge): boolean => !edge.runtimeOnly;
