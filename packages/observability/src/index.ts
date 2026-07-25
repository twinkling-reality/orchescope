/**
 * Observability of Orchescope itself: progress events the edges render, and redacted structured logging.
 */

export {
  type LogFields,
  type LogLevel,
  type LogRecord,
  type Logger,
  type LoggerOptions,
  collectingSink,
  createLogger,
} from './logger.ts';
export {
  type PhaseName,
  type ProgressEvent,
  type ProgressReporter,
  type ProgressSink,
  collectingProgress,
  createProgressReporter,
  silentProgress,
} from './progress.ts';
