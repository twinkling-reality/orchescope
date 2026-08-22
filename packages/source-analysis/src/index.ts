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
  analyzeFileSet,
  cacheKey,
  type FactCache,
  inMemoryFactCache,
  isSupportedLanguage,
  probeJavaScriptParser,
} from './analyzer.ts';
export {
  type CitationRefusal,
  type CitationRequest,
  type CitationSnapshot,
  type CitationSnapshotOptions,
  readCitationSnapshots,
} from './citation-snapshot.ts';
export {
  type ArgumentFact,
  type AssignmentFact,
  approximateTokens,
  type BranchPredicateFact,
  booleanValue,
  type CalleeOrigin,
  type CallFact,
  type CallKind,
  type ControlFlowFact,
  calleeName,
  calleeRoot,
  type DecoratorFact,
  type DefinitionFact,
  dotted,
  type EnvironmentFact,
  findEntry,
  type ImportFact,
  identifierItems,
  type LiteralDestinationFact,
  type ModuleFacts,
  numberValue,
  type ObjectEntryFact,
  objectArgument,
  type ReturnAnnotationFact,
  type ReturnFact,
  stringValue,
  TEXT_FACT_MIN_LENGTH,
  type TextFact,
} from './facts.ts';
export {
  boundSkipped,
  collectFiles,
  DEFAULT_EXCLUDED_DIRECTORIES,
  type DeclinedDirectory,
  type FileContents,
  type FileSet,
  isSkipped,
  readSource,
  type SourceFile,
  type TraversalOptions,
  toPosix,
} from './file-set.ts';
export { type GenerationSignal, generationSignal } from './generated-code.ts';
export { type Language, languageOf, readsAsCode } from './language.ts';
export { buildLineIndex, type LineIndex } from './line-index.ts';
export {
  type DeclaredDependency,
  hasDependency,
  type ManifestSet,
  parsePythonRequirement,
  readManifests,
} from './manifests.ts';
export { probePythonParser, resetPythonParser } from './python/runtime.ts';
