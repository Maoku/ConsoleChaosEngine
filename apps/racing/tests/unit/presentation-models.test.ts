import { readFileSync } from 'node:fs';
import { createRenderFrame } from '@console-chaos/engine';
import { describe, expect, it } from 'vitest';
import { createRaceState } from '@racing/gameplay/race';
import { createRacingPresentation } from '@racing/presentation/frame';
import { GEN3_CAR_MATERIAL, GEN3_CAR_MODEL } from '@racing/presentation/gen3-low-poly';
import {
  GEN4_CAR_MATERIAL,
  GEN4_CAR_MODEL,
  GEN4_ENVIRONMENT,
} from '@racing/presentation/gen4-environment';

describe('PS1 and PS2 racing presentation', () => {
  it('uses converted source geometry instead of box car fallbacks', () => {
    const frame = createRenderFrame();
    createRacingPresentation().build(frame, createRaceState());
    const ps1Cars = frame.meshes.filter((mesh) => mesh.asset === GEN3_CAR_MODEL);
    const ps2Cars = frame.meshes.filter((mesh) => mesh.asset === GEN4_CAR_MODEL);
    expect(ps1Cars).toHaveLength(2);
    expect(ps2Cars).toHaveLength(2);
    expect(ps1Cars.every((mesh) => mesh.generations?.includes('PS1'))).toBe(true);
    expect(ps2Cars.every((mesh) => mesh.generations?.includes('PS2'))).toBe(true);
    expect(frame.meshes.filter((mesh) => mesh.id.endsWith('-player')).every((mesh) => mesh.asset)).toBe(true);
  });

  it('confines polygon sorting to PS1 and reflection/light commands to PS2', () => {
    const frame = createRenderFrame();
    createRacingPresentation().build(frame, createRaceState());
    const ps1 = frame.materials.find((material) => material.id === GEN3_CAR_MATERIAL);
    const ps2 = frame.materials.find((material) => material.id === GEN4_CAR_MATERIAL);
    expect(ps1).toMatchObject({ polygonSort: true, uvMode: 'affine', filter: 'nearest' });
    expect(ps1?.environmentTexture).toBeUndefined();
    expect(ps2).toMatchObject({
      environmentTexture: GEN4_ENVIRONMENT,
      environmentStrength: 0.32,
      filter: 'linear',
    });
    expect(frame.lights.map((light) => light.kind)).toEqual(['ambient', 'directional', 'point']);
    expect(frame.lights.every((light) => light.generations?.includes('PS2'))).toBe(true);
  });

  it('keeps model heading and dynamic light continuous with gameplay state', () => {
    const state = createRaceState();
    const first = createRenderFrame();
    createRacingPresentation().build(first, state);
    const firstRotation = first.meshes.find((mesh) => mesh.asset === GEN4_CAR_MODEL)?.transform.rotationY;
    const firstPoint = first.lights.find((light) => light.kind === 'point')?.position;
    state.player.car.heading += 0.25;
    state.player.car.position[0] += 2;
    const second = createRenderFrame();
    createRacingPresentation().build(second, state);
    expect(second.meshes.find((mesh) => mesh.asset === GEN4_CAR_MODEL)?.transform.rotationY).toBeCloseTo((firstRotation ?? 0) - 0.25);
    expect(second.lights.find((light) => light.kind === 'point')?.position).not.toEqual(firstPoint);
  });

  it('records canonical source/runtime fingerprints and asset budgets', () => {
    const manifest = JSON.parse(readFileSync(
      new URL('../../public/assets/car-conversion.json', import.meta.url),
      'utf8',
    )) as {
      records: Array<{
        generation: string;
        geometry: { triangles: number; fingerprint: string };
        runtime: { model: { bytes: number }; texture: { dimensions: number[] } };
      }>;
    };
    expect(manifest.records.map((record) => ({
      generation: record.generation,
      triangles: record.geometry.triangles,
      fingerprintLength: record.geometry.fingerprint.length,
      texture: record.runtime.texture.dimensions,
    }))).toEqual([
      { generation: 'PS1', triangles: 978, fingerprintLength: 64, texture: [256, 256] },
      { generation: 'PS2', triangles: 13618, fingerprintLength: 64, texture: [1024, 1024] },
    ]);
    expect(manifest.records[0]?.runtime.model.bytes).toBeLessThan(256_000);
    expect(manifest.records[1]?.runtime.model.bytes).toBeLessThan(2_000_000);
  });
});
