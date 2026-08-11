import type { RenderFrame, Vec3 } from '@console-chaos/engine';
import { aabbFromCenter, overlaps } from '@/gameplay/projection';
import type { Session } from '@/gameplay/session';
import { materialFor } from '@/render/material';

export type ColliderKind = 'solid' | 'hidden' | 'proxy' | 'passable' | 'player';

export const COLLIDER_COLORS: Record<ColliderKind, readonly [number, number, number, number]> = {
  solid: [0.3, 1, 0.4, 0.85],
  hidden: [1, 0.2, 0.25, 1],
  proxy: [0.85, 0.4, 1, 0.85],
  passable: [0.35, 0.65, 1, 0.7],
  player: [1, 1, 1, 0.9],
};

export const COLLIDER_LEGEND =
  '緑=実体+表示 / 赤=実体なのに非表示 / 紫=判定だけの板 / 青=すり抜け / 白=自分';

export interface ColliderBox {
  id: string;
  kind: ColliderKind;
  center: Vec3;
  half: Vec3;
}

export function collectColliderBoxes(session: Session, frame: RenderFrame): ColliderBox[] {
  const generation = session.generation.generation;
  const suffix = `:${generation}`;
  const drawn = new Set(
    frame.meshes
      .filter((mesh) => mesh.visible !== false && mesh.id.endsWith(suffix))
      .map((mesh) => mesh.id.slice(0, -suffix.length)),
  );
  const proxies = new Set(
    session.level.entities
      .filter((entity) => materialFor(entity.type, entity.id).collisionOnly)
      .map((entity) => entity.id),
  );

  const boxes: ColliderBox[] = [];
  for (const [id, body] of session.bodies()) {
    const kind: ColliderKind = !body.solid
      ? 'passable'
      : drawn.has(id)
        ? 'solid'
        : proxies.has(id)
          ? 'proxy'
          : 'hidden';
    boxes.push({ id, kind, center: [...body.position] as Vec3, half: [...body.halfExtents] as Vec3 });
  }
  boxes.push({
    id: 'player',
    kind: 'player',
    center: [...session.player.position] as Vec3,
    half: [...session.player.halfExtents] as Vec3,
  });
  return boxes;
}

export function appendColliderCommands(frame: RenderFrame, boxes: readonly ColliderBox[]): void {
  for (const [kind, color] of Object.entries(COLLIDER_COLORS) as Array<[ColliderKind, readonly [number, number, number, number]]>) {
    frame.materials.push({
      id: `debug-collider-${kind}`,
      colorFactor: color,
      blendMode: 'alpha',
      ambient: 1,
      diffuse: 0,
    });
  }
  for (const box of boxes) {
    frame.meshes.push({
      id: `debug-collider:${box.id}`,
      geometry: { kind: 'box' },
      transform: {
        position: box.center,
        scale: [box.half[0] * 2, box.half[1] * 2, box.half[2] * 2],
      },
      color: '#ffffff',
      material: `debug-collider-${box.kind}`,
      wireframe: true,
      layer: 10_000,
    });
  }
}

export function touchingBoxes(session: Session, boxes: readonly ColliderBox[], margin = 0.06): ColliderBox[] {
  const half = session.player.halfExtents;
  const probe = aabbFromCenter(session.player.position, [half[0] + margin, half[1] + margin, half[2] + margin]);
  const mode = session.profile.hardware.video.projection;
  return boxes.filter(
    (box) => box.kind !== 'player' && overlaps(probe, aabbFromCenter(box.center, box.half), mode),
  );
}

export function nearbyHidden(session: Session, boxes: readonly ColliderBox[], radius = 14): Array<[string, number]> {
  const [px, py, pz] = session.player.position;
  return boxes
    .filter((box) => box.kind === 'hidden')
    .map((box): [string, number] => [
      box.id,
      Math.hypot(box.center[0] - px, box.center[1] - py, box.center[2] - pz),
    ])
    .filter(([, distance]) => distance <= radius)
    .sort((left, right) => left[1] - right[1]);
}
