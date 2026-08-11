import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../src/bootstrap.ts', import.meta.url)), 'utf8');
const engineBootstrap = readFileSync(fileURLToPath(new URL('../../src/engine-bootstrap.ts', import.meta.url)), 'utf8');

describe('production bootstrap migration truth gate', () => {
  it('labels and starts only the GameHost runtime', () => {
    expect(source).toContain("dataset.consoleChaosRuntime");
    expect(source).toContain("await import('./engine-bootstrap')");
    expect(source).not.toContain("import('./main')");
    expect(source).not.toContain('runtime=engine');
  });

  it('gives GameHost ownership of production startup and teardown', () => {
    expect(engineBootstrap).toContain('createGameHost({');
    expect(engineBootstrap).toContain('await host.start(createConsoleChaosModule');
    expect(engineBootstrap).toContain('host.dispose();');
    expect(engineBootstrap).not.toContain("from './main'");
  });
});
