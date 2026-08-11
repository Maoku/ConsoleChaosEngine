export type SceneVec3 = readonly [number, number, number];
export type SceneQuaternion = readonly [number, number, number, number];

/** A genre-neutral spatial transform shared by loaded scene entities. */
export interface Transform {
  position: SceneVec3;
  rotation?: SceneQuaternion;
  scale?: SceneVec3;
}

export interface SceneRenderable {
  /** Asset-manager key; interpretation is owned by the active renderer. */
  asset: string;
  material?: string;
}

export interface SceneCollider {
  shape: 'aabb';
  halfExtents: SceneVec3;
  solid: boolean;
}

export interface SceneEntity {
  id: string;
  transform: Transform;
  renderable?: SceneRenderable;
  collider?: SceneCollider;
  sector?: string;
  tags: readonly string[];
}

export interface SceneSector {
  id: string;
  center: SceneVec3;
  halfExtents: SceneVec3;
  /** Other sectors visible from this sector. */
  visible: readonly string[];
}

export interface SceneData {
  id: string;
  entities: readonly SceneEntity[];
  sectors: readonly SceneSector[];
}

export interface SceneIssue {
  path: string;
  message: string;
}

/** Validate only references that are common to every engine scene. */
export function validateSceneReferences(scene: SceneData): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const sectorIds = new Set<string>();
  const entityIds = new Set<string>();

  scene.sectors.forEach((sector, index) => {
    if (sectorIds.has(sector.id)) {
      issues.push({ path: `sectors[${index}].id`, message: `Duplicate sector id: ${sector.id}` });
    }
    sectorIds.add(sector.id);
  });

  scene.sectors.forEach((sector, index) => {
    sector.visible.forEach((id, visibleIndex) => {
      if (!sectorIds.has(id)) {
        issues.push({
          path: `sectors[${index}].visible[${visibleIndex}]`,
          message: `Unknown sector id: ${id}`,
        });
      }
    });
  });

  scene.entities.forEach((entity, index) => {
    if (entityIds.has(entity.id)) {
      issues.push({ path: `entities[${index}].id`, message: `Duplicate entity id: ${entity.id}` });
    }
    entityIds.add(entity.id);
    if (entity.sector !== undefined && !sectorIds.has(entity.sector)) {
      issues.push({ path: `entities[${index}].sector`, message: `Unknown sector id: ${entity.sector}` });
    }
  });

  return issues;
}

