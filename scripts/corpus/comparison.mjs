/**
 * Compares an expectation with an observation.
 *
 * The result is a list of differences rather than a boolean, because the point of the corpus is the diff: a
 * maintainer reads which adapter went quiet, which rule started firing and which adapter found nothing, and decides
 * whether that is a fix or a regression. Nothing here decides that, and nothing here rewrites an expectation.
 */

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value) => (value === undefined ? 'absent' : JSON.stringify(value));

const canonicalValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).sort().join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const compareLists = (path, expected, observed, differences) => {
  const expectedValues = expected.map(canonicalValue);
  const observedValues = observed.map(canonicalValue);
  for (const entry of expected) {
    if (!observedValues.includes(canonicalValue(entry))) {
      differences.push({ path, expected: JSON.stringify(entry), observed: 'absent' });
    }
  }
  for (const entry of observed) {
    if (!expectedValues.includes(canonicalValue(entry))) {
      differences.push({ path, expected: 'absent', observed: JSON.stringify(entry) });
    }
  }
};

const compareValues = (path, expected, observed, differences) => {
  if (Array.isArray(expected) && Array.isArray(observed)) {
    compareLists(path, expected, observed, differences);
    return;
  }
  if (isRecord(expected) && isRecord(observed)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(observed)])].sort()) {
      compareValues(
        path === '' ? key : `${path}.${key}`,
        expected[key],
        observed[key],
        differences,
      );
    }
    return;
  }
  if (show(expected) !== show(observed)) {
    differences.push({ path, expected: show(expected), observed: show(observed) });
  }
};

export const differences = (expected, observed) => {
  const found = [];
  compareValues('', expected, observed, found);
  return found;
};

/**
 * The claim the corpus file makes about a repository, checked against what the scan actually found. This is
 * separate from the recorded expectation on purpose: a wrong expectation can be recorded, and this cannot.
 */
export const claimDifference = (entry, observation, acceptanceVerdict) => {
  const expected = entry.kind === 'agent_system';
  if (observation.agentSystemDetected === expected) return undefined;
  const completedZeroHeld =
    entry.acceptance?.type === 'completed_zero' &&
    entry.acceptance.expectedAgentSystemDetected === observation.agentSystemDetected &&
    acceptanceVerdict?.total > 0 &&
    acceptanceVerdict.held === acceptanceVerdict.total &&
    acceptanceVerdict.broken.length === 0;
  if (completedZeroHeld) return undefined;
  return {
    path: 'agentSystemDetected',
    expected: `${expected} (corpus.yaml says ${entry.kind})`,
    observed: String(observation.agentSystemDetected),
  };
};
