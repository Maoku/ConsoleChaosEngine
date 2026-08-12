import { describe, expect, it } from 'vitest';
import {
  createGameHost,
  createNullAudioService,
  createRenderFrame,
  type GenerationId,
} from '@console-chaos/engine';
import { createManualLoopHost, createRecordingRenderer } from '@console-chaos/engine-testkit';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { createSession } from '@/gameplay/session';
import { createConsoleChaosPresentation, hardwareBlendForMaterial } from '@/presentation/frame';
import { MATERIALS } from '@/render/material';
import { loadLevelFile } from './replay/harness';

const level = loadLevelFile('area1');

function setup(generation: GenerationId, spawn?: [number, number, number]) {
  const host = createGameHost({
    loopHost: createManualLoopHost(),
    renderer: createRecordingRenderer(),
    audio: createNullAudioService(),
    initialGeneration: generation,
  });
  const session = createSession({
    level,
    world: host.context.world,
    generation: host.context.generation,
    ...(spawn ? { spawn } : {}),
  });
  const presentation = createConsoleChaosPresentation(level);
  const frame = createRenderFrame();
  const tick = (): void => {
    session.tick(createNeutralConsoleChaosActions());
    presentation.fixedUpdate(session);
  };
  const build = () => {
    frame.reset();
    presentation.build(frame, session, host.context);
    return frame;
  };
  return { host, session, presentation, tick, build };
}

describe('Console presentation parity commands', () => {
  it('keeps all legacy material fields and generation-specific assets', () => {
    const { host, tick, build } = setup('PS1');
    tick();
    const frame = build();
    const platform = frame.materials.find((material) => material.id === 'material:start_floor_a:PS1');
    expect(platform).toMatchObject({
      baseColorTexture: 'assets/textures/gen3/stone_wall.png',
      topColorTexture: 'assets/textures/gen3/grass_top.png',
      uvScale: 0.5,
      alphaCutoff: 0,
      ambient: 0.45,
      diffuse: 0.55,
      polygonSort: false,
      floatAmplitude: 0,
      uvScrollY: 0,
    });
    expect(frame.backgrounds.filter((background) => background.generations?.includes('PS1'))).toHaveLength(2);
    expect(frame.sprites.map((sprite) => sprite.generations?.[0])).toEqual(['FC', 'SFC']);
    expect(frame.skinnedMeshes.map((mesh) => mesh.generations?.[0])).toEqual(['PS1', 'PS2']);
    expect(frame.skinnedMeshes.find((mesh) => mesh.id === 'player:PS1')?.orderTableIndex).toBe(9);
    expect(frame.skinnedMeshes.find((mesh) => mesh.id === 'player:PS2')?.orderTableIndex).toBeUndefined();
    host.dispose();
  });

  it('maps translucent content to each generation hardware family', () => {
    const material = MATERIALS.translucent!;
    expect(hardwareBlendForMaterial(material, 'FC')).toBeUndefined();
    expect(hardwareBlendForMaterial(material, 'SFC')).toEqual({
      family: 'gen2-color-math', operation: 'add', half: true, operand: 'subscreen',
    });
    expect(hardwareBlendForMaterial(material, 'PS1')).toEqual({
      family: 'gen3-semitransparency', mode: 'average',
    });
    expect(hardwareBlendForMaterial(material, 'PS2')).toEqual({
      family: 'gen4-gs', preset: 'source-over',
    });
  });

  it('uses live body positions and preserves the three legacy visibility reasons', () => {
    const fc = setup('FC');
    fc.tick();
    const body = fc.session.bodies().get('start_floor_a')!;
    body.position[0] += 3;
    const frame = fc.build();
    expect(frame.meshes.find((mesh) => mesh.id === 'start_floor_a:FC')?.transform.position[0]).toBe(body.position[0]);
    expect(frame.meshes.find((mesh) => mesh.id === 's1_platform:FC')?.visible).toBe(false);
    expect(frame.meshes.find((mesh) => mesh.id === 'f1_braid:FC')?.visible).toBe(true);
    expect(frame.meshes.find((mesh) => mesh.id === 'f1_vine_a:FC')?.visible).toBe(false);
    fc.host.dispose();

    const ps1 = setup('PS1');
    ps1.tick();
    const later = ps1.build();
    expect(later.meshes.find((mesh) => mesh.id === 's1_platform:PS1')?.visible).toBe(true);
    expect(later.meshes.find((mesh) => mesh.id === 'f1_braid:PS1')?.visible).toBe(false);
    expect(later.meshes.find((mesh) => mesh.id === 'f1_vine_a:PS1')?.visible).toBe(true);
    ps1.host.dispose();
  });

  it('reproduces camera, animation, rotating plane, light, and dark-room fade', () => {
    const sfc = setup('SFC');
    sfc.session.player.grounded = true;
    sfc.session.player.velocity = [2, 0, 0];
    sfc.presentation.fixedUpdate(sfc.session);
    const frame = sfc.build();
    expect(frame.camera.projection).toBe('orthographic');
    expect(frame.camera.orthoHeight).toBe(7);
    expect(frame.meshes.filter((mesh) => mesh.id.startsWith('affine-plane:'))).toHaveLength(4);
    expect(frame.sprites.find((sprite) => sprite.id === 'player:SFC')?.cell).not.toBe(12);
    sfc.host.dispose();

    const ps2 = setup('PS2', [103, -3.5, 0]);
    for (let index = 0; index < 30; index++) ps2.tick();
    const dark = ps2.build();
    expect(dark.camera.position[0]).toBeLessThan(ps2.session.player.position[0]);
    expect(dark.camera.target[0]).toBeGreaterThan(ps2.session.player.position[0]);
    expect(dark.lights).toHaveLength(1);
    expect(dark.backgrounds.find((background) => !background.texture && background.generations?.includes('PS2'))?.brightness).toBe(0);
    ps2.host.dispose();
  });
});
