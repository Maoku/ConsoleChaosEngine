/**
 * 手動セクタ分割による出し分け（IMPLEMENTATION_PLAN §3 / §5.9、T1-07）。
 *
 * 自動カリング（BVH・オクルージョン）は入れない。**セクタは手で切る**。
 * 理由は 2 つ:
 * - 世代ごとに描画経路が変わるため、自動カリングの前提（1 つの視錐台）が成立しにくい
 * - 「ここから先は別の部屋」をレベル制作者が明示できる方が、パズルの設計と一致する
 *
 * 表示するのは「今いるセクタ + 隣接セクタ」。隣を含めるのは、
 * 出入口の向こう側が抜けて見えるのを防ぐため。
 */
import type { LevelEntity, LevelFile, LevelSector, Vec3Tuple } from './schema';

/** 位置がセクタの内側にあるか（境界上は内側とする） */
export function containsPoint(sector: LevelSector, position: Vec3Tuple): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const distance = Math.abs(position[axis]! - sector.center[axis]!);
    if (distance > sector.halfExtents[axis]!) return false;
  }
  return true;
}

/**
 * その位置を含むセクタ。複数に含まれる場合は定義順で最初のものを返す
 *（重なりを許すのは、出入口をまたぐ場所で表示が途切れないようにするため）。
 */
export function sectorAt(level: LevelFile, position: Vec3Tuple): LevelSector | null {
  return level.sectors.find((sector) => containsPoint(sector, position)) ?? null;
}

export function sectorById(level: LevelFile, id: string): LevelSector | undefined {
  return level.sectors.find((sector) => sector.id === id);
}

/** 表示対象のセクタ id（自分 + 隣接）。順序は定義順で安定させる（不変条件 I4） */
export function visibleSectorIds(level: LevelFile, from: string): string[] {
  const current = sectorById(level, from);
  if (!current) return [];
  const wanted = new Set<string>([current.id, ...current.links]);
  // 無向グラフとして扱う：自分を隣接に挙げているセクタも含める
  for (const sector of level.sectors) {
    if (sector.links.includes(current.id)) wanted.add(sector.id);
  }
  return level.sectors.filter((sector) => wanted.has(sector.id)).map((sector) => sector.id);
}

/** 表示対象のエンティティ。定義順を保つ（描画順の安定＝不変条件 I4） */
export function entitiesInSectors(level: LevelFile, sectorIds: readonly string[]): LevelEntity[] {
  const wanted = new Set(sectorIds);
  return level.entities.filter((entity) => wanted.has(entity.sector));
}

/** その位置から見えるべきエンティティ。セクタが決まらない場合は全件（安全側に倒す） */
export function visibleEntities(level: LevelFile, position: Vec3Tuple): LevelEntity[] {
  const sector = sectorAt(level, position);
  if (!sector) return [...level.entities];
  return entitiesInSectors(level, visibleSectorIds(level, sector.id));
}
