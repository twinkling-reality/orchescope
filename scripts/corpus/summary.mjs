/**
 * The per repository summary.
 *
 * Three numbers earn their place on every line: the parse rate, because a reader that parsed a third of a
 * repository knows a third of it; what each adapter contributed, because that is what says which adapters matter;
 * and the blind spots, because an adapter that claims a framework and reads nothing from it is the failure mode a
 * per framework reader has, and it is invisible unless it is printed.
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
    `  parse rate    ${observation.files.parsed}/${observation.files.discovered} files (${percent(observation.files.parsed, observation.files.discovered)}%)${observation.files.truncated ? ', truncated' : ''}`,
    `  adapters      ${contributions(observation.adapters).join(', ') || 'none contributed'}`,
    `  blind spots   ${observation.blindSpots.join('; ') || 'none'}`,
    `  findings      ${observation.findings.total} across ${Object.keys(observation.findings.byRule).length} rule(s), ${observation.findings.strengths} strength(s)`,
  ];
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
