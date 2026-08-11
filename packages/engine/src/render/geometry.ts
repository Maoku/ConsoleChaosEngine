/**
 * 箱のジオメトリ生成（PHASE1_FEEDBACK_PLAN T1-22）。
 *
 * **なぜ分割するのか。**
 * 8 頂点の箱では、第3世代の署名的な表現が 2 つとも画面に出ない（計画 §2.4）。
 *
 * - `vertexQuantize` … 頂点が 8 個しか無いので、揺れが「面の波打ち」ではなく
 *   **物体全体の平行移動**に見える
 * - `affineTexture` … 1 面が 2 三角形なので、UV の歪みがほとんど出ない
 *
 * 床・壁は `area1.json` の AABB から**実行時に生成する形状**であり、モデルではない。
 * レベルを編集するたびにモデルを作り直す構造にはしないため、ここで分割する
 *（Blender で代替しない理由。計画 T1-22）。
 *
 * 予算は**フレームあたり 20,000 三角形**（asset-rules.md §8、T0-09 の決定）。
 * 分割は「見えるだけの粗さ」に留め、`triangleCountOf` で見積もれるようにしてある。
 */

export type Vec3 = readonly [number, number, number];

export interface BoxMesh {
  /** position(3) + normal(3) + uv(2) のインターリーブ。mini_level と同じ並び */
  vertices: Float32Array;
  indices: Uint16Array;
  triangles: number;
}

export interface BoxOptions {
  /**
   * ワールド 1 単位あたりのテクスチャの繰り返し数。
   * 0 は「面いっぱいに 1 枚貼る」（プロップ用。UV は 0..1）
   */
  uvScale: number;
  /** ワールド 1 単位あたりの分割数。既定は `DEFAULT_DENSITY` */
  density?: number;
  /** 1 軸あたりの分割数の上限。既定は `DEFAULT_MAX_SEGMENTS` */
  maxSegments?: number;
}

/**
 * 既定の分割密度：**1m ごとに 1 分割**。
 *
 * 分割数には上と下から挟む理由がある。
 * - 粗すぎると `vertexQuantize` の揺れが「物体全体の平行移動」に見える（計画 §2.4）
 * - **細かすぎると `affineTexture` の歪みが消える。** 歪みは 1 三角形の中で
 *   UV が線形に補間されることで出るので、三角形が小さいほど正しい絵に近づく
 *
 * 0.5m 刻みまで細かくすると第3世代と第4世代の画素差が 20.6 → 7.0 まで落ちた（T1-24 の計測）。
 * 1m 刻みは、床が波打つのに十分で、かつ歪みが残る範囲として選んでいる。
 */
export const DEFAULT_DENSITY = 1;
/** 1 軸あたりの分割数の上限。最大の床（16m）で 2m ごとの分割になる */
export const DEFAULT_MAX_SEGMENTS = 8;

/** 半径から軸ごとの分割数を決める。小さいプロップは分割しない */
export function segmentsFor(half: Vec3, density = DEFAULT_DENSITY, max = DEFAULT_MAX_SEGMENTS): [number, number, number] {
  return half.map((extent) => {
    const segments = Math.round(extent * 2 * density);
    return Math.min(Math.max(segments, 1), max);
  }) as unknown as [number, number, number];
}

/** 分割数から三角形数を求める（予算の見積もりに使う。実際に作らなくても数えられる） */
export function triangleCountOf(segments: readonly [number, number, number]): number {
  const [nx, ny, nz] = segments;
  // 6 面 = 各軸の組み合わせが 2 面ずつ。1 区画あたり 2 三角形
  return 4 * (nx * ny + ny * nz + nz * nx);
}

/**
 * 面の定義。法線と、面内の横方向 u・縦方向 v を向きつきで持つ。
 * **u × v = 法線**になるよう選んであり、これが表向き（CCW）を保証する。
 */
