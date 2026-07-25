/**
 * Agent specific chaos engineering.
 *
 * The faults here are the ones agent systems actually fail on: a model that times out or returns malformed
 * structured output, a tool that throws or returns a stale result, an empty retrieval, an unavailable worker,
 * an expired credential, a partially applied side effect, injected content in retrieved text. Each one runs in
 * a plan of its own so that an outcome can be attributed, and delivery is cooperative unless the caller
 * explicitly opted into the proxy.
 */

export { assertEnvironmentAllowed, buildFaultPlan, singleFaultPlans } from './plan.ts';
export { type RunChaosInput, runChaosSuite } from './run.ts';
