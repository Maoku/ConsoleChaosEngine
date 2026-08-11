import type { SceneData, SceneEntity } from '@console-chaos/engine';
import type { LevelEntity, LevelFile } from '@/level/schema';

function adaptEntity(entity: LevelEntity): SceneEntity {
  return {
    id: entity.id,
    transform: {
      position: entity.transform.position,
      ...(entity.transform.rotation ? { rotation: entity.transform.rotation } : {}),
      ...(entity.transform.scale ? { scale: entity.transform.scale } : {}),
    },
    ...(entity.model ? { renderable: { asset: entity.model } } : {}),
    ...(entity.collider
      ? {
          collider: {
            shape: entity.collider.type,
            halfExtents: entity.collider.halfExtents,
            solid: entity.collider.solid ?? true,
          },
        }
      : {}),
    sector: entity.sector,
    tags: [entity.type],
  };
}

/**
 * Projects the unchanged legacy level JSON onto the engine-owned scene subset.
 * App-only metadata remains available on the original LevelFile.
 */
export function adaptConsoleChaosLevel(level: LevelFile): SceneData {
  return {
    id: level.id,
    entities: level.entities.map(adaptEntity),
    sectors: level.sectors.map((sector) => ({
      id: sector.id,
      center: sector.center,
      halfExtents: sector.halfExtents,
      visible: sector.links,
    })),
  };
}

