import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  TICK_SECONDS,
  applyScanlineLimit,
  type GameContext,
  type GenerationId,
  type HardwareBlendCommand,
  type RenderFrame,
  type SpriteDrawItem,
} from '@console-chaos/engine';
import {
  CONSOLE_CHAOS_GENERATION_THEMES,
  type PlayerClip,
  type PlayerClipRef,
  type PlayerSpriteProfile,
} from '@/config/generation';
import type { PlayerBodyData } from '@/gameplay/player';
import type { Session } from '@/gameplay/session';
import { planeAngleAt, S1_PIVOT } from '@/gameplay/puzzles/s1_affine_plane';
import { collidersOf } from '@/level/loader';
import { PIXELS_PER_WORLD_UNIT, type LevelEntity, type LevelFile, type Vec3Tuple } from '@/level/schema';
import { sectorAt } from '@/level/sector';
import { materialFor, type Material } from '@/render/material';
import { spriteCellOf } from '@/render/sprite_sheet';
import {
  appendColliderCommands,
  collectColliderBoxes,
  type ColliderBox,
} from '@/debug/collider_view';

const ROLE_COLORS = {
  background: '#728f62',
  platform: '#b68a58',
  gimmick: '#6ec9c8',
  enemy: '#d95b55',
  goal: '#f4dc7a',
} as const;
const FEET_OFFSET = 0.8;
const WALK_SPEED = 0.2;
const BACKDROP_FADE_SECONDS = 0.25;
const PLANE_RADIUS = 24;

export interface ConsoleChaosPresentation {
  readonly collidersEnabled: boolean;
  readonly colliderBoxes: readonly ColliderBox[];
  toggleColliders(): boolean;
  fixedUpdate(session: Session): void;
  build(frame: RenderFrame, session: Session, context: GameContext): void;
}

function interiorSectorIds(level: LevelFile): Set<string> {
  const ids = new Set<string>();
  for (const entity of level.entities) {
    if (materialFor(entity.type, entity.id).interior) ids.add(entity.sector);
  }
  return ids;
}

function groundYOf(entity: LevelEntity, candidates: readonly LevelEntity[]): number {
  const [x, y, z] = entity.transform.position;
  const half = entity.collider?.halfExtents ?? [0, 0, 0];
  let best = y - half[1];
  for (const other of candidates) {
    if (other.id === entity.id || !other.collider) continue;
    const [ox, oy, oz] = other.transform.position;
    const [ohx, ohy, ohz] = other.collider.halfExtents;
    if (Math.abs(ox - x) > ohx + half[0] || Math.abs(oz - z) > ohz + half[2]) continue;
    const top = oy + ohy;
    if (top <= y - half[1] && top > best - 1e-6) best = top;
  }
  return best;
}

function clipOf(session: Session): PlayerClip {
  const player = session.player;
  const moving = Math.abs(player.velocity[0]) > WALK_SPEED || Math.abs(player.velocity[2]) > WALK_SPEED;
  return !player.grounded ? 'jump' : moving ? 'walk' : 'idle';
}

function spriteCell(sprite: PlayerSpriteProfile, clip: PlayerClip, seconds: number): number {
  return spriteCellOf(sprite.clips[clip], seconds);
}

export type ModelJumpPhase = 'base' | 'takeoff' | 'airborne' | 'landing';

export interface ModelJumpAnimationState {
  phase: ModelJumpPhase;
  seconds: number;
  takeoffVelocity: number;
}

export function createModelJumpAnimationState(): ModelJumpAnimationState {
  return { phase: 'base', seconds: 0, takeoffVelocity: 0 };
}

function jumpTiming(clip: PlayerClipRef): {
  fps: number;
  airborneFrame: number;
  landingFrame: number;
  finalFrame: number;
} | null {
  const { sourceFps, airborneFrame, landingFrame, frameCount } = clip;
  if (!sourceFps || !airborneFrame || !landingFrame || !frameCount) return null;
  return {
    fps: sourceFps,
    airborneFrame,
    landingFrame,
    finalFrame: frameCount,
  };
}

