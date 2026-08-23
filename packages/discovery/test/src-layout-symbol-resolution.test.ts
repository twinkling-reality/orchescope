import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePython } from '../../source-analysis/src/python/analyze.ts';
import { buildSymbolIndex } from '../src/symbol-index.ts';

const analyze = (file: string, text: string) =>
  analyzePython({ file, text, contentHash: file.charCodeAt(0).toString(16).padStart(64, '0') });

describe('Python src-layout symbol resolution', () => {
  it('resolves one absolute local module under src and does not classify it as external', async () => {
    const modules = await Promise.all([
      analyze(
        'src/research/graph.py',
        'from research.configuration import Configuration\nvalue = Configuration()\n',
      ),
      analyze('src/research/configuration.py', 'class Configuration:\n    pass\n'),
    ]);
    const index = buildSymbolIndex(modules);
    assert.deepEqual(index.resolve('src/research/graph.py', 'Configuration'), {
      file: 'src/research/configuration.py',
      name: 'Configuration',
      definition: modules[1]?.definitions[0],
    });
    assert.equal(index.external('src/research/graph.py', 'Configuration'), undefined);
  });

  it('refuses ambiguous root and src candidates', async () => {
    const modules = await Promise.all([
      analyze(
        'src/research/graph.py',
        'from research.configuration import Configuration\nvalue = Configuration()\n',
      ),
      analyze('research/configuration.py', 'class Configuration:\n    pass\n'),
      analyze(
        'src/research/configuration.py',
        'class Configuration:\n    pass\nclass Configuration:\n    pass\n',
      ),
    ]);
    const index = buildSymbolIndex(modules);
    assert.equal(index.resolve('src/research/graph.py', 'Configuration'), undefined);
  });
});
