import { affineUvAt, createRenderFrame } from '@console-chaos/engine';
import { describe, expect, it } from 'vitest';
import { createRaceState } from '@racing/gameplay/race';
import { createRacingPresentation } from '@racing/presentation/frame';
import { fillGen1Scanlines, type Gen1RasterInput } from '@racing/presentation/gen1-raster';
import { createGen2AffineCommand } from '@racing/presentation/gen2-affine';
import { createRaceVisualState } from '@racing/presentation/visual-state';

function scanlineSignature(input: Gen1RasterInput): number[] {
  const target = fillGen1Scanlines(new Float32Array(144 * 4), input);
  return [0, 48, 96, 143].flatMap((row) => Array.from(
    target.slice(row * 4, row * 4 + 4),
    (value) => Number(value.toFixed(5)),
  ));
}

describe('FC and SFC racing presentation', () => {
  it('projects RaceState without mutating gameplay state', () => {
    const state = createRaceState();
    state.tick = 91;
    state.player.car.speed = 12;
    const before = structuredClone(state);
    const visual = createRaceVisualState(state);
    expect(state).toEqual(before);
    expect(visual).toMatchObject({ tick: 91, timeSeconds: 91 / 60, rank: 1 });
    expect(visual.player.position).not.toBe(state.player.car.position);
  });

  it('keeps deterministic raster goldens for stop, straight, curves, and off-track', () => {
    const base: Gen1RasterInput = {
      courseProgress: 0.25,
      speed: 0,
      curveAhead: 0,
      headingError: 0,
      lateralOffset: 0,
      offTrackRatio: 0,
      timeSeconds: 3,
    };
    expect({
      stop: scanlineSignature(base),
      straight: scanlineSignature({ ...base, speed: 18, timeSeconds: 8 }),
      left: scanlineSignature({ ...base, speed: 18, timeSeconds: 8, curveAhead: -0.55, headingError: -0.12 }),
      right: scanlineSignature({ ...base, speed: 18, timeSeconds: 8, curveAhead: 0.55, headingError: 0.12 }),
      offTrack: scanlineSignature({ ...base, speed: 8, timeSeconds: 8, lateralOffset: 4.2, offTrackRatio: 1 }),
    }).toEqual({
      stop: [0.5, 1, 0.38462, 0.55, 0.5, 0.94817, 0.54909, 0.6007, 0.5, 0.79269, 0.29878, 0.75281, 0.5, 0.54, 0.20657, 1],
      straight: [0.5, 1, 0.86462, 0.55, 0.5, 0.94817, 0.02909, 0.6007, 0.5, 0.79269, 0.77878, 0.75281, 0.5, 0.54, 0.68657, 1],
      left: [0.3048, 1, 0.86462, 0.55, 0.32679, 0.94817, 0.02909, 0.6007, 0.39277, 0.79269, 0.77878, 0.75281, 0.5, 0.54, 0.68657, 1],
      right: [0.6952, 1, 0.86462, 0.55, 0.67321, 0.94817, 0.02909, 0.6007, 0.60723, 0.79269, 0.77878, 0.75281, 0.5, 0.54, 0.68657, 1],
      offTrack: [0.5, 1, 0.26462, 0.506, 0.47871, 0.94817, 0.42909, 0.55265, 0.41482, 0.79269, 0.17878, 0.69258, 0.311, 0.54, 0.08657, 0.92],
    });
  });

  it('reuses the FC scanline buffer across frames', () => {
    const presentation = createRacingPresentation();
    const state = createRaceState();
    const frame = createRenderFrame();
    presentation.build(frame, state);
    const first = frame.rasterSurfaces[0]?.scanlines;
    frame.reset();
    state.tick++;
    presentation.build(frame, state);
    expect(frame.rasterSurfaces[0]?.scanlines).toBe(first);
    expect(first).toBe(presentation.gen1.scanlines);
  });

  it('derives the SFC affine transform from heading and progress', () => {
    const state = createRaceState();
    const straight = createGen2AffineCommand(createRaceVisualState(state));
    state.player.car.heading += 0.4;
    state.player.laps.totalProgress = 0.2;
    state.tick = 60;
    const turned = createGen2AffineCommand(createRaceVisualState(state));
    expect(turned.uvStepX).not.toEqual(straight.uvStepX);
    expect(turned.uvOrigin).not.toEqual(straight.uvOrigin);
    const centre = affineUvAt(turned, [128, 68]);
    expect(centre.every(Number.isFinite)).toBe(true);
  });

  it('emits both 2D generations and masked 3D placeholders in one frame', () => {
    const frame = createRenderFrame();
    createRacingPresentation().build(frame, createRaceState());
    expect(frame.rasterSurfaces).toHaveLength(1);
    expect(frame.affineSurfaces).toHaveLength(1);
    expect(frame.rasterSurfaces[0]?.generations).toEqual(['FC']);
    expect(frame.affineSurfaces[0]?.generations).toEqual(['SFC']);
    expect(frame.sprites.filter((sprite) => sprite.generations?.includes('FC'))).toHaveLength(2);
    expect(frame.sprites.filter((sprite) => sprite.generations?.includes('SFC'))).toHaveLength(2);
    expect(frame.sprites.every((sprite) => sprite.screenSpace)).toBe(true);
    expect(frame.meshes.every((mesh) => mesh.generations?.includes('PS1') || mesh.generations?.includes('PS2'))).toBe(true);
    expect(frame.meshes.filter((mesh) => mesh.id.startsWith('PS1-checkpoint-')).every((mesh) => mesh.orderTableIndex === 1)).toBe(true);
    expect(frame.meshes.filter((mesh) => mesh.id.startsWith('PS1-') && !mesh.id.includes('track') && !mesh.id.includes('checkpoint')).every((mesh) => (
      mesh.polygonSortRange?.[0] === 2 && mesh.polygonSortRange[1] === 7
    ))).toBe(true);
    expect(frame.overlays).toHaveLength(0);
  });
});
