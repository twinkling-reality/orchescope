/**
 * The per repository summary.
 *
 * Three numbers earn their place on every line: the parse rate, because a reader that parsed a third of the source
 * it claims to read knows a third of it; what each adapter contributed, because that is what says which adapters matter;
 * and the adapters that found nothing, because one claiming a framework and reading nothing from it is the failure mode a
 * per framework reader has, and it is invisible unless it is printed.
 *
 * The parse rate is against the files in a language this build reads, not against every file the traversal walked.
 * The corpus was reporting the second and calling it the first, which made a repository with 1233 test fixtures and
 * 598 Python files look a third read when every Python file in it had been parsed.
 */

const percent = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

const contributions = (adapters) =>
  Object.entries(adapters)
    .filter(([, run]) => run.componentsFound > 0 || run.edgesFound > 0)
    .map(([id, run]) => `${id.replace('adapter:', '')} ${run.componentsFound}c/${run.edgesFound}r`);

const failed = (adapters) =>
  Object.entries(adapters)
    .filter(([, run]) => run.status === 'failed')
    .map(([id]) => id);

export const describe = (observation) => {
  const lines = [
    `${observation.name}  ${observation.agentSystemDetected ? 'agent system' : 'no agent system'}, ${observation.components.total} components, ${observation.relations.total} relations`,
    `  parse rate    ${observation.files.parsed}/${observation.files.inSupportedLanguages} files in a language this build reads (${percent(observation.files.parsed, observation.files.inSupportedLanguages)}%), ${observation.files.discovered} discovered${observation.files.truncated ? ', truncated' : ''}`,
    `  adapters      ${contributions(observation.adapters).join(', ') || 'none contributed'}`,
    `  found nothing ${observation.foundNothing.join('; ') || 'none'}`,
    `  findings      ${observation.findings.total} across ${Object.keys(observation.findings.byRule).length} rule(s), ${observation.findings.strengths} strength(s)`,
  ];
  if (observation.runtime !== undefined) {
    const runtime = observation.runtime;
    lines.push(
      `  runtime       ${runtime.spans} span(s), ${runtime.exercisedComponents} of ${runtime.declaredComponents} components exercised, ${runtime.exercisedNotDeclared.length} without a declaration`,
    );
  }
  if (observation.discardedRelations.length > 0) {
    lines.push(`  discarded     ${observation.discardedRelations.join('; ')}`);
  }
  if (failed(observation.adapters).length > 0) {
    lines.push(`  failed        ${failed(observation.adapters).join(', ')}`);
  }
  if (observation.languagesNotAnalysed.length > 0) {
    lines.push(`  not inspected ${observation.languagesNotAnalysed.join('; ')}`);
  }
  return lines;
};
