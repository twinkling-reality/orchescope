/**
 * Storage adapters. Nothing in the core imports this package: it is constructed at the edge and passed in
 * as a value, which is what keeps the driver replaceable and the core testable without a database.
 */

export { type ArtifactStore, createArtifactStore } from './artifacts.ts';
export {
  asBoolean,
  asInteger,
  asNullable,
  type Database,
  integrityCheck,
  openDatabase,
  type Row,
  type SqlValue,
} from './database.ts';
export { LATEST_SCHEMA_VERSION, MIGRATIONS, type Migration } from './migrations.ts';
export { createStore, type RunSummary, type ScanSummary, type Store } from './store.ts';
