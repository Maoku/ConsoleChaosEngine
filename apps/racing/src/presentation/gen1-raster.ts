import type { RenderFrame, SpriteCommand } from '@console-chaos/engine';
import type { RaceVisualRacer, RaceVisualState } from './visual-state';

export const GEN1_BACKGROUND = 'assets/gen1/backgrounds/coast.png';
export const GEN1_ROAD = 'assets/gen1/road/road.png';
export const GEN1_CAR_ATLAS = 'assets/gen1/sprites/cars.png';

export const GEN1_SURFACE_RECT = [0, 80, 256, 144] as const;

export interface Gen1RasterInput {
  readonly courseProgress: number;
  readonly speed: number;
  readonly curveAhead: number;
  readonly headingError: number;
  readonly lateralOffset: number;
  readonly offTrackRatio: number;
  readonly timeSeconds: number;
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}

export function fillGen1Scanlines(target: Float32Array, input: Gen1RasterInput): Float32Array {
  if (target.length % 4 !== 0) throw new Error('FC scanline target must contain four values per row');
  const rows = target.length / 4;
  const speedPhase = input.timeSeconds * Math.abs(input.speed) * 0.045;
  for (let row = 0; row < rows; row++) {
    const depth = rows <= 1 ? 1 : row / (rows - 1);
    const perspective = depth * depth;
    const farWeight = 1 - perspective;
    const index = row * 4;
    target[index] = 0.5
      + input.curveAhead * farWeight * 0.32
      + input.headingError * farWeight * 0.16
      - input.lateralOffset * perspective * 0.045;
    target[index + 1] = 1 - perspective * 0.46;
    target[index + 2] = wrap01(
      input.courseProgress * 48
      + speedPhase
      + 0.22 / (depth + 0.065),
    );
    target[index + 3] = (0.55 + perspective * 0.45) * (1 - input.offTrackRatio * 0.08);
  }
  return target;
}

function spriteCell(racer: RaceVisualRacer, player: boolean, curve: number): number {
  const angle = player ? curve * 2 : racer.relativeHeading;
  const column = angle < -0.12 ? 0 : angle > 0.12 ? 2 : 1;
  return (player ? 0 : 3) + column;
}

function screenSprite(racer: RaceVisualRacer, player: boolean, curve: number): SpriteCommand {
  if (player) {
    return {
      id: 'fc-player',
      generations: ['FC'],
      screenSpace: true,
      position: [128, 190, 0],
      size: [76, 48],
      color: '#ffffff',
      texture: GEN1_CAR_ATLAS,
      atlas: 'gen1-cars',
      cell: spriteCell(racer, true, curve),
      alphaCutoff: 0.1,
      layer: 100,
    };
  }
  const distance = Math.min(Math.max((racer.forwardDistance + 3) / 42, 0), 1);
  const scale = 1 - distance * 0.7;
  const screenX = Math.min(Math.max(
    128 + racer.lateralDistance * 7 * (1 - distance) - curve * distance * 45,
    24,
  ), 232);
  return {
    id: `fc-${racer.id}`,
    generations: ['FC'],
    screenSpace: true,
    position: [screenX, 188 - distance * 102, 0],
    size: [70 * scale, 44 * scale],
    color: '#ffffff',
    texture: GEN1_CAR_ATLAS,
    atlas: 'gen1-cars',
    cell: spriteCell(racer, false, curve),
    alphaCutoff: 0.1,
    layer: Math.round(80 - distance * 60),
  };
}

export interface Gen1RasterPresenter {
  readonly scanlines: Float32Array;
  build(frame: RenderFrame, visual: RaceVisualState): void;
}

export function createGen1RasterPresenter(): Gen1RasterPresenter {
  const scanlines = new Float32Array(GEN1_SURFACE_RECT[3] * 4);
  return {
    scanlines,
    build(frame, visual): void {
      frame.backgrounds.push(
        { color: '#0d65c6', secondaryColor: '#153a91', generations: ['FC'] },
        {
          color: '#ffffff',
          texture: GEN1_BACKGROUND,
          repeat: [1, 1],
          offset: [visual.player.courseProgress * 4 + visual.headingError * 0.1, 0],
          placement: { bottom: 0.64, height: 0.36 },
          generations: ['FC'],
        },
      );
      fillGen1Scanlines(scanlines, {
        courseProgress: visual.player.courseProgress,
        speed: visual.player.speed,
        curveAhead: visual.curveAhead,
        headingError: visual.headingError,
        lateralOffset: visual.player.trackLateralOffset,
        offTrackRatio: visual.offTrackRatio,
        timeSeconds: visual.timeSeconds,
      });
      frame.rasterSurfaces.push({
        id: 'fc-raster-road',
        generations: ['FC'],
        texture: GEN1_ROAD,
        screenRect: GEN1_SURFACE_RECT,
        scanlines,
      });
      const rivals = visual.opponents
        .filter((racer) => racer.forwardDistance > -3 && racer.forwardDistance < 45)
        .slice()
        .sort((left, right) => right.forwardDistance - left.forwardDistance);
      for (const rival of rivals) frame.sprites.push(screenSprite(rival, false, visual.curveAhead));
      frame.sprites.push(screenSprite(visual.player, true, visual.curveAhead));
    },
  };
}
