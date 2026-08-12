import {
  GENERATION_IDS,
  type GameModule,
  type GenerationId,
  type HardwareBlendCommand,
  type HardwareGenerationProfile,
  type RenderFrame,
} from '@console-chaos/engine';
import { createConsoleChaosActionMap } from '@/config/actions';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';

export const DEBUG_SCENES = ['ps1', 'fc', 'switch', 'character', 'player', 'blend'] as const;
export type ConsoleDebugScene = typeof DEBUG_SCENES[number];

export function isConsoleDebugScene(value: string): value is ConsoleDebugScene {
  return DEBUG_SCENES.includes(value as ConsoleDebugScene);
}

export function initialGenerationForScene(scene: string): GenerationId {
  return scene === 'mini' || scene === 'ps1' || scene === 'blend' ? 'PS1' : 'FC';
}

export interface ConsoleDebugModuleOptions {
  cycleQuality(): void;
}

const CHARACTER_PARTS = [
  ['head', [0, 1.32, 0], [0.36, 0.3, 0.32], '#fadbb8'],
  ['hair', [0, 1.56, -0.02], [0.38, 0.12, 0.34], '#1f244d'],
  ['torso', [0, 0.78, 0], [0.3, 0.28, 0.2], '#e6404d'],
  ['belt', [0, 0.5, 0], [0.3, 0.06, 0.21], '#1f244d'],
  ['armL', [-0.42, 0.82, 0], [0.12, 0.26, 0.13], '#e6404d'],
  ['armR', [0.42, 0.82, 0], [0.12, 0.26, 0.13], '#e6404d'],
  ['handL', [-0.42, 0.52, 0], [0.13, 0.1, 0.14], '#fadbb8'],
  ['handR', [0.42, 0.52, 0], [0.13, 0.1, 0.14], '#fadbb8'],
  ['legL', [-0.16, 0.24, 0], [0.13, 0.24, 0.14], '#3359b3'],
  ['legR', [0.16, 0.24, 0], [0.13, 0.24, 0.14], '#3359b3'],
  ['footL', [-0.16, 0.05, 0.04], [0.15, 0.06, 0.19], '#f2e659'],
  ['footR', [0.16, 0.05, 0.04], [0.15, 0.06, 0.19], '#f2e659'],
] as const;

const FC_COLORS = ['#0f1026', '#2e3172', '#ed3f60', '#f4b942', '#71c562', '#50b7d2', '#f1f1dc', '#8c5e3c'];

function textureFor(generation: GenerationId): string {
  return `assets/textures/${CONSOLE_CHAOS_GENERATION_THEMES[generation].art.textureSet}/stone_floor.png`;
}

function pushTestFloor(frame: RenderFrame, generation: GenerationId, panel: boolean): void {
  frame.materials.push({
    id: 'debug-checker',
    baseColorTexture: textureFor(generation),
    filter: 'nearest',
    uvMode: 'affine',
    ambient: 0.45,
    diffuse: 0.55,
  });
  frame.meshes.push({
    id: 'debug-floor',
    geometry: { kind: 'quad', halfSize: [1, 1], uvRepeat: [16, 16] },
    transform: { position: [0, 0, -18], scale: [4, 1, 22] },
    color: '#ffffff',
    material: 'debug-checker',
  });
  if (panel) {
    frame.meshes.push({
      id: 'debug-panel',
      geometry: { kind: 'box' },
      transform: { position: [0, 1.5, -6], scale: [4, 3, 0.2] },
      color: '#ffffff',
      material: 'debug-checker',
    });
  }
}

function debugHardwareBlend(hardware: HardwareGenerationProfile): HardwareBlendCommand | undefined {
  switch (hardware.video.translucency.kind) {
    case 'none':
      return undefined;
    case 'color-math':
      return { family: 'gen2-color-math', operation: 'add', half: true, operand: 'subscreen' };
    case 'fixed-rate':
      return { family: 'gen3-semitransparency', mode: 'average' };
    case 'gs-alpha':
      return { family: 'gen4-gs', preset: 'source-over' };
  }
}

