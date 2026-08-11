import { describe, it, expect, beforeEach } from 'vitest';
import { createPipeline } from '@/render/pipeline';
import { createProgram, unsealShaderCompilation } from '@/render/gl/index';
import { GENERATION_IDS, PROFILES } from '@/generation/profiles';
import { KEY_COLORS } from '@/render/key_palette';
import { SIGNAL_PRESETS } from '@/render/postfx/presets';
import { createFakeGL } from './fake_gl';

const VS = '#version 300 es\nvoid main(){gl_Position=vec4(0);}';
const FS = '#version 300 es\nvoid main(){}';

function setup(quality: 'off' | 'light' | 'full' = 'full') {
  unsealShaderCompilation();
  const fake = createFakeGL();
  const pipeline = createPipeline(fake.ctx, { quality: () => quality });
  return { fake, pipeline };
}

/** GLSL の型番号。uniform の反射は createProgram の中で 1 度だけ走るので、先に宣言しておく */
const FLOAT = 0x1406;
const VEC3 = 0x8b51;

/**
 * 合成パス（transition.glsl）の uniform を見るための組み立て。
 * **反射はプログラム作成時に済む**ので、`createPipeline` より前に宣言を積む必要がある。
 */
function setupCompose(glitchAmount: () => number, names: Array<[string, number]>) {
  unsealShaderCompilation();
  const fake = createFakeGL();
  for (const [name, type] of names) fake.uniforms.push({ name, type, size: 1 });
  const pipeline = createPipeline(fake.ctx, { quality: () => 'full', glitchAmount });
  return { fake, pipeline };
}

/** 直近に流し込まれた float uniform（fake GL は名前つきの location を返す） */
function lastFloat(fake: ReturnType<typeof createFakeGL>, name: string): number | undefined {
  const calls = fake.callsOf('uniform1f').filter((call) => (call.args[0] as { name: string }).name === name);
  return calls.length === 0 ? undefined : (calls[calls.length - 1]!.args[1] as number);
}

