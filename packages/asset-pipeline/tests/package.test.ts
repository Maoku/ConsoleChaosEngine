import { describe, expect, it } from 'vitest';
import { ASSET_PIPELINE_VERSION } from '../src/index';

describe('@console-chaos/asset-pipeline', () => {
  it('exposes its package version from the public entry point', () => {
    expect(ASSET_PIPELINE_VERSION).toBe('0.1.0');
  });
});