function pushBlendScene(frame: RenderFrame, hardware: HardwareGenerationProfile, time: number): void {
  const generation = hardware.id;
  const hardwareBlend = debugHardwareBlend(hardware);
  const usesOrderingTable = hardware.video.translucency.kind === 'fixed-rate';
  frame.camera = {
    projection: hardware.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
    position: [0, 2.4, 7],
    target: [0, 1.1, -5],
    zoom: 8,
    orthoHeight: 8,
    fovDegrees: 55,
  };
  frame.backgrounds.push({ color: '#101a35', secondaryColor: '#412c65' });
  frame.materials.push({
    id: 'debug-blend-backdrop',
    generations: [generation],
    colorFactor: [0.15, 0.45, 0.95, 1],
    ambient: 1,
    diffuse: 0,
  });
  frame.materials.push({
    id: 'debug-blend-panel',
    generations: [generation],
    colorFactor: [1, 0.28, 0.08, 0.66],
    ...(hardwareBlend ? { hardwareBlend } : {}),
    ambient: 1,
    diffuse: 0,
  });
  frame.meshes.push({
    id: `debug-blend-backdrop:${generation}`,
    generations: [generation],
    geometry: { kind: 'box' },
    transform: { position: [0, 1.1, -5.6], scale: [5.4, 3.8, 0.3] },
    color: '#ffffff',
    material: 'debug-blend-backdrop',
    ...(usesOrderingTable ? { orderTableIndex: 2 as const } : {}),
  });
  frame.meshes.push({
    id: `debug-blend-panel:${generation}`,
    generations: [generation],
    geometry: { kind: 'box' },
    transform: { position: [Math.sin(time) * 0.45, 1.1, -4.8], rotationY: time * 0.3, scale: [3, 2.4, 0.3] },
    color: '#ffffff',
    material: 'debug-blend-panel',
    ...(usesOrderingTable ? { orderTableIndex: 9 as const } : {}),
  });

  const spriteBlend = hardwareBlend;
  frame.sprites.push({
    id: `debug-world-sprite:${generation}`,
    generations: [generation],
    position: [-1.25, 1.1, -4.25],
    size: [1.9, 1.9],
    color: '#ffffff',
    texture: 'assets/sprites/hero_gen2.png',
    atlas: 'hero_gen2.png',
    cell: 12,
    alphaCutoff: 0.5,
    ...(spriteBlend ? { hardwareBlend: spriteBlend } : {}),
    billboard: hardware.video.depthBuffer ? 'spherical' : 'cylindrical',
    depthWrite: hardware.video.depthBuffer,
    ...(usesOrderingTable ? { orderTableIndex: 10 as const } : {}),
  });
  frame.sprites.push({
    id: `debug-screen-sprite:${generation}`,
    generations: [generation],
    screenSpace: true,
    position: [hardware.video.internalWidth - 28, 28, 0],
    size: [44, 44],
    color: '#ffffff',
    texture: 'assets/sprites/hero_gen2.png',
    atlas: 'hero_gen2.png',
    cell: 13,
    alphaCutoff: 0.5,
    ...(spriteBlend ? { hardwareBlend: spriteBlend } : {}),
    depthWrite: false,
    ...(usesOrderingTable ? { orderTableIndex: 11 as const } : {}),
  });
}

