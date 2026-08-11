/**
 * 松明と落ち影（T1-26 → T2-05 で点光源に張り替え）。
 *
 * **P2-1 の受け入れ条件をヘッドレスで固定する。**
 * 「松明が動くと柱の影が振れる」を目で確かめるのではなく、投影の計算そのものを検算する。
 * 影は純関数から出るので、これで十分に強い。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectShadowQuad, shadowContains, SHADOW_LIFT, TORCH_RADIUS } from '@/render/shadow';
import { buildDrawables } from '@/gameplay/scene';
import { parseLevel } from '@/level/loader';
import { PROFILES } from '@/generation/profiles';

const area1 = parseLevel(JSON.parse(readFileSync('public/assets/levels/area1.json', 'utf8')), 'area1.json');
const drawables = buildDrawables(area1);
const pillar = drawables.find((drawable) => drawable.key === 'p2_1_pillar_a')!;
const pillarCenter = area1.entities.find((entity) => entity.id === 'p2_1_pillar_a')!.transform.position as [
  number,
  number,
  number,
];

/** 松明の位置（プレイヤーの腰の少し上）。柱から `distance` だけ +X 側に離れた場所 */
function torchAt(distance: number): [number, number, number] {
  return [pillarCenter[0] + distance, pillarCenter[1] + 0.6, pillarCenter[2]];
}

describe('松明（点光源）の落ち影', () => {
  it('柱は影を落とす（本体も描かれる。透明な塊はもう置かない）', () => {
    expect(pillar.material.castShadow).toBe(true);
    // 影が着地する床は柱が立っている足場（天面 -4）
    expect(pillar.groundY).toBeCloseTo(-4, 6);
  });

  it('影は光と反対側へ伸びる', () => {
    const quad = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, torchAt(3));
    // 松明が +X 側にあるので、影は -X 側へ落ちる
    expect(quad.center[0]).toBeLessThan(pillarCenter[0]);
    expect(quad.strength).toBeGreaterThan(0);
  });

  it('松明が回り込むと影も回り込む（動くことで柱の存在が分かる）', () => {
    const right = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, torchAt(3));
    const left = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, torchAt(-3));
    expect(right.center[0]).toBeLessThan(pillarCenter[0]);
    expect(left.center[0]).toBeGreaterThan(pillarCenter[0]);
  });

  it('近づくほど影は大きく伸びる（平行光との違い）', () => {
    const low: [number, number, number] = [pillarCenter[0] + 3, pillarCenter[1] + 0.3, pillarCenter[2]];
    const high: [number, number, number] = [pillarCenter[0] + 3, pillarCenter[1] + 3, pillarCenter[2]];
    const stretched = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, low);
    const compact = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, high);
    expect(stretched.half[0]).toBeGreaterThan(compact.half[0]);
    // 伸びた影ほど薄い
    expect(stretched.strength).toBeLessThan(compact.strength);
  });

  it('光源が柱より低ければ影は落ちない', () => {
    const below: [number, number, number] = [pillarCenter[0] + 3, pillarCenter[1] - 2, pillarCenter[2]];
    expect(projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, below).strength).toBe(0);
  });

  it('影は床の天面のすぐ上に置かれる（床に埋まらない）', () => {
    const quad = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, torchAt(3));
    expect(quad.center[1] - pillar.groundY).toBeCloseTo(SHADOW_LIFT, 6);
  });

  it('影の内側の判定は XZ だけを見る', () => {
    const quad = projectShadowQuad(pillarCenter, pillar.halfExtents, pillar.groundY, torchAt(3));
    expect(shadowContains(quad, quad.center[0], quad.center[2])).toBe(true);
    expect(shadowContains(quad, quad.center[0] + quad.half[0] + 1, quad.center[2])).toBe(false);
  });

  it('松明を持つのは動的ライトを持つ世代だけ（CH 4 のみ）', () => {
    const withTorch = (['FC', 'SFC', 'PS1', 'PS2'] as const).filter(
      (generation) => PROFILES[generation].video.dynamicLight,
    );
    expect(withTorch).toEqual(['PS2']);
    // 暗室（16m 級）に対して、一度に見えるのは一部だけ
    expect(TORCH_RADIUS).toBeLessThan(16);
  });
});
