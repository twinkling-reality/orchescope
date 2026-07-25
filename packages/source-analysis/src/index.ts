/**
 * Source analysis: repository traversal, content addressed reading, and reduction of JavaScript,
 * TypeScript and Python files to a language neutral fact model.
 *
 * Parsers are an implementation detail of this package. Nothing outside it imports `oxc-parser` or
 * `web-tree-sitter`, so replacing a parser is a change here and nowhere else.
 */

export {
  ANALYZER_VERSION,
  type AnalysisResult,
  type AnalyzeOptions,
  type FactCache,
  analyzeFileSet,
  cacheKey,
  inMemoryFactCache,
} from './analyzer.ts';
export {
  type ArgumentFact,
  type CallFact,
  type CallKind,
  type CalleeOrigin,
  type ControlFlowFact,
  type DecoratorFact,
  type DefinitionFact,
  type EnvironmentFact,
  type ImportFact,
  type ModuleFacts,
  type ObjectEntryFact,
  TEXT_FACT_MIN_LENGTH,
  type TextFact,
  approximateTokens,
  booleanValue,
  calleeName,
  calleeRoot,
  dotted,
  findEntry,
  identifierItems,
  numberValue,
  objectArgument,
  stringValue,
} from './facts.ts';
export {
  DEFAULT_EXCLUDED_DIRECTORIES,
  type FileContents,
  type FileSet,
  type Language,
  type SourceFile,
  type TraversalOptions,
  collectFiles,
  isSkipped,
  languageOf,
  readSource,
  toPosix,
} from './file-set.ts';
export { type LineIndex, buildLineIndex } from './line-index.ts';
export {
  type DeclaredDependency,
  type ManifestSet,
  hasDependency,
  parsePythonRequirement,
  readManifests,
} from './manifests.ts';
export { resetPythonParser } from './python/runtime.ts';