function buildScene(
  frame: RenderFrame,
  scene: ConsoleDebugScene,
  hardware: HardwareGenerationProfile,
  time: number,
  yaw: number,
  playerClip: string,
): void {
  const generation = hardware.id;
  frame.timeSeconds = time;
  frame.materials.push({ id: 'debug-solid', ambient: 0.65, diffuse: 0.35 });
  if (scene === 'blend') {
    pushBlendScene(frame, hardware, time);
    return;
  }
  if (scene === 'ps1' || scene === 'switch') {
    frame.camera = {
      projection: 'perspective',
      position: [Math.sin(time * 0.7) * 0.6, 2.2, 7],
      target: [0, 1.2, -8],
      zoom: 8,
      fovDegrees: 55,
    };
    frame.backgrounds.push({ color: '#05050d' });
    pushTestFloor(frame, generation, scene === 'switch');
    return;
  }

  if (scene === 'fc') {
    frame.camera = { projection: 'orthographic', position: [0, 10, 8], target: [0, 0, 0], zoom: 12, orthoHeight: 12 };
    frame.backgrounds.push({ color: '#111126', secondaryColor: '#45609a' });
    for (let index = 0; index < 48; index++) {
      const x = (index % 8) - 3.5;
      const z = Math.floor(index / 8) - 2.5;
      frame.meshes.push({
        id: `fc-color-${index}`,
        geometry: { kind: 'box' },
        transform: { position: [x, Math.sin(time + index) * 0.15, z], scale: [0.9, 0.4, 0.9] },
        color: FC_COLORS[index % FC_COLORS.length]!,
        material: 'debug-solid',
      });
    }
    return;
  }

  frame.camera = { projection: hardware.video.projection === 'ortho2d' ? 'orthographic' : 'perspective', position: [0, 1, 3.2], target: [0, 1, 0], zoom: 2.6, orthoHeight: 2.6 };
  frame.backgrounds.push({ color: '#293357' });
  if (scene === 'player') {
    frame.skinnedMeshes.push({
      id: 'debug-player',
      model: 'assets/models/player.gltf',
      clip: playerClip,
      animationTime: time,
      transform: { position: [0, 0, 0], rotationY: yaw },
      tint: '#ffffff',
    });
    return;
  }
  for (const [id, center, half, color] of CHARACTER_PARTS) {
    frame.meshes.push({
      id: `debug-character-${id}`,
      geometry: { kind: 'box' },
      transform: {
        position: center,
        rotationY: yaw,
        scale: [half[0] * 2, half[1] * 2, half[2] * 2],
      },
      color,
      material: 'debug-solid',
    });
  }
}

export function createConsoleDebugModule(scene: ConsoleDebugScene, options: ConsoleDebugModuleOptions): GameModule {
  return {
    id: `console-debug-${scene}`,
    async create(context) {
      const actions = createConsoleChaosActionMap();
      let time = 0;
      let yaw = 0.5;
      let playerClip = 'idle';
      let previousKeys = new Set<string>();
      return {
        prepareFixedUpdate({ dtMs }): void {
          const snapshot = actions.sample(context.input.snapshot, context.generation.profile, dtMs);
          const direct = [snapshot.switch1, snapshot.switch2, snapshot.switch3, snapshot.switch4]
            .findIndex((button) => button.pressed);
          if (direct >= 0) context.generation.request(GENERATION_IDS[direct] ?? context.generation.generation);
          if (snapshot.switchPrevious.pressed) context.generation.cycle(-1);
          if (snapshot.switchNext.pressed) context.generation.cycle(1);
          const keys = context.input.snapshot.keys;
          if (keys.has('KeyQ') && !previousKeys.has('KeyQ')) options.cycleQuality();
          if (keys.has('KeyX') && !previousKeys.has('KeyX')) {
            playerClip = playerClip === 'idle' ? 'walk' : playerClip === 'walk' ? 'jump' : 'idle';
          }
          previousKeys = new Set(keys);
          yaw += snapshot.move[0] * dtMs * 0.001;
        },
        fixedUpdate({ dtMs }): void {
          time += dtMs / 1000;
        },
        buildRenderFrame(frame): void {
          buildScene(frame, scene, context.generation.profile, time, yaw, playerClip);
        },
        dispose(): void {
          previousKeys.clear();
          actions.reset();
        },
      };
    },
  };
}
