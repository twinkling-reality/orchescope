/**
 * Test utilities shared across packages. Nothing here is shipped in the published bundle.
 */

export {
  buildGraph,
  type ComponentFixture,
  componentDraft,
  edgeDraft,
  emptyCoverage,
  observedComponent,
  observedEdge,
  runtimeTopology,
  sideEffectRecord,
  TEST_TIMESTAMP,
  testProvenance,
} from './builders.ts';
export {
  createTempWorkspace,
  type TempWorkspace,
  writeNodeProject,
  writePythonProject,
} from './workspace.ts';
