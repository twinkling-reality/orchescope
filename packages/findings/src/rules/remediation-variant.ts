import type { Recommendation } from '@orchescope/schema';

/**
 * The distinct remediations one rule can print, keyed by the situation each one answers.
 *
 * A remediation is a promise: a goal is cut from it, an agent is told to do what it says, and the same
 * check is rerun to decide whether it worked. A rule that prints two of them has made two promises, and
 * proving one keepable proves nothing about the other. `model-call-without-timeout` printed one
 * remediation for a model behind a client and another for one reached by a plain request, the loop check
 * carried a single repository per rule, and the branch it did not exercise asked for an abort signal on a
 * request that already carried one. The rule was proved clearable; that branch never was.
 *
 * Keying them is what lets the check enumerate rather than be told. A branch added here without a
 * repository that clears it is a missing case rather than a silent one.
 *
 * The subject is whatever the finding is about, since a remediation names the thing the reader has to go
 * and change. Variants that read the same whatever they are about ignore it.
 */
export type RemediationVariants = Readonly<Record<string, (subject: string) => Recommendation>>;