describe('render/pipeline（V7 世代切替）', () => {
  beforeEach(() => unsealShaderCompilation());

  it('4 世代分の FBO を起動時にすべて確保する', () => {
    const { fake, pipeline } = setup();
    // 世代ごとのシーン FBO 4 枚 + 出力 2 枚 + 各チェーンの中間 2 枚ずつ
    const created = fake.callsOf('createFramebuffer').length;
    expect(created).toBeGreaterThanOrEqual(4 + 2);
    for (const id of GENERATION_IDS) {
      const target = pipeline.sceneTarget(id);
      expect(target.width).toBe(PROFILES[id].video.internalWidth);
      expect(target.height).toBe(PROFILES[id].video.internalHeight);
    }
  });

  it('起動後はシェーダコンパイルが封じられる（V7 の担保）', () => {
    const { fake } = setup();
    expect(() => createProgram(fake.ctx, 'late', VS, FS)).toThrow(/事前コンパイル完了後/);
  });

  it('切替時に FBO もシェーダも新規作成しない', () => {
    const { fake, pipeline } = setup();
    const draw = () => {};
    pipeline.render(
      { generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      draw,
    );
    fake.calls.length = 0;

    for (const id of GENERATION_IDS) {
      pipeline.render({ generation: id, screenWidth: 640, screenHeight: 480, timeSeconds: 1 }, draw);
    }
    expect(fake.callsOf('createFramebuffer')).toHaveLength(0);
    expect(fake.callsOf('compileShader')).toHaveLength(0);
    expect(fake.callsOf('linkProgram')).toHaveLength(0);
  });

  it('通常時は 1 世代、切替中は 2 世代を描く', () => {
    const { pipeline } = setup();
    const drawn: string[] = [];
    const draw = (profile: { id: string }) => drawn.push(profile.id);

    pipeline.render({ generation: 'PS1', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, draw);
    expect(pipeline.lastGenerationsDrawn).toBe(1);
    expect(drawn).toEqual(['PS1']);

    drawn.length = 0;
    pipeline.render(
      { generation: 'PS1', from: 'FC', blend: 0.5, screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      draw,
    );
    expect(pipeline.lastGenerationsDrawn).toBe(2);
    expect(drawn).toEqual(['FC', 'PS1']);
  });

  it('切替が完了（blend = 1）したら 1 世代に戻る', () => {
    const { pipeline } = setup();
    pipeline.render(
      { generation: 'PS2', from: 'SFC', blend: 1, screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      () => {},
    );
    expect(pipeline.lastGenerationsDrawn).toBe(1);
  });

  it('シーン描画にはプロファイルが渡り、世代 ID の分岐を必要としない', () => {
    const { pipeline } = setup();
    const seen: Array<{ width: number; projection: string; depth: boolean }> = [];
    for (const id of GENERATION_IDS) {
      pipeline.render({ generation: id, screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, (profile) => {
        seen.push({
          width: profile.video.internalWidth,
          projection: profile.video.projection,
          depth: profile.video.depthBuffer,
        });
      });
    }
    expect(seen).toEqual([
      { width: 256, projection: 'ortho2d', depth: false },
      { width: 256, projection: 'ortho2d', depth: false },
      { width: 320, projection: 'perspective3d', depth: false },
      { width: 640, projection: 'perspective3d', depth: true },
    ]);
  });

  it('スプライト面を持つのはプレイヤーを絵で描く世代だけ（T2-10）', () => {
    const { pipeline } = setup();
    for (const id of GENERATION_IDS) {
      const plane = pipeline.spriteTarget(id);
      if (PROFILES[id].player.kind === 'sprite') {
        expect(plane, id).not.toBeNull();
        // 面は背景と同じ内部解像度。ずれると重ねたときに絵が拡大縮小される
        expect(plane!.width, id).toBe(PROFILES[id].video.internalWidth);
        expect(plane!.height, id).toBe(PROFILES[id].video.internalHeight);
      } else {
        expect(plane, id).toBeNull();
      }
    }
  });

  it('スプライト面の描画は、面を持つ世代でしか呼ばれない（T2-10）', () => {
    const { pipeline } = setup();
    const sprites: string[] = [];
    for (const id of GENERATION_IDS) {
      pipeline.render(
        { generation: id, screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
        () => {},
        (profile) => sprites.push(profile.id),
      );
    }
    expect(sprites).toEqual(GENERATION_IDS.filter((id) => PROFILES[id].player.kind === 'sprite'));
  });

  it('光の帯の色は key_palette.ts から来る（KV-08。シェーダに 16 進数を置かない）', () => {
    const { fake, pipeline } = setupCompose(() => 1, [
      ['uRibbonCore', VEC3],
      ['uRibbonLead', VEC3],
      ['uRibbonTrail', VEC3],
    ]);
    pipeline.render({ generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    const found = new Map(
      fake
        .callsOf('uniform3fv')
        .filter((call) => (call.args[0] as { name: string }).name.startsWith('uRibbon'))
        .map((call) => [(call.args[0] as { name: string }).name, [...(call.args[1] as Float32Array)]] as const),
    );
    // Float32Array を通るので、比較は 255 倍して整数へ戻してから行う
    const asBytes = (values: readonly number[] | undefined): number[] =>
      (values ?? []).map((v) => Math.round(v * 255));
    expect(asBytes(found.get('uRibbonCore'))).toEqual([...KEY_COLORS.white]);
    expect(asBytes(found.get('uRibbonLead'))).toEqual([...KEY_COLORS.titlePink]);
    expect(asBytes(found.get('uRibbonTrail'))).toEqual([...KEY_COLORS.sky]);
  });

  it('切替していない間は帯も乱れも出ない（uGlitch = 0）', () => {
    const { fake, pipeline } = setupCompose(() => 1, [['uGlitch', FLOAT]]);
    pipeline.render({ generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    expect(lastFloat(fake, 'uGlitch')).toBe(0);
  });

  it('光過敏への配慮で乱れを 0 にすると、切替中でも帯が出ない（KV-08 / GAME_PLAN §13）', () => {
    const { fake, pipeline } = setupCompose(() => 0, [['uGlitch', FLOAT]]);
    pipeline.render(
      { generation: 'SFC', from: 'FC', blend: 0.5, screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      () => {},
    );
    expect(lastFloat(fake, 'uGlitch')).toBe(0);
  });

  it('切替の最中は帯が出る（uGlitch > 0）', () => {
    const { fake, pipeline } = setupCompose(() => 1, [['uGlitch', FLOAT]]);
    pipeline.render(
      { generation: 'SFC', from: 'FC', blend: 0.5, screenWidth: 640, screenHeight: 480, timeSeconds: 0 },
      () => {},
    );
    expect(lastFloat(fake, 'uGlitch')).toBe(1);
  });

  it('crtOverride が CRT パスの uniform に届く（BR-05）', () => {
    unsealShaderCompilation();
    const fake = createFakeGL();
    for (const name of ['uMask', 'uCurvature', 'uScanline']) {
      fake.uniforms.push({ name, type: FLOAT, size: 1 });
    }
    // モアレ切 + 平面化入。上書きしない項目はプリセットのまま通ること
    const pipeline = createPipeline(fake.ctx, {
      quality: () => 'full',
      crtOverride: () => ({ mask: 0, curvature: 0 }),
    });
    pipeline.render({ generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    expect(lastFloat(fake, 'uMask')).toBe(0);
    expect(lastFloat(fake, 'uCurvature')).toBe(0);
    expect(lastFloat(fake, 'uScanline')).toBe(SIGNAL_PRESETS.rf.scanline);
  });

  it('crtOverride を渡さなければプリセットがそのまま通る', () => {
    unsealShaderCompilation();
    const fake = createFakeGL();
    for (const name of ['uMask', 'uCurvature']) fake.uniforms.push({ name, type: FLOAT, size: 1 });
    const pipeline = createPipeline(fake.ctx, { quality: () => 'full' });
    pipeline.render({ generation: 'FC', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    expect(lastFloat(fake, 'uMask')).toBe(SIGNAL_PRESETS.rf.mask);
    expect(lastFloat(fake, 'uCurvature')).toBe(SIGNAL_PRESETS.rf.curvature);
  });

  it('CRT 品質 Off でも出力先に必ず書かれる（present パス）', () => {
    const { fake, pipeline } = setup('off');
    fake.calls.length = 0;
    pipeline.render({ generation: 'PS2', screenWidth: 640, screenHeight: 480, timeSeconds: 0 }, () => {});
    // シーン描画 0 + present 1 + compose 1
    expect(fake.callsOf('drawArrays').length).toBeGreaterThanOrEqual(2);
  });
});
