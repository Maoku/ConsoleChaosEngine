/**
 * 松明（点光源）と落ち影（T1-26 → T2-05 で点光源に張り替え）。
 *
 * **シャドウマップは持たない。** 投影影（床へ落とす 1 枚の板）で足りる
 *（GAME_PLAN §11.1.1：要らない抽象は持たない）。
 *
 * 改訂前は「遠くの平行光が、透明な塊の影を落とす」だった。
 * 影が薄すぎて読めず（テクスチャのアルファ平均 0.30 × 濃さ 0.72 ＝ 実効 0.21）、
 * 試遊では「影が落ちていない」と受け取られた（ギミックレビュー P2-1）。
 *
 * T2-05 では光源を**プレイヤーが持つ松明**に変えた。点光源なので、
 *
 * - 近づくほど影は**大きく伸びる**（平行光では大きさが変わらなかった）
 * - プレイヤーが動くと影が**扇のように振れる**。動くこと自体が「そこに柱がある」を伝える
 *
 * ここは純関数だけを持ち、GL に触れない。ヘッドレスで検算できることが、
 * 「影がどこへ伸びるか」を人の目に頼らずに固定できる条件になる。
 */

export type Vec3 = [number, number, number];

/** 松明が届く半径（m）。暗室の広さ（16m）に対し「一度に見えるのは一部」になる値 */
export const TORCH_RADIUS = 7;

/** 松明を持つ高さ（プレイヤーの中心からの相対、m） */
export const TORCH_HEIGHT = 0.6;

/** 影が床に埋まらないよう、床の天面から浮かせる高さ */
export const SHADOW_LIFT = 0.02;

/** 影がこれ以上は伸びない倍率。真横から照らしたときに床いっぱいの帯になるのを防ぐ */
const MAX_STRETCH = 3;

export interface ShadowQuad {
  /** 床の上の中心 */
  center: Vec3;
  /** 半径（y は板の厚みなので使わない） */
  half: Vec3;
  /** 濃さの倍率 0..1。遠い影ほど薄い */
  strength: number;
}

/**
 * 点光源の落ち影を求める。光源から物体の中心を通る直線を、床の平面まで延ばす。
 *
 * 物体が光源と床の間にあるほど影は大きくなる（相似の比 = 光源から床までの高さ ÷
 * 光源から物体までの高さ）。伸びは `MAX_STRETCH` で頭打ちにする。
 *
 * 光源が物体より下にある場合は影が落ちない（`strength = 0` を返す）。
 */
export function projectShadowQuad(center: Vec3, half: Vec3, groundY: number, light: Vec3): ShadowQuad {
  const lightToObject = light[1] - center[1];
  const lightToGround = light[1] - groundY;
  // 光源が物体と同じ高さ以下、あるいは床より下にあるなら影は落ちない
  if (lightToObject <= 1e-3 || lightToGround <= 1e-3) {
    return { center: [center[0], groundY + SHADOW_LIFT, center[2]], half: [half[0], 1, half[2]], strength: 0 };
  }

  const stretch = Math.min(lightToGround / lightToObject, MAX_STRETCH);
  return {
    center: [
      light[0] + (center[0] - light[0]) * stretch,
      groundY + SHADOW_LIFT,
      light[2] + (center[2] - light[2]) * stretch,
    ],
    half: [half[0] * stretch, 1, half[2] * stretch],
    // 伸びた影ほど薄い（面積が広がるぶん、受ける光の遮り方が緩くなる）
    strength: 1 / stretch,
  };
}

/** 影の内側に点があるか（板は軸に沿った矩形なので、XZ だけを見る） */
export function shadowContains(quad: ShadowQuad, x: number, z: number): boolean {
  return Math.abs(quad.center[0] - x) <= quad.half[0] && Math.abs(quad.center[2] - z) <= quad.half[2];
}
