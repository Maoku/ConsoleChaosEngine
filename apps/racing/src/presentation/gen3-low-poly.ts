import type { RenderFrame } from '@console-chaos/engine';
import type { RaceState, RacerState } from '../gameplay/race';

export const GEN3_CAR_MODEL = 'assets/gen3/models/car.glb';
export const GEN3_CAR_TEXTURE = 'assets/gen3/textures/car_base_color.png';
export const GEN3_CAR_MATERIAL = 'gen3-car';

function pushCar(frame: RenderFrame, racer: RacerState, player: boolean): void {
  frame.meshes.push({
    id: `PS1-${racer.id}`,
    generations: ['PS1'],
    geometry: { kind: 'box' },
    asset: GEN3_CAR_MODEL,
    transform: {
      position: [racer.car.position[0], 0.4, racer.car.position[1]],
      rotationY: -racer.car.heading + Math.PI,
      scale: [1.5, 1.5, 1.5],
    },
    color: player ? '#ffffff' : '#5f708c',
    material: GEN3_CAR_MATERIAL,
    layer: 10,
  });
}

export function buildGen3LowPolyFrame(frame: RenderFrame, state: RaceState): void {
  frame.materials.push({
    id: GEN3_CAR_MATERIAL,
    generations: ['PS1'],
    baseColorTexture: GEN3_CAR_TEXTURE,
    topColorTexture: GEN3_CAR_TEXTURE,
    colorFactor: [1, 1, 1, 1],
    filter: 'nearest',
    uvMode: 'affine',
    polygonSort: true,
    ambient: 0.64,
    diffuse: 0.36,
  });
  pushCar(frame, state.player, true);
  for (const opponent of state.opponents) pushCar(frame, opponent, false);
}
