/**
 * Removes run-scoped evidence identities from one stable corpus coverage observation.
 *
 * Span evidence is content addressed over run, trace and span identifiers. A fresh exercise therefore produces new
 * evidence IDs even when the same semantic coverage refusal and the same evidence population reproduce. Corpus
 * expectations retain the population and omission accounting while refusing any sampled ID the report does not carry.
 */

const missingAttributeAccount = (entry, evidenceIds) => {
  const sample = entry.evidence ?? [];
  const unresolved = evidenceIds === undefined ? [] : sample.filter((id) => !evidenceIds.has(id));
  if (unresolved.length > 0) {
    throw new Error(
      `missing attribute ${entry.attribute} cites ${unresolved.length} evidence record(s) absent from the report`,
    );
  }
  const evidenceOmitted = entry.evidenceOmitted ?? 0;
  return {
    attribute: entry.attribute,
    observedComponents: entry.observedComponents,
    purpose: entry.purpose,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    evidenceSampled: sample.length,
    evidenceOmitted,
  };
};

/**
 * Projects a bounded list and, when the enclosing document exposes evidence records, resolves every sample first.
 * The federation CLI summary carries coverage but deliberately omits the report's evidence records; its public command
 * has already selected that coverage from the self-contained validated federation report.
 */
export const missingAttributeAccounts = (entries, evidence) => {
  const evidenceIds =
    evidence === undefined ? undefined : new Set(evidence.map((record) => record.id));
  return entries.map((entry) => missingAttributeAccount(entry, evidenceIds));
};
