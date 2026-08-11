import {
  GENERATION_IDS,
  geometryCommandKey,
  type GeometryCommand,
  type GenerationId,
  type RenderAssetManifest,
} from '@console-chaos/engine';
import { CONSOLE_CHAOS_GENERATION_THEMES } from '@/config/generation';
import type { LevelFile } from '@/level/schema';
import { MATERIALS, materialFor, requiredModels, requiredTextures } from '@/render/material';

export function createConsoleChaosRenderManifest(level: LevelFile): RenderAssetManifest {
  const textureUrls = new Set<string>();
  const atlasByUrl = new Map<string, { url: string; columns: number; rows: number }>();
  const modelByUrl = new Map<string, { url: string; polygonSort?: boolean }>();
  const fallbackTextures = {} as Record<GenerationId, string>;

  for (const generation of GENERATION_IDS) {
    const theme = CONSOLE_CHAOS_GENERATION_THEMES[generation];
    const texture = (file: string): string => `assets/textures/${theme.art.textureSet}/${file}`;
    for (const file of requiredTextures()) textureUrls.add(texture(file));
    for (const layer of [theme.art.backdrop.far, theme.art.backdrop.near]) {
      if (layer) textureUrls.add(texture(layer.texture));
    }
    fallbackTextures[generation] = texture('stone_floor.png');
    if (theme.player.kind === 'sprite') {
      const url = `assets/sprites/${theme.player.file}`;
      atlasByUrl.set(url, { url, columns: theme.player.columns, rows: theme.player.rows });
    } else {
      const url = `assets/models/${theme.player.file}`;
      modelByUrl.set(url, { url });
    }
  }

  const sortedModels = new Set(
    Object.values(MATERIALS)
      .filter((material) => material.polygonSort && material.model)
      .map((material) => material.model!),
  );
  for (const name of requiredModels()) {
    const url = `assets/models/${name}.gltf`;
    modelByUrl.set(url, { url, ...(sortedModels.has(name) ? { polygonSort: true } : {}) });
  }
  modelByUrl.set('assets/models/player.gltf', { url: 'assets/models/player.gltf' });

  const geometryByKey = new Map<string, GeometryCommand>();
  const unitBox: GeometryCommand = { kind: 'box' };
  geometryByKey.set(geometryCommandKey(unitBox), unitBox);
  for (const entity of level.entities) {
    const material = materialFor(entity.type, entity.id);
    if (material.collisionOnly || material.model) continue;
    const geometry: GeometryCommand = {
      kind: 'box',
      halfExtents: entity.collider?.halfExtents ?? entity.transform.scale ?? [1, 1, 1],
      uvScale: material.uvScale,
    };
    geometryByKey.set(geometryCommandKey(geometry), geometry);
  }
  const plane: GeometryCommand = { kind: 'quad', halfSize: [24, 24], uvRepeat: [24, 24] };
  geometryByKey.set(geometryCommandKey(plane), plane);
  const debugPlane: GeometryCommand = { kind: 'quad', halfSize: [1, 1], uvRepeat: [16, 16] };
  geometryByKey.set(geometryCommandKey(debugPlane), debugPlane);

  return {
    textures: [...textureUrls].map((url) => ({ url, flipY: true, wrap: 'repeat' as const })),
    models: [...modelByUrl.values()],
    atlases: [...atlasByUrl.values()],
    geometries: [...geometryByKey.values()],
    fallbackTextures,
  };
}