/** 物理状態を Regular_Jump の離陸・24フレーム固定・着地区間へ写像する。 */
export function updateModelJumpAnimation(
  state: ModelJumpAnimationState,
  player: Pick<PlayerBodyData, 'grounded' | 'velocity'>,
  clip: PlayerClipRef,
  dtSeconds = TICK_SECONDS,
): void {
  const timing = jumpTiming(clip);
  if (!timing) return;
  const { fps, airborneFrame, landingFrame, finalFrame } = timing;
  const takeoffStartTime = 1 / fps;
  const airborneHoldTime = airborneFrame / fps;

  if (state.phase === 'landing') {
    if (!player.grounded && player.velocity[1] > 0) {
      state.phase = 'takeoff';
      state.seconds = takeoffStartTime;
      state.takeoffVelocity = player.velocity[1];
      return;
    }
    const next = state.seconds + dtSeconds;
    if (next > finalFrame / fps + 1e-9) {
      state.phase = 'base';
      state.seconds = 0;
      state.takeoffVelocity = 0;
    } else {
      state.seconds = next;
    }
    return;
  }

  if (!player.grounded) {
    if (state.phase === 'base') {
      state.phase = player.velocity[1] > 0 ? 'takeoff' : 'airborne';
      state.seconds = state.phase === 'takeoff' ? takeoffStartTime : airborneHoldTime;
      state.takeoffVelocity = Math.max(player.velocity[1], 0);
      return;
    }
    if (state.phase === 'takeoff') {
      if (player.velocity[1] <= 0) {
        state.phase = 'airborne';
        state.seconds = airborneHoldTime;
        state.takeoffVelocity = 0;
        return;
      }
      const launchVelocity = Math.max(state.takeoffVelocity, player.velocity[1]);
      const ascentProgress = 1 - player.velocity[1] / launchVelocity;
      const synchronizedTime = takeoffStartTime
        + (airborneHoldTime - takeoffStartTime) * ascentProgress;
      state.seconds = Math.max(state.seconds, Math.min(synchronizedTime, airborneHoldTime));
      return;
    }
    state.seconds = airborneHoldTime;
    return;
  }

  if (state.phase === 'takeoff' || state.phase === 'airborne') {
    state.phase = 'landing';
    state.seconds = landingFrame / fps;
    state.takeoffVelocity = 0;
  }
}

function visibleEntity(
  session: Session,
  entity: LevelEntity,
  material: Material,
  body: { readonly solid: boolean } | undefined,
): boolean {
  if (!body) return true;
  const engineEntity = session.entities.get(entity.id);
  const culled = engineEntity !== undefined && session.culled.has(engineEntity);
  const notMaterialized = material.hideWhenPassable && !body.solid;
  const noBlend = material.translucent && session.profile.hardware.video.translucency.kind === 'none';
  return !culled && !notMaterialized && !noBlend;
}

