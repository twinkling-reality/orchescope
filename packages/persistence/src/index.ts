/**
 * Storage adapters. Nothing in the core imports this package: it is constructed at the edge and passed in
 * as a value, which is what keeps the driver replaceable and the core testable without a database.
 */

export { type ArtifactStore, createArtifactStore } from './artifacts.ts';
export {
  type Database,
  type Row,
  type SqlValue,
  asBoolean,
  asInteger,
  asNullable,
  integrityCheck,
  openDatabase,
} from './database.ts';
export { LATEST_SCHEMA_VERSION, type Migration, MIGRATIONS } from './migrations.ts';
export { type RunSummary, type ScanSummary, type Store, createStore } from './store.ts';
