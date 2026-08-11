import type { GenerationId, RenderFrame, Vec2 } from '@console-chaos/engine';
import { racingTheme } from '../config/themes';
import type { RaceState } from '../gameplay/race';
import { createGen1RasterPresenter, type Gen1RasterPresenter } from './gen1-raster';
import { buildGen2AffineFrame } from './gen2-affine';
import { buildGen3LowPolyFrame } from './gen3-low-poly';
import { buildGen4EnvironmentFrame } from './gen4-environment';
import { createRaceVisualState } from './visual-state';

const THREE_D_GENERATIONS = ['PS1', 'PS2'] as const;

function roadSegment(
  frame: RenderFrame,
  start: Vec2,
  end: Vec2,
  index: number,
  state: RaceState,
  generation: GenerationId,
  road: string,
  edge: string,
): void {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const heading = -Math.atan2(dz, dx);
  const middle: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  frame.meshes.push({
    id: `${generation}-track-${index}`,
    generations: [generation],
    geometry: { kind: 'box' },
    transform: { position: [middle[0], 0, middle[1]], rotationY: heading, scale: [length, 0.12, state.track.halfWidth * 2] },
    color: road,
    material: `racing-solid-${generation}`,
    layer: 0,
  });
  const normal: Vec2 = [-dz / length, dx / length];
  for (const side of [-1, 1]) {
    frame.meshes.push({
      id: `${generation}-track-edge-${index}-${side}`,
      generations: [generation],
      geometry: { kind: 'box' },
      transform: {
        position: [middle[0] + normal[0] * state.track.halfWidth * side, 0.08, middle[1] + normal[1] * state.track.halfWidth * side],
        rotationY: heading,
        scale: [length, 0.1, 0.16],
      },
      color: edge,
      material: `racing-solid-${generation}`,
      layer: 1,
    });
  }
}

function buildThreeDimensionalCourse(frame: RenderFrame, state: RaceState, generation: GenerationId): void {
  const theme = racingTheme(generation);
  frame.backgrounds.push({ color: theme.ground, secondaryColor: theme.sky, generations: [generation] });
  frame.materials.push({
    id: `racing-solid-${generation}`,
    generations: [generation],
    ambient: 0.72,
    diffuse: 0.28,
    filter: generation === 'PS1' ? 'nearest' : 'linear',
  });
  state.track.points.forEach((start, index) => {
    roadSegment(
      frame,
      start,
      state.track.points[(index + 1) % state.track.points.length] ?? start,
      index,
      state,
      generation,
      theme.road,
      theme.roadEdge,
    );
  });
  state.track.checkpoints.forEach((checkpoint, index) => {
    frame.meshes.push({
      id: `${generation}-checkpoint-${index}`,
      generations: [generation],
      geometry: { kind: 'box' },
      transform: { position: [checkpoint[0], 0.13, checkpoint[1]], scale: [index === 0 ? 1.2 : 0.7, 0.1, index === 0 ? 1.2 : 0.7] },
      color: index === state.player.laps.nextCheckpoint ? theme.checkpoint : '#ffffff',
      material: `racing-solid-${generation}`,
      layer: 2,
    });
  });
}

export interface RacingPresentation {
  readonly gen1: Gen1RasterPresenter;
  build(frame: RenderFrame, state: RaceState): void;
}

export function createRacingPresentation(): RacingPresentation {
  const gen1 = createGen1RasterPresenter();
  return {
    gen1,
    build(frame, state): void {
      const player = state.player.car;
      const forward: Vec2 = [Math.cos(player.heading), Math.sin(player.heading)];
      frame.timeSeconds = state.tick / 60;
      frame.camera = {
        projection: 'perspective',
        position: [player.position[0] - forward[0] * 9, 4.2, player.position[1] - forward[1] * 9],
        target: [player.position[0] + forward[0] * 7, 0.55, player.position[1] + forward[1] * 7],
        zoom: 14,
        fovDegrees: 57,
      };
      const visual = createRaceVisualState(state);
      gen1.build(frame, visual);
      buildGen2AffineFrame(frame, visual);
      for (const generation of THREE_D_GENERATIONS) buildThreeDimensionalCourse(frame, state, generation);
      buildGen3LowPolyFrame(frame, state);
      buildGen4EnvironmentFrame(frame, state);
    },
  };
}
