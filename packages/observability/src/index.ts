/**
 * Observability of Orchescope itself: progress events the edges render, and redacted structured logging.
 */

export {
  collectingSink,
  createLogger,
  type LogFields,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogRecord,
} from './logger.ts';
export {
  collectingProgress,
  createProgressReporter,
  type PhaseName,
  type ProgressEvent,
  type ProgressReporter,
  type ProgressSink,
  silentProgress,
} from './progress.ts';
