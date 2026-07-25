import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Type } from '@sinclair/typebox';
import { DOCUMENT_SCHEMAS, documentDescriptors } from '../src/registry.ts';
import { compileChecker, formatIssues, validate, validateDocument } from '../src/validate.ts';
import { MIN_READABLE_VERSIONS, SCHEMA_VERSIONS } from '../src/version.ts';

/**
 * Validation tests.
 *
 * Everything untrusted enters through this module: an imported artifact, a scenario file, an OTLP payload, an argument from
 * a coding agent. The properties that matter are that a failure is a value rather than an exception, that a version is
 * checked before a shape so an unreadable document produces one clear message instead of a wall of property errors, and
 * that a document from a newer build is refused rather than partially read.
 */

const Person = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    age: Type.Integer({ minimum: 0 }),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

describe('validate', () => {
  it('returns the value when it matches', () => {
    const result = validate(Person, { name: 'ada', age: 36 });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.name, 'ada');
  });

  it('returns issues rather than throwing', () => {
    const result = validate(Person, { name: '', age: -1 });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.length >= 2);
      for (const issue of result.issues) {
        assert.match(issue.path, /^\//);
        assert.ok(issue.message.length > 0);
      }
    }
  });

  it('names the path of each problem', () => {
    const result = validate(Person, { name: 'ada', age: 'thirty' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.path === '/age'));
  });

  it('describes what it received without quoting a whole document', () => {
    const result = validate(Person, { name: 'ada', age: 1, extra: 'x'.repeat(500) });
    assert.equal(result.ok, false);
    if (!result.ok) {
      for (const issue of result.issues) {
        assert.ok((issue.received ?? '').length <= 120, 'a received value was reported in full');
      }
    }
  });

  it('refuses an unknown field, so a typo is not silently ignored', () => {
    assert.equal(validate(Person, { name: 'ada', age: 1, aeg: 2 }).ok, false);
  });

  it('bounds how many issues it reports', () => {
    const Wide = Type.Object(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`field${index}`, Type.String()]),
      ),
    );
    const result = validate(Wide, {});
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(result.issues.length <= 20, `reported ${result.issues.length} issues`);
  });

  it('accepts a value that is not an object where the schema allows it', () => {
    assert.equal(validate(Type.Array(Type.Number()), [1, 2, 3]).ok, true);
    assert.equal(validate(Type.Array(Type.Number()), ['one']).ok, false);
  });
});

describe('compileChecker', () => {
  it('agrees with the interpreted path', () => {
    const check = compileChecker(Person);
    assert.equal(check({ name: 'ada', age: 36 }).ok, validate(Person, { name: 'ada', age: 36 }).ok);
    assert.equal(check({ name: '', age: 36 }).ok, validate(Person, { name: '', age: 36 }).ok);
  });

  it('reports issues in the same shape', () => {
    const result = compileChecker(Person)({ name: 'ada', age: 'thirty' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((issue) => issue.path === '/age'));
      assert.ok(result.issues.every((issue) => issue.message.length > 0));
    }
  });
});

describe('validateDocument', () => {
  const Document = Type.Object(
    { schemaVersion: Type.Integer(), id: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  );

  it('accepts the current version', () => {
    assert.equal(validateDocument(Document, 1, 1, { schemaVersion: 1, id: 'a' }).ok, true);
  });

  it('refuses anything that is not a JSON object', () => {
    for (const value of [null, 42, 'text', [1, 2], undefined]) {
      const result = validateDocument(Document, 1, 1, value);
      assert.equal(result.ok, false, `${String(value)} was accepted`);
      if (!result.ok) assert.match(result.issues[0]?.message ?? '', /JSON object/);
    }
  });

  it('refuses a document with no integer version', () => {
    for (const version of [undefined, '1', 1.5, null]) {
      const result = validateDocument(Document, 1, 1, { schemaVersion: version, id: 'a' });
      assert.equal(result.ok, false, `version ${String(version)} was accepted`);
      if (!result.ok) assert.equal(result.issues[0]?.path, '/schemaVersion');
    }
  });

  it('refuses a document from a newer build, and says to upgrade', () => {
    const result = validateDocument(Document, 1, 1, { schemaVersion: 7, id: 'a' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.issues[0]?.message ?? '', /newer than this build/);
      assert.match(result.issues[0]?.message ?? '', /Upgrade/);
      assert.equal(
        result.issues.length,
        1,
        'a version refusal should not also list property errors',
      );
    }
  });

  it('refuses a document older than the minimum readable version', () => {
    const result = validateDocument(Document, 3, 2, { schemaVersion: 1, id: 'a' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.issues[0]?.message ?? '', /older than the minimum/);
  });

  it('checks the version before the shape', () => {
    // A future document whose properties this build also cannot read produces the version message alone, which is the one
    // a reader can act on.
    const result = validateDocument(Document, 1, 1, { schemaVersion: 9, unknown: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues.length, 1);
  });

  it('validates the shape once the version is acceptable', () => {
    const result = validateDocument(Document, 1, 1, { schemaVersion: 1, id: '' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.path === '/id'));
  });
});

describe('formatIssues', () => {
  it('produces one readable line', () => {
    const text = formatIssues([
      { path: '/age', message: 'Expected integer', received: 'thirty' },
      { path: '/name', message: 'Expected string' },
    ]);
    assert.equal(text, '/age: Expected integer (received thirty); /name: Expected string');
  });

  it('produces an empty string for no issues', () => {
    assert.equal(formatIssues([]), '');
  });
});

describe('the document registry', () => {
  it('has a version and a minimum readable version for every document', () => {
    for (const name of Object.keys(DOCUMENT_SCHEMAS)) {
      const version = SCHEMA_VERSIONS[name as keyof typeof SCHEMA_VERSIONS];
      const minimum = MIN_READABLE_VERSIONS[name as keyof typeof MIN_READABLE_VERSIONS];
      assert.equal(typeof version, 'number', `${name} has no version`);
      assert.equal(typeof minimum, 'number', `${name} has no minimum readable version`);
      assert.ok(minimum <= version, `${name} cannot read the version it writes`);
    }
  });

  it('names each emitted file after its document and version', () => {
    for (const descriptor of documentDescriptors()) {
      assert.match(descriptor.fileName, /^[a-z-]+\.v\d+\.json$/);
      assert.match(descriptor.fileName, new RegExp(`\\.v${descriptor.version}\\.json$`));
    }
  });

  it('describes every registered document exactly once', () => {
    const descriptors = documentDescriptors();
    assert.equal(descriptors.length, Object.keys(DOCUMENT_SCHEMAS).length);
    assert.equal(new Set(descriptors.map((entry) => entry.fileName)).size, descriptors.length);
  });

  it('rejects a document of the wrong kind, so two schemas are not interchangeable', () => {
    const scenario = DOCUMENT_SCHEMAS['scenario'];
    const graph = DOCUMENT_SCHEMAS['systemGraph'];
    assert.ok(scenario !== undefined && graph !== undefined);
    const minimalScenarioShape = { schemaVersion: 1, id: 'a-scenario', name: 'A scenario' };
    assert.equal(validate(graph, minimalScenarioShape).ok, false);
  });
});