interface Face {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

const FACES: Face[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
];

/** 向きベクトルが指す軸番号（0=x, 1=y, 2=z） */
function axisOf(direction: Vec3): 0 | 1 | 2 {
  if (direction[0] !== 0) return 0;
  return direction[1] !== 0 ? 1 : 2;
}

/**
 * 半径 `half` の箱を、軸ごとに分割して作る。
 *
 * 中心は原点。`uvScale > 0` のときは UV をワールド寸法から作るので、
 * 大きさの違う床でも模様の大きさが揃う（テクスチャは repeat で貼る）。
 */
export function boxMesh(half: Vec3, options: BoxOptions): BoxMesh {
  const segments = segmentsFor(half, options.density, options.maxSegments);
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const face of FACES) {
    const uAxis = axisOf(face.u);
    const vAxis = axisOf(face.v);
    const nAxis = axisOf(face.normal);
    const halfU = half[uAxis]!;
    const halfV = half[vAxis]!;
    const su = segments[uAxis]!;
    const sv = segments[vAxis]!;
    const base = vertices.length / 8;

    for (let v = 0; v <= sv; v++) {
      for (let u = 0; u <= su; u++) {
        // 面内の位置を [-1, 1] で作り、半径を掛けてワールドへ移す
        const fu = (u / su) * 2 - 1;
        const fv = (v / sv) * 2 - 1;
        const position: [number, number, number] = [0, 0, 0];
        position[uAxis] = face.u[uAxis]! * halfU * fu;
        position[vAxis] = face.v[vAxis]! * halfV * fv;
        position[nAxis] = face.normal[nAxis]! * half[nAxis]!;

        // 敷き詰める面は UV をワールド寸法から作る。大きさの違う床でも模様が揃う
        const uv: [number, number] =
          options.uvScale > 0
            ? [fu * halfU * options.uvScale, fv * halfV * options.uvScale]
            : [u / su, v / sv];
        vertices.push(position[0], position[1], position[2], ...face.normal, uv[0], uv[1]);
      }
    }

    for (let v = 0; v < sv; v++) {
      for (let u = 0; u < su; u++) {
        const i0 = base + v * (su + 1) + u;
        const i1 = i0 + 1;
        const i2 = i0 + (su + 1) + 1;
        const i3 = i0 + (su + 1);
        indices.push(i0, i1, i2, i0, i2, i3);
      }
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    triangles: indices.length / 3,
  };
}

/** 単位立方体（分割なし）。検証シーンが使う最小の形 */
export function unitCube(): BoxMesh {
  return boxMesh([1, 1, 1], { uvScale: 0, density: 0 });
}

/** テクスチャの一部を切り出す矩形。原点は左上（v0 が上端） */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * カメラの方（+Z）を向いた 1 枚の板（XY 平面、[-1, 1]）。スプライトが使う（T2-09）。
 *
 * UV はアトラスの 1 セルを指す。**v0 が上端**なので、板の上辺（y = +1）に v0 を貼る。
 * `quadMesh` と違い、絵は上下を入れ替えずに読み込む（glTF 埋め込みの絵と同じ扱い）。
 */
export function billboardMesh(uv: UvRect): BoxMesh {
  const n: Vec3 = [0, 0, 1];
  const corners: Array<[number, number, number, number]> = [
    [-1, -1, uv.u0, uv.v1],
    [1, -1, uv.u1, uv.v1],
    [1, 1, uv.u1, uv.v0],
    [-1, 1, uv.u0, uv.v0],
  ];
  const vertices: number[] = [];
  for (const [x, y, u, v] of corners) vertices.push(x, y, 0, ...n, u, v);
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    triangles: 2,
  };
}

/**
 * 上を向いた 1 枚の板（XZ 平面、[-1, 1]）。UV は 0..`uvRepeat`。
 *
 * 落ち影（T1-26）のように「床に貼るだけ」のものと、
 * 回る面（S-1、T2-03）の 2 つが使う。後者は大きく引き伸ばすので、
 * 模様が伸び切らないようテクスチャを繰り返す。
 */
export function quadMesh(uvRepeat = 1): BoxMesh {
  const n: Vec3 = [0, 1, 0];
  const r = uvRepeat;
  const corners: Array<[number, number, number, number, number]> = [
    [-1, 0, 1, 0, 0],
    [1, 0, 1, r, 0],
    [1, 0, -1, r, r],
    [-1, 0, -1, 0, r],
  ];
  const vertices: number[] = [];
  for (const [x, y, z, u, v] of corners) vertices.push(x, y, z, ...n, u, v);
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    triangles: 2,
  };
}
