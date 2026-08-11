import type { GameContext, RenderFrame, Vec2 } from '@console-chaos/engine';
import { racingTheme } from '../config/themes';
import type { RacerState, RaceState } from '../gameplay/race';

function carCommand(frame: RenderFrame, racer: RacerState, color: string): void {
  frame.meshes.push({
    id: racer.id,
    geometry: { kind: 'box' },
    transform: {
      position: [racer.car.position[0], 0.48, racer.car.position[1]],
      rotationY: -racer.car.heading,
      scale: [2.35, 0.75, 1.35],
    },
    color,
    material: 'racing-solid',
    layer: 10,
  });
}

function roadSegment(frame: RenderFrame, start: Vec2, end: Vec2, index: number, state: RaceState, road: string, edge: string): void {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const heading = -Math.atan2(dz, dx);
  const middle: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  frame.meshes.push({
    id: `track-${index}`,
    geometry: { kind: 'box' },
    transform: { position: [middle[0], 0, middle[1]], rotationY: heading, scale: [length, 0.12, state.track.halfWidth * 2] },
    color: road,
    material: 'racing-solid',
    layer: 0,
  });
  const normal: Vec2 = [-dz / length, dx / length];
  for (const side of [-1, 1]) {
    frame.meshes.push({
      id: `track-edge-${index}-${side}`,
      geometry: { kind: 'box' },
      transform: {
        position: [middle[0] + normal[0] * state.track.halfWidth * side, 0.08, middle[1] + normal[1] * state.track.halfWidth * side],
        rotationY: heading,
        scale: [length, 0.1, 0.16],
      },
      color: edge,
      material: 'racing-solid',
      layer: 1,
    });
  }
}

export function buildRacingFrame(frame: RenderFrame, state: RaceState, context: GameContext): void {
  const profile = context.generation.profile;
  const theme = racingTheme(profile.id);
  const player = state.player.car;
  const forward: Vec2 = [Math.cos(player.heading), Math.sin(player.heading)];
  const cameraDistance = profile.video.projection === 'ortho2d' ? 13 : 10;
  frame.timeSeconds = state.tick / 60;
  frame.camera = {
    projection: profile.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
    position: [player.position[0] - forward[0] * cameraDistance, 7.5, player.position[1] - forward[1] * cameraDistance],
    target: [player.position[0] + forward[0] * 7, 0, player.position[1] + forward[1] * 7],
    zoom: theme.cameraZoom,
    orthoHeight: 18,
    fovDegrees: 57,
  };
  frame.backgrounds.push({ color: theme.ground, secondaryColor: theme.sky });
  frame.materials.push({ id: 'racing-solid', ambient: 0.72, diffuse: 0.28, filter: profile.video.textureFilter });
  state.track.points.forEach((start, index) => {
    roadSegment(frame, start, state.track.points[(index + 1) % state.track.points.length] ?? start, index, state, theme.road, theme.roadEdge);
  });
  state.track.checkpoints.forEach((checkpoint, index) => {
    frame.meshes.push({
      id: `checkpoint-${index}`,
      geometry: { kind: 'box' },
      transform: { position: [checkpoint[0], 0.13, checkpoint[1]], scale: [index === 0 ? 1.2 : 0.7, 0.1, index === 0 ? 1.2 : 0.7] },
      color: index === state.player.laps.nextCheckpoint ? theme.checkpoint : '#ffffff',
      material: 'racing-solid',
      layer: 2,
    });
  });
  carCommand(frame, state.player, theme.player);
  for (const opponent of state.opponents) carCommand(frame, opponent, theme.opponent);
}
