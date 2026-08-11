import type { AffineSurfaceCommand, RenderFrame, SpriteCommand } from '@console-chaos/engine';
import type { RaceVisualRacer, RaceVisualState } from './visual-state';

export const GEN2_BACKGROUND = 'assets/gen2/backgrounds/coast.png';
export const GEN2_CIRCUIT = 'assets/gen2/tiles/circuit.png';
export const GEN2_CAR_ATLAS = 'assets/gen2/sprites/cars.png';
export const GEN2_SURFACE_RECT = [0, 88, 256, 136] as const;

export function createGen2AffineCommand(visual: RaceVisualState): AffineSurfaceCommand {
  const angle = visual.headingError + visual.curveAhead * 0.45;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const stepX: readonly [number, number] = [cosine * 0.0038, -sine * 0.0038];
  const stepY: readonly [number, number] = [sine * 0.007, cosine * 0.007];
  const bottomU = 0.5 - visual.player.trackLateralOffset * 0.035;
  const bottomV = visual.player.courseProgress * 32 + visual.timeSeconds * Math.abs(visual.player.speed) * 0.018;
  return {
    id: 'sfc-affine-road',
    generations: ['SFC'],
    texture: GEN2_CIRCUIT,
    screenRect: GEN2_SURFACE_RECT,
    uvOrigin: [
      bottomU - stepX[0] * 128 - stepY[0] * GEN2_SURFACE_RECT[3],
      bottomV - stepX[1] * 128 - stepY[1] * GEN2_SURFACE_RECT[3],
    ],
    uvStepX: stepX,
    uvStepY: stepY,
    wrap: 'repeat',
  };
}

function spriteCell(racer: RaceVisualRacer, player: boolean, curve: number): number {
  const angle = player ? curve * 1.8 : racer.relativeHeading;
  const column = angle < -0.1 ? 0 : angle > 0.1 ? 2 : 1;
  return (player ? 0 : 3) + column;
}

function screenSprite(racer: RaceVisualRacer, player: boolean, curve: number): SpriteCommand {
  if (player) {
    return {
      id: 'sfc-player',
      generations: ['SFC'],
      screenSpace: true,
      position: [128, 191, 0],
      size: [82, 50],
      color: '#ffffff',
      texture: GEN2_CAR_ATLAS,
      atlas: 'gen2-cars',
      cell: spriteCell(racer, true, curve),
      alphaCutoff: 0.08,
      layer: 100,
    };
  }
  const distance = Math.min(Math.max((racer.forwardDistance + 3) / 44, 0), 1);
  const scale = 1 - distance * 0.72;
  const screenX = Math.min(Math.max(
    128 + racer.lateralDistance * 7.5 * (1 - distance) - curve * distance * 48,
    24,
  ), 232);
  return {
    id: `sfc-${racer.id}`,
    generations: ['SFC'],
    screenSpace: true,
    position: [screenX, 190 - distance * 103, 0],
    size: [74 * scale, 45 * scale],
    color: '#ffffff',
    texture: GEN2_CAR_ATLAS,
    atlas: 'gen2-cars',
    cell: spriteCell(racer, false, curve),
    alphaCutoff: 0.08,
    layer: Math.round(80 - distance * 60),
  };
}

export function buildGen2AffineFrame(frame: RenderFrame, visual: RaceVisualState): void {
  frame.backgrounds.push(
    { color: '#1598cf', secondaryColor: '#1460bc', generations: ['SFC'] },
    {
      color: '#ffffff',
      texture: GEN2_BACKGROUND,
      repeat: [1, 1],
      offset: [visual.player.courseProgress * 3 + visual.headingError * 0.08, 0],
      placement: { bottom: 0.607, height: 0.393 },
      generations: ['SFC'],
    },
  );
  frame.affineSurfaces.push(createGen2AffineCommand(visual));
  const rivals = visual.opponents
    .filter((racer) => racer.forwardDistance > -3 && racer.forwardDistance < 47)
    .slice()
    .sort((left, right) => right.forwardDistance - left.forwardDistance);
  for (const rival of rivals) frame.sprites.push(screenSprite(rival, false, visual.curveAhead));
  frame.sprites.push(screenSprite(visual.player, true, visual.curveAhead));
}
