/**
 * Secret redaction.
 *
 * Orchescope reads repositories, environments and traces, so it handles credentials whether or not anyone
 * intended it to. Redaction runs on every string that leaves the process: evidence excerpts, span attributes,
 * log lines, report content, exported artifacts and error messages.
 *
 * Two rules keep this honest. Redaction preserves the shape of the value, so a reader can tell that something
 * was there and what kind of thing it was. And it never reports "no secrets found": absence of a match is not
 * proof, and the report says so.
 */

export type RedactionRule = {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
  /** Replacement label. The matched value is never included. */
  readonly label: string;
};

/**
 * Patterns are anchored on documented credential prefixes where one exists, because a prefix match is precise,
 * and fall back to high entropy shapes only where a prefix does not exist.
 */
export const DEFAULT_RULES: readonly RedactionRule[] = [
  {
    id: 'openai-key',
    description: 'OpenAI style API key',
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    label: 'openai-api-key',
  },
  {
    id: 'anthropic-key',
    description: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    label: 'anthropic-api-key',
  },
  {
    id: 'google-key',
    description: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    label: 'google-api-key',
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key identifier',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    label: 'aws-access-key-id',
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    label: 'github-token',
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    label: 'slack-token',
  },
  {
    id: 'stripe-key',
    description: 'Stripe secret key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    label: 'stripe-key',
  },
  {
    id: 'private-key-block',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    label: 'private-key',
  },
  {
    id: 'json-web-token',
    description: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    label: 'json-web-token',
  },
  {
    id: 'basic-auth-url',
    description: 'Credentials embedded in a URL',
    pattern: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/gi,
    label: 'url-credentials',
  },
  {
    id: 'bearer-header',
    description: 'Bearer token in a header value',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g,
    label: 'bearer-token',
  },
];

/** Environment variable name fragments whose values are masked regardless of their shape. */
export const DEFAULT_SENSITIVE_FRAGMENTS: readonly string[] = [
  'key',
  'secret',
  'token',
  'password',
  'passwd',
  'credential',
  'auth',
  'private',
  'session',
  'cookie',
];

export type Redactor = {
  readonly text: (value: string) => string;
  /** Masks the value of an environment style entry when the name looks sensitive. */
  readonly environmentValue: (name: string, value: string) => string;
  readonly counts: () => Readonly<Record<string, number>>;
  readonly totalRedactions: () => number;
};

export type RedactorOptions = {
  readonly extraPatterns?: readonly string[];
  readonly sensitiveFragments?: readonly string[];
  readonly rules?: readonly RedactionRule[];
};

const MAX_EXTRA_PATTERN_LENGTH = 200;

const compileExtra = (patterns: readonly string[]): readonly RedactionRule[] => {
  const rules: RedactionRule[] = [];
  for (const [index, source] of patterns.entries()) {
    if (source.length === 0 || source.length > MAX_EXTRA_PATTERN_LENGTH) continue;
    try {
      rules.push({
        id: `configured-${index}`,
        description: 'pattern from configuration',
        pattern: new RegExp(source, 'g'),
        label: 'configured-secret',
      });
    } catch {
      // An unparseable configured pattern is ignored rather than failing the run. The doctor command
      // reports it, which is the right place for a configuration problem to surface.
    }
  }
  return rules;
};

export const createRedactor = (options: RedactorOptions = {}): Redactor => {
  const rules = [...(options.rules ?? DEFAULT_RULES), ...compileExtra(options.extraPatterns ?? [])];
  const fragments = (options.sensitiveFragments ?? DEFAULT_SENSITIVE_FRAGMENTS).map((fragment) =>
    fragment.toLowerCase(),
  );
  const counts = new Map<string, number>();

  const text = (value: string): string => {
    let result = value;
    for (const rule of rules) {
      // A fresh regular expression per call keeps `lastIndex` from leaking between inputs.
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      result = result.replace(pattern, (match) => {
        counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
        if (rule.id === 'basic-auth-url') {
          const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(match)?.[1] ?? 'https';
          return `${scheme}://[redacted:${rule.label}]@`;
        }
        return `[redacted:${rule.label}:${match.length}]`;
      });
    }
    return result;
  };

  return {
    text,
    environmentValue: (name, value) => {
      const lowered = name.toLowerCase();
      if (fragments.some((fragment) => lowered.includes(fragment))) {
        counts.set('environment-name', (counts.get('environment-name') ?? 0) + 1);
        return `[redacted:environment:${value.length}]`;
      }
      return text(value);
    },
    counts: () => Object.fromEntries(counts),
    totalRedactions: () => [...counts.values()].reduce((total, count) => total + count, 0),
  };
};

/**
 * Applies redaction to every string inside a JSON like value, preserving structure. Used on evidence,
 * span attributes and exported artifacts.
 */
export const redactDeep = <T>(value: T, redactor: Redactor, depth = 0): T => {
  if (depth > 64) return value;
  if (typeof value === 'string') return redactor.text(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, redactor, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] =
        typeof item === 'string'
          ? redactor.environmentValue(key, item)
          : redactDeep(item, redactor, depth + 1);
    }
    return result as unknown as T;
  }
  return value;
};
