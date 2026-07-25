/**
 * Test utilities shared across packages. Nothing here is shipped in the published bundle.
 */

export {
  type ComponentFixture,
  TEST_TIMESTAMP,
  buildGraph,
  componentDraft,
  edgeDraft,
  emptyCoverage,
  observedComponent,
  observedEdge,
  runtimeTopology,
  sideEffectRecord,
  testProvenance,
} from './builders.ts';
export {
  type TempWorkspace,
  createTempWorkspace,
  writeNodeProject,
  writePythonProject,
} from './workspace.ts';
