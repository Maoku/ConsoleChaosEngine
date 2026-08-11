import type { GameContext, RenderFrame } from '@console-chaos/engine';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';
import type { Session } from '@/gameplay/session';
import type { LevelFile } from '@/level/schema';
import { materialFor } from '@/render/material';

const ROLE_COLORS = {
  background: '#728f62',
  platform: '#b68a58',
  gimmick: '#6ec9c8',
  enemy: '#d95b55',
  goal: '#f4dc7a',
} as const;

export function buildConsoleChaosFrame(
  frame: RenderFrame,
  session: Session,
  level: LevelFile,
  context: GameContext,
): void {
  const hardware = context.generation.profile;
  const theme = CONSOLE_CHAOS_GENERATION_THEMES[context.generation.generation];
  const camera = theme.camera;
  const player = session.player;
  const forward = camera.forward;
  frame.camera = {
    projection: hardware.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
    position: [
      player.position[0] - forward[0] * camera.distance,
      player.position[1] + camera.height,
      player.position[2] - forward[1] * camera.distance,
    ],
    target: [
      player.position[0] + forward[0] * camera.lookAhead,
      player.position[1] + camera.targetHeight,
      player.position[2] + forward[1] * camera.lookAhead,
    ],
    zoom: hardware.video.projection === 'ortho2d' ? 7 : 16,
    orthoHeight: 7,
    fovDegrees: 55,
  };

  const backdrop = theme.art.backdrop;
  frame.backgrounds.push({
    color: `rgb(${backdrop.sky[1].join(' ')})`,
    secondaryColor: `rgb(${backdrop.sky[0].join(' ')})`,
    brightness: 1,
  });
  for (const layer of [backdrop.far, backdrop.near]) {
    if (!layer) continue;
    frame.backgrounds.push({
      color: '#ffffff',
      texture: `textures/${theme.art.textureSet}/${layer.texture}`,
      repeat: [layer.repeat, 1],
      parallax: [layer.scroll, layer.scrollY],
      placement: { bottom: layer.bottom, height: layer.height },
    });
  }

  for (const entity of level.entities) {
    const material = materialFor(entity.type, entity.id);
    if (material.collisionOnly) continue;
    const half = entity.collider?.halfExtents ?? [0.3, 0.3, 0.3];
    const materialId = `material:${entity.id}`;
    frame.materials.push({
      id: materialId,
      baseColorTexture: `textures/${theme.art.textureSet}/${material.texture}`,
      filter: hardware.video.textureFilter,
      blendMode: material.translucent ? 'alpha' : 'opaque',
      uvMode: hardware.video.affineTexture ? 'affine' : 'perspective',
      castShadow: material.castShadow,
    });
    frame.meshes.push({
      id: entity.id,
      geometry: { kind: 'box' },
      transform: {
        position: entity.transform.position,
        scale: [half[0] * 2, half[1] * 2, half[2] * 2],
      },
      color: ROLE_COLORS[material.role],
      ...(entity.model ? { asset: entity.model } : {}),
      material: materialId,
      castShadow: material.castShadow,
      visible: true,
    });
    if (entity.type === 'torch') {
      frame.lights.push({
        id: `light:${entity.id}`,
        kind: 'point',
        position: entity.transform.position,
        color: '#ffb45e',
        intensity: 1,
        radius: 5,
      });
    }
  }

  if (theme.player.kind === 'sprite') {
    frame.sprites.push({
      id: 'player',
      position: player.position,
      size: [theme.player.worldSize, theme.player.worldSize],
      color: '#ffffff',
      texture: `sprites/${theme.player.file}`,
      atlas: theme.player.file,
      cell: 0,
      flipX: session.playerState.facing < 0,
      alphaCutoff: 0.5,
    });
  } else {
    frame.skinnedMeshes.push({
      id: 'player',
      model: `models/${theme.player.file}`,
      clip: theme.player.clips.idle.animation,
      animationTime: session.tickIndex / 60,
      transform: { position: player.position },
      frontAxis: theme.player.front,
      tint: '#ffffff',
    });
    frame.sprites.push({
      id: 'player-fallback',
      position: player.position,
      size: [player.halfExtents[0] * 2, player.halfExtents[1] * 2],
      color: '#f4dc7a',
    });
  }
}
