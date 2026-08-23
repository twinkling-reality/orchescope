import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModuleFacts } from '@orchescope/source-analysis';
import { importsAny, matchCalls, matchRuntimeSymbol } from '../src/matching.ts';

const location = { file: 'src/app.ts', startLine: 1 };

const moduleFacts = (overrides: Partial<ModuleFacts> = {}): ModuleFacts => ({
  file: 'src/app.ts',
  language: 'typescript',
  contentHash: 'a'.repeat(64),
  imports: [],
  exportedNames: [],
  calls: [],
  assignments: [],
  definitions: [],
  environmentRefs: [],
  texts: [],
  controlFlow: [],
  parseErrors: [],
  ...overrides,
});

const symbol = (
  path: readonly string[],
  origin:
    | { readonly module: string; readonly imported: string; readonly isType: boolean }
    | undefined,
) => ({ path, origin, enclosing: undefined });

const postgres = { names: ['Client', 'Pool'], packages: ['pg'] } as const;

describe('runtime provider symbol matching', () => {
  it('preserves direct, renamed, namespace and default-member imports by exported identity', () => {
    const module = moduleFacts();
    assert.ok(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['Client'], {
          module: 'pg',
          imported: 'Client',
          isType: false,
        }),
        postgres,
      ),
    );
    assert.ok(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['PgClient'], {
          module: 'pg',
          imported: 'Client',
          isType: false,
        }),
        postgres,
      ),
    );
    assert.ok(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['pg', 'Client'], {
          module: 'pg',
          imported: '*',
          isType: false,
        }),
        postgres,
      ),
    );
    assert.ok(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['pg', 'Pool'], {
          module: 'pg',
          imported: 'default',
          isType: false,
        }),
        postgres,
      ),
    );
  });

  it('rejects a direct default alias unless the caller declares the package default contract', () => {
    const module = moduleFacts();
    const direct = symbol(['Client'], { module: 'pg', imported: 'default', isType: false });
    assert.equal(matchRuntimeSymbol([module], module, direct, postgres), undefined);
    assert.ok(
      matchRuntimeSymbol([module], module, direct, {
        ...postgres,
        defaultExportNames: ['Client'],
      }),
    );
  });

  it('rejects wrong providers, type-only origins, missing origins and explicit shadows', () => {
    const shadowed = moduleFacts({
      definitions: [
        {
          kind: 'class',
          name: 'Client',
          exported: false,
          async: false,
          decorators: [],
          location,
          initializer: undefined,
          enclosing: undefined,
        },
      ],
    });
    assert.equal(
      matchRuntimeSymbol(
        [shadowed],
        shadowed,
        symbol(['Client'], {
          module: 'pg',
          imported: 'Client',
          isType: false,
        }),
        postgres,
      ),
      undefined,
    );
    const module = moduleFacts();
    assert.equal(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['Client'], {
          module: 'httpx',
          imported: 'Client',
          isType: false,
        }),
        postgres,
      ),
      undefined,
    );
    assert.equal(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['Client'], {
          module: 'pg',
          imported: 'Client',
          isType: true,
        }),
        postgres,
      ),
      undefined,
    );
    assert.equal(
      matchRuntimeSymbol([module], module, symbol(['Client'], undefined), postgres),
      undefined,
    );
  });

  it('rejects a retained import origin when a callable parameter shadows its root', () => {
    const shadowed = moduleFacts({
      definitions: [
        {
          kind: 'function',
          name: 'build',
          exported: false,
          async: false,
          decorators: [],
          parameters: [{ name: 'Client', location }],
          location,
          initializer: undefined,
          enclosing: undefined,
        },
      ],
    });
    assert.equal(
      matchRuntimeSymbol(
        [shadowed],
        shadowed,
        {
          ...symbol(['Client'], { module: 'pg', imported: 'Client', isType: false }),
          enclosing: 'build',
        },
        postgres,
      ),
      undefined,
    );
  });

  it('allows an unresolved spelling only through the explicit bounded heuristic', () => {
    const module = moduleFacts({
      imports: [
        {
          module: 'langgraph.prebuilt',
          imported: 'something_else',
          local: 'something_else',
          isType: false,
          location,
        },
      ],
    });
    const unresolved = symbol(['create_react_agent'], undefined);
    const query = { names: ['create_react_agent'], packages: ['langgraph'] } as const;
    assert.equal(matchRuntimeSymbol([module], module, unresolved, query), undefined);
    assert.equal(
      matchRuntimeSymbol([module], module, unresolved, {
        ...query,
        allowUnresolvedWhenFrameworkImported: true,
      })?.resolved,
      false,
    );
    assert.equal(
      matchRuntimeSymbol(
        [module],
        module,
        symbol(['create_react_agent'], {
          module: 'local_react',
          imported: 'create_react_agent',
          isType: false,
        }),
        {
          ...query,
          allowUnresolvedWhenFrameworkImported: true,
        },
      ),
      undefined,
    );
  });

  it('does not let type-only imports authorize applicability or unresolved call matching', () => {
    const call = {
      kind: 'new' as const,
      calleePath: ['Client'],
      origin: undefined,
      args: [],
      location,
      offset: 0,
      enclosing: undefined,
      awaited: false,
    };
    const module = moduleFacts({
      imports: [
        {
          module: 'pg',
          imported: 'Client',
          local: 'Client',
          isType: true,
          location,
        },
      ],
      calls: [call],
    });
    assert.equal(importsAny(module, ['pg']), false);
    assert.deepEqual(
      matchCalls([module], {
        ...postgres,
        allowUnresolvedWhenFrameworkImported: true,
      }),
      [],
    );
  });

  it('rejects a provider-like module that resolves to a repository-local module', () => {
    const app = moduleFacts({
      file: 'src/app.py',
      language: 'python',
      imports: [
        {
          module: 'pg',
          imported: 'Client',
          local: 'Client',
          isType: false,
          location: { ...location, file: 'src/app.py' },
        },
      ],
    });
    const localProvider = moduleFacts({ file: 'src/pg.py', language: 'python' });
    assert.equal(
      matchRuntimeSymbol(
        [app, localProvider],
        app,
        symbol(['Client'], {
          module: 'pg',
          imported: 'Client',
          isType: false,
        }),
        postgres,
      ),
      undefined,
    );
  });
});