export function hardwareBlendForMaterial(
  material: Material,
  generation: GenerationId,
): HardwareBlendCommand | undefined {
  if (!material.translucent) return undefined;
  const translucency = HARDWARE_GENERATION_PROFILES[generation].video.translucency;
  switch (translucency.kind) {
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

function pushMaterial(
  frame: RenderFrame,
  material: Material,
  entityId: string,
  generation: GenerationId,
): string {
  const hardware = HARDWARE_GENERATION_PROFILES[generation];
  const theme = CONSOLE_CHAOS_GENERATION_THEMES[generation];
  const id = `material:${entityId}:${generation}`;
  const texture = (file: string): string => `assets/textures/${theme.art.textureSet}/${file}`;
  const hardwareBlend = hardwareBlendForMaterial(material, generation);
  frame.materials.push({
    id,
    generations: [generation],
    colorFactor: material.color,
    baseColorTexture: texture(material.texture),
    topColorTexture: texture(material.topTexture ?? material.texture),
    filter: hardware.video.textureFilter,
    ...(hardwareBlend ? { hardwareBlend } : {}),
    uvMode: hardware.video.affineTexture ? 'affine' : 'perspective',
    castShadow: material.castShadow,
    uvScale: material.uvScale,
    alphaCutoff: material.alphaCutoff,
    ambient: material.ambient,
    diffuse: material.diffuse,
    polygonSort: material.polygonSort,
    floatAmplitude: material.float,
    uvScrollY: material.uvScrollY,
  });
  return id;
}

export function createConsoleChaosPresentation(level: LevelFile): ConsoleChaosPresentation {
  const solids = collidersOf(level);
  const interiors = interiorSectorIds(level);
  const groundById = new Map(level.entities.map((entity) => [entity.id, groundYOf(entity, solids)]));
  let timeSeconds = 0;
  let animationSeconds = 0;
  let clip: PlayerClip = 'idle';
  const modelJump = createModelJumpAnimationState();
  let backdropBrightness = 1;
  let collidersEnabled = false;
  let colliderBoxes: ColliderBox[] = [];

  return {
    get collidersEnabled() {
      return collidersEnabled;
    },
    get colliderBoxes() {
      return colliderBoxes;
    },
    toggleColliders(): boolean {
      collidersEnabled = !collidersEnabled;
      if (!collidersEnabled) colliderBoxes = [];
      return collidersEnabled;
    },
    fixedUpdate(session): void {
      const video = session.profile.hardware.video;
      const halfView = video.internalHeight / (2 * PIXELS_PER_WORLD_UNIT);
      const sprites: SpriteDrawItem[] = session.sprites.map(({ entity, body }) => ({
        entity,
        y: (session.player.position[1] + halfView - (body.position[1] + body.halfExtents[1])) * PIXELS_PER_WORLD_UNIT,
        height: body.halfExtents[1] * 2 * PIXELS_PER_WORLD_UNIT,
      }));
      session.commitCulled(applyScanlineLimit(sprites, video.spritesPerScanline, video.internalHeight).culled);

      timeSeconds += TICK_SECONDS;
      const nextClip = clipOf(session);
      if (nextClip !== clip) {
        clip = nextClip;
        animationSeconds = 0;
      } else {
        animationSeconds += TICK_SECONDS;
      }
      const modelPlayer = CONSOLE_CHAOS_GENERATION_THEMES.PS1.player;
      if (modelPlayer.kind === 'model') {
        updateModelJumpAnimation(modelJump, session.player, modelPlayer.clips.jump);
      }
      const sector = sectorAt(level, session.player.position);
      const wanted = sector !== null && interiors.has(sector.id) ? 0 : 1;
      const step = TICK_SECONDS / BACKDROP_FADE_SECONDS;
      const gap = wanted - backdropBrightness;
      backdropBrightness += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
    },

    build(frame, session, context): void {
      const hardware = context.generation.profile;
      const currentTheme = CONSOLE_CHAOS_GENERATION_THEMES[context.generation.generation];
      const player = session.player;
      const forward = currentTheme.camera.forward;
      frame.timeSeconds = timeSeconds;
      frame.camera = {
        projection: hardware.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
        position: [
          player.position[0] - forward[0] * currentTheme.camera.distance,
          player.position[1] + currentTheme.camera.height,
          player.position[2] - forward[1] * currentTheme.camera.distance,
        ],
        target: [
          player.position[0] + forward[0] * currentTheme.camera.lookAhead,
          player.position[1] + currentTheme.camera.targetHeight,
          player.position[2] + forward[1] * currentTheme.camera.lookAhead,
        ],
        zoom: hardware.video.internalHeight / PIXELS_PER_WORLD_UNIT,
        orthoHeight: hardware.video.internalHeight / PIXELS_PER_WORLD_UNIT,
        fovDegrees: 55,
      };
      const backdropOffset = frame.camera.position[0] * -forward[1] + frame.camera.position[2] * forward[0];

      for (const generation of GENERATION_IDS) {
        const theme = CONSOLE_CHAOS_GENERATION_THEMES[generation];
        const backdrop = theme.art.backdrop;
        frame.backgrounds.push({
          color: `rgb(${backdrop.sky[1].join(' ')})`,
          secondaryColor: `rgb(${backdrop.sky[0].join(' ')})`,
          brightness: backdropBrightness,
          fogDensity: theme.art.fogDensity,
          generations: [generation],
        });
        for (const layer of [backdrop.far, backdrop.near]) {
          if (!layer) continue;
          frame.backgrounds.push({
            color: '#ffffff',
            texture: `assets/textures/${theme.art.textureSet}/${layer.texture}`,
            repeat: [layer.repeat, 1],
            parallax: [layer.scroll, layer.scrollY],
            offset: [backdropOffset * layer.scroll, -frame.camera.position[1] * layer.scrollY],
            placement: { bottom: layer.bottom, height: layer.height },
            brightness: backdropBrightness,
            generations: [generation],
          });
        }
      }

      const bodies = session.bodies();
      for (const entity of level.entities) {
        const material = materialFor(entity.type, entity.id);
        if (material.collisionOnly) continue;
        const body = bodies.get(entity.id);
        const position = (body?.position ?? entity.transform.position) as Vec3Tuple;
        const half = entity.collider?.halfExtents ?? entity.transform.scale ?? [1, 1, 1];
        const visible = visibleEntity(session, entity, material, body);
        for (const generation of GENERATION_IDS) {
          const materialId = pushMaterial(frame, material, entity.id, generation);
          frame.meshes.push({
            id: `${entity.id}:${generation}`,
            generations: [generation],
            geometry: material.model ? { kind: 'box' } : { kind: 'box', halfExtents: half, uvScale: material.uvScale },
            transform: material.model ? { position, scale: half } : { position },
            color: ROLE_COLORS[material.role],
            ...(material.model ? { asset: `assets/models/${material.model}.gltf` } : {}),
            material: materialId,
            castShadow: material.castShadow,
            ...(groundById.has(entity.id) ? { groundY: groundById.get(entity.id)! } : {}),
            visible,
          });
        }
      }

      const pivot = bodies.get(S1_PIVOT);
      if (hardware.video.affinePlane && pivot) for (const generation of GENERATION_IDS) {
        const material = materialFor('affine_floor');
        frame.meshes.push({
          id: `affine-plane:${generation}`,
          generations: [generation],
          geometry: { kind: 'quad', halfSize: [PLANE_RADIUS, PLANE_RADIUS], uvRepeat: [PLANE_RADIUS, PLANE_RADIUS] },
          transform: { position: pivot.position, rotationY: planeAngleAt(session.tickIndex) },
          color: ROLE_COLORS.background,
          material: pushMaterial(frame, material, 'affine-plane', generation),
          layer: -1000,
        });
      }

      const yawBase = -Math.PI / 2;
      for (const generation of GENERATION_IDS) {
        const theme = CONSOLE_CHAOS_GENERATION_THEMES[generation];
        const visual = theme.player;
        if (visual.kind === 'sprite') {
          const half = visual.worldSize / 2;
          frame.sprites.push({
            id: `player:${generation}`,
            generations: [generation],
            position: [player.position[0], player.position[1] - FEET_OFFSET + half, player.position[2]],
            size: [visual.worldSize, visual.worldSize],
            color: '#ffffff',
            texture: `assets/sprites/${visual.file}`,
            atlas: visual.file,
            cell: spriteCell(visual, clip, animationSeconds),
            flipX: session.playerState.facing < 0,
            alphaCutoff: 0.5,
          });
        } else {
          const halfTurn = visual.front === '+Z' ? Math.PI : 0;
          const modelClip: PlayerClip = modelJump.phase === 'base' ? clip : 'jump';
          const clipRef = visual.clips[modelClip];
          const modelAnimationSeconds = modelJump.phase === 'base' ? animationSeconds : modelJump.seconds;
          const usesOrderingTable = HARDWARE_GENERATION_PROFILES[generation].video.translucency.kind === 'fixed-rate';
          frame.skinnedMeshes.push({
            id: `player:${generation}`,
            generations: [generation],
            model: `assets/models/${visual.file}`,
            clip: clipRef.animation,
            animationTime: clipRef.freeze ? 0 : modelAnimationSeconds,
            ...(clipRef.loop === undefined ? {} : { loop: clipRef.loop }),
            transform: {
              position: [player.position[0], player.position[1] - FEET_OFFSET, player.position[2]],
              rotationY: session.playerState.facing * yawBase + halfTurn,
            },
            frontAxis: visual.front,
            tint: '#ffffff',
            tintFactor: [1, 1, 1, 1],
            // PS1にはdepth bufferがなく、広い床を中心点だけでOTへ入れると、
            // 床の奥側へ移動したプレイヤーを床全体が後描きして覆ってしまう。
            // 旧rendererと同じ「opaque worldの後、translucent worldの前」に固定する。
            ...(usesOrderingTable ? { orderTableIndex: 9 as const } : {}),
          });
        }
      }

      frame.lights.push({
        id: 'carried-light',
        generations: ['PS2'],
        kind: 'point',
        position: [player.position[0], player.position[1] + 0.6, player.position[2]],
        color: '#ffffff',
        intensity: 1,
        radius: 7,
      });
      colliderBoxes = collidersEnabled ? collectColliderBoxes(session, frame) : [];
      if (colliderBoxes.length > 0) appendColliderCommands(frame, colliderBoxes);
    },
  };
}
