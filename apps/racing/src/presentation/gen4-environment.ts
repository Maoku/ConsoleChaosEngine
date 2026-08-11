import type { RenderFrame } from '@console-chaos/engine';
import type { RaceState, RacerState } from '../gameplay/race';

export const GEN4_CAR_MODEL = 'assets/gen4/models/car.glb';
export const GEN4_CAR_TEXTURE = 'assets/gen4/textures/car_base_color.png';
export const GEN4_ENVIRONMENT = 'assets/gen4/environment/circuit.png';
export const GEN4_CAR_MATERIAL = 'gen4-car';

function pushCar(frame: RenderFrame, racer: RacerState, player: boolean): void {
  frame.meshes.push({
    id: `PS2-${racer.id}`,
    generations: ['PS2'],
    geometry: { kind: 'box' },
    asset: GEN4_CAR_MODEL,
    transform: {
      position: [racer.car.position[0], 0.41, racer.car.position[1]],
      rotationY: -racer.car.heading + Math.PI,
      scale: [1.5, 1.5, 1.5],
    },
    color: player ? '#ffffff' : '#667890',
    material: GEN4_CAR_MATERIAL,
    castShadow: true,
    groundY: 0.1,
    layer: 10,
  });
}

export function buildGen4EnvironmentFrame(frame: RenderFrame, state: RaceState): void {
  frame.materials.push({
    id: GEN4_CAR_MATERIAL,
    generations: ['PS2'],
    baseColorTexture: GEN4_CAR_TEXTURE,
    topColorTexture: GEN4_CAR_TEXTURE,
    colorFactor: [1, 1, 1, 1],
    environmentTexture: GEN4_ENVIRONMENT,
    environmentStrength: 0.32,
    filter: 'linear',
    ambient: 0.34,
    diffuse: 0.66,
    castShadow: true,
  });
  frame.lights.push(
    {
      id: 'ps2-coast-ambient',
      generations: ['PS2'],
      kind: 'ambient',
      position: [0, 0, 0],
      color: '#d6e9ff',
      intensity: 0.72,
      radius: 0,
    },
    {
      id: 'ps2-coast-sun',
      generations: ['PS2'],
      kind: 'directional',
      position: [0, 0, 0],
      direction: [-0.45, 0.82, 0.36],
      color: '#fff0d0',
      intensity: 0.92,
      radius: 0,
    },
    {
      id: 'ps2-track-bounce',
      generations: ['PS2'],
      kind: 'point',
      position: [
        state.player.car.position[0] + Math.cos(state.player.car.heading) * 4,
        2.2,
        state.player.car.position[1] + Math.sin(state.player.car.heading) * 4,
      ],
      color: '#ffd9a0',
      intensity: 0.65,
      radius: 8,
    },
  );
  pushCar(frame, state.player, true);
  for (const opponent of state.opponents) pushCar(frame, opponent, false);
}
