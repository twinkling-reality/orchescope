import type { Redactor } from '@orchescope/redaction';

/**
 * Structured logging.
 *
 * Every message and every field passes through redaction before it reaches a sink, so a credential that reached
 * a log line by accident does not reach a file. Logging is a port: the core takes a `Logger` and never decides
 * where output goes.
 *
 * Fields are bounded. A log line is a diagnostic, not a data export, so long values are truncated with the
 * original length recorded.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean>>;

export type LogRecord = {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
};

export type Logger = {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warning: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
  readonly child: (fields: LogFields) => Logger;
};

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const MAX_FIELD_LENGTH = 300;

export type LoggerOptions = {
  readonly level: LogLevel;
  readonly sink: (record: LogRecord) => void;
  readonly redactor: Redactor;
  readonly base?: LogFields;
};

const boundField = (value: string | number | boolean): string | number | boolean => {
  if (typeof value !== 'string') return value;
  return value.length > MAX_FIELD_LENGTH
    ? `${value.slice(0, MAX_FIELD_LENGTH)}[truncated from ${value.length}]`
    : value;
};

export const createLogger = (options: LoggerOptions): Logger => {
  const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[options.level]) return;
    const merged: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries({ ...options.base, ...fields })) {
      merged[key] =
        typeof value === 'string'
          ? boundField(options.redactor.environmentValue(key, value))
          : boundField(value);
    }
    options.sink({ level, message: options.redactor.text(message), fields: merged });
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warning: (message, fields) => write('warning', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ ...options, base: { ...options.base, ...fields } }),
  };
};

export const collectingSink = (): {
  readonly sink: (record: LogRecord) => void;
  readonly records: readonly LogRecord[];
} => {
  const records: LogRecord[] = [];
  return { sink: (record) => records.push(record), records };
};
