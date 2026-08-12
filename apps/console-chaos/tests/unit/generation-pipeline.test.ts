import { beforeEach, describe, expect, it } from 'vitest';
import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  createGenerationPipeline,
  createProgram,
  unsealShaderCompilation,
} from '@console-chaos/engine';
import { createFakeGL } from './fake_gl';

const VS = '#version 300 es\nvoid main(){gl_Position=vec4(0);}';
const FS = '#version 300 es\nvoid main(){}';

function setup() {
  unsealShaderCompilation();
  const fake = createFakeGL();
  const pipeline = createGenerationPipeline(fake.ctx, { quality: () => 'full' });
  return { fake, pipeline };
}

describe('engine generation WebGL pipeline', () => {
  beforeEach(() => unsealShaderCompilation());

  it('preallocates all generation targets at their hardware resolutions', () => {
    const { fake, pipeline } = setup();
    expect(pipeline.allocatedGenerationTargets).toBe(4);
    expect(fake.callsOf('createFramebuffer').length).toBeGreaterThanOrEqual(6);
    for (const id of GENERATION_IDS) {
      expect(pipeline.sceneTarget(id).width).toBe(HARDWARE_GENERATION_PROFILES[id].video.internalWidth);
      expect(pipeline.sceneTarget(id).height).toBe(HARDWARE_GENERATION_PROFILES[id].video.internalHeight);
    }
  });

  it('allocates composition planes exactly for separate-plane profiles', () => {
    const { pipeline } = setup();
    expect(pipeline.spriteTarget('FC')).not.toBeNull();
    expect(pipeline.spriteTarget('SFC')).not.toBeNull();
    expect(pipeline.spriteTarget('PS1')).toBeNull();
    expect(pipeline.spriteTarget('PS2')).toBeNull();
  });

  it('draws one generation normally and two only during a transition', () => {
    const { pipeline } = setup();
    const drawn: string[] = [];
    pipeline.render(
      { generation: 'PS1', screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      (profile) => drawn.push(profile.id),
    );
    expect(pipeline.lastGenerationsDrawn).toBe(1);
    expect(drawn).toEqual(['PS1']);

    drawn.length = 0;
    pipeline.render(
      { generation: 'SFC', from: 'FC', blend: 0.5, screenWidth: 640, screenHeight: 480, timeSeconds: 1 },
      (profile) => drawn.push(profile.id),
    );
    expect(pipeline.lastGenerationsDrawn).toBe(2);
    expect(drawn).toEqual(['FC', 'SFC']);
  });

  it('performs no framebuffer or shader allocation after startup', () => {
    const { fake, pipeline } = setup();
    fake.calls.length = 0;
    for (const id of GENERATION_IDS) {
      pipeline.render({ generation: id, screenWidth: 640, screenHeight: 480, timeSeconds: 1 }, () => {});
    }
    expect(fake.callsOf('createFramebuffer')).toHaveLength(0);
    expect(fake.callsOf('compileShader')).toHaveLength(0);
    expect(fake.callsOf('linkProgram')).toHaveLength(0);
    expect(() => createProgram(fake.ctx, 'late', VS, FS)).toThrow(/事前コンパイル完了後/);
  });

  it('uses the app-provided background palette index without owning content colors', () => {
    unsealShaderCompilation();
    const fake = createFakeGL();
    fake.uniforms.push({ name: 'uBackgroundIndex', type: 0x1406, size: 1 });
    const pipeline = createGenerationPipeline(fake.ctx, {
      quality: () => 'full',
      backgroundPaletteIndex: () => 27,
    });
    pipeline.render({ generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    const values = fake.callsOf('uniform1f')
      .filter((call) => (call.args[0] as { name: string }).name === 'uBackgroundIndex')
      .map((call) => call.args[1]);
    expect(values.at(-1)).toBe(27);
  });
});
