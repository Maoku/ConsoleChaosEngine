import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../../src/bootstrap.ts', import.meta.url)), 'utf8');

describe('production bootstrap migration truth gate', () => {
  it('labels the selected runtime and keeps comparison access development-only', () => {
    expect(source).toContain("import.meta.env.DEV && runtime === 'engine'");
    expect(source).toContain("dataset.consoleChaosRuntime");
    expect(source).toContain("await import('./engine-bootstrap')");
    expect(source).toContain("await import('./main')");
  });
});
