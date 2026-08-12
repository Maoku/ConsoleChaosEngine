/**
 * PS1 の三角形単位ソート（IMPLEMENTATION_PLAN §5.4.3、T0-09）。
 *
 * 第3世代は深度バッファを持たず、描画順だけで前後関係を決めていた。
 * その結果として起きる「重なりの破綻」は本作のパズル P1-2 の題材そのものであり、
 * 正しく直すのではなく**忠実に再現する**のが目的。
 *
 * 実装上の原則（§5.4.3）:
 * - 毎フレームのアロケーションを行わない。作業用配列は Workspace として事前確保する
 * - 比較関数ベースの Array.prototype.sort は関数呼び出しコストが支配的になるため、
 *   量子化した整数キーによる基数ソートを本命とする
 * - ただし**素朴版を先に実装して計測してから**最適化する。両方を残し、
 *   ベンチマーク（tools/bench-sort.ts）で常に比較できるようにする
 */

export type IndexArray = Uint16Array | Uint32Array;

export interface OrderingPartitionRange {
  /** Offset into the index buffer, measured in indices rather than bytes. */
  firstIndex: number;
  count: number;
}

export interface TriangleOrderingPartitionWorkspace {
  readonly capacity: number;
  readonly depths: Float32Array;
  readonly slots: Uint8Array;
  readonly counts: Uint32Array;
  readonly offsets: Uint32Array;
  readonly cursors: Uint32Array;
  readonly ranges: readonly OrderingPartitionRange[];
}

export function createOrderingPartitionWorkspace(capacity: number): TriangleOrderingPartitionWorkspace {
  return {
    capacity,
    depths: new Float32Array(capacity),
    slots: new Uint8Array(capacity),
    counts: new Uint32Array(12),
    offsets: new Uint32Array(13),
    cursors: new Uint32Array(12),
    ranges: Array.from({ length: 12 }, () => ({ firstIndex: 0, count: 0 })),
  };
}

/**
 * Stable O(n + 12) partition by triangle-centroid view depth.
 * The matrix is local-to-view in gl-matrix/WebGL column-major layout.
 */
export function partitionTrianglesByViewDepth(
  positions: Float32Array,
  indices: IndexArray,
  localToView: ArrayLike<number>,
  nearDepth: number,
  farDepth: number,
  range: readonly [number, number],
  out: IndexArray,
  workspace: TriangleOrderingPartitionWorkspace,
): readonly OrderingPartitionRange[] {
  const triangles = indices.length / 3;
  if (!Number.isInteger(triangles) || triangles > workspace.capacity || out.length < indices.length) {
    throw new RangeError(`Ordering partition capacity ${workspace.capacity} cannot hold ${triangles} triangles`);
  }
  const start = range[0] ?? -1;
  const end = range[1] ?? -1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 11 || start > end) {
    throw new RangeError(`Ordering partition range must be ascending within 0..11; received ${start}..${end}`);
  }

  const { counts, cursors, depths, offsets, ranges, slots } = workspace;
  counts.fill(0);
  const depthSpan = farDepth - nearDepth;
  const slotSpan = end - start;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const i0 = (indices[triangle * 3] ?? 0) * 3;
    const i1 = (indices[triangle * 3 + 1] ?? 0) * 3;
    const i2 = (indices[triangle * 3 + 2] ?? 0) * 3;
    const x = ((positions[i0] ?? 0) + (positions[i1] ?? 0) + (positions[i2] ?? 0)) / 3;
    const y = ((positions[i0 + 1] ?? 0) + (positions[i1 + 1] ?? 0) + (positions[i2 + 1] ?? 0)) / 3;
    const z = ((positions[i0 + 2] ?? 0) + (positions[i1 + 2] ?? 0) + (positions[i2 + 2] ?? 0)) / 3;
    const viewZ = (localToView[2] ?? 0) * x
      + (localToView[6] ?? 0) * y
      + (localToView[10] ?? 1) * z
      + (localToView[14] ?? 0);
    const depth = -viewZ;
    const normalized = depthSpan > 0
      ? Math.min(1, Math.max(0, (depth - nearDepth) / depthSpan))
      : 0;
    const slot = end - Math.round(normalized * slotSpan);
    depths[triangle] = depth;
    slots[triangle] = slot;
    counts[slot]!++;
  }

  let triangleOffset = 0;
  for (let slot = 0; slot < 12; slot++) {
    offsets[slot] = triangleOffset;
    cursors[slot] = triangleOffset;
    const entry = ranges[slot]!;
    entry.firstIndex = triangleOffset * 3;
    entry.count = (counts[slot] ?? 0) * 3;
    triangleOffset += counts[slot] ?? 0;
  }
  offsets[12] = triangleOffset;

  for (let triangle = 0; triangle < triangles; triangle++) {
    const source = triangle * 3;
    const slot = slots[triangle] ?? 0;
    const destination = cursors[slot]!++ * 3;
    out[destination] = indices[source] ?? 0;
    out[destination + 1] = indices[source + 1] ?? 0;
    out[destination + 2] = indices[source + 2] ?? 0;
  }
  return ranges;
}

/** 距離キーの量子化ビット数。16bit = 65,536 段階あれば同一距離の誤判定は実用上起きない */
const KEY_BITS = 16;
const KEY_MAX = (1 << KEY_BITS) - 1;
const RADIX_BITS = 8;
const RADIX_SIZE = 1 << RADIX_BITS;

export interface TriangleSortWorkspace {
  /** 収容できる三角形数 */
  capacity: number;
  keys: Uint32Array;
  keysTemp: Uint32Array;
  order: Uint32Array;
  orderTemp: Uint32Array;
  counts: Uint32Array;
  distances: Float32Array;
}

export function createSortWorkspace(capacity: number): TriangleSortWorkspace {
  return {
    capacity,
    keys: new Uint32Array(capacity),
    keysTemp: new Uint32Array(capacity),
    order: new Uint32Array(capacity),
    orderTemp: new Uint32Array(capacity),
    counts: new Uint32Array(RADIX_SIZE),
    distances: new Float32Array(capacity),
  };
}

/**
 * 三角形の重心とカメラの距離（の二乗）を求める。
 * 平方根は順序に影響しないので取らない。
 */
function computeDistances(
  positions: Float32Array,
  indices: IndexArray,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  out: Float32Array,
): { min: number; max: number } {
  const triangles = indices.length / 3;
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < triangles; t++) {
    const i0 = (indices[t * 3] ?? 0) * 3;
    const i1 = (indices[t * 3 + 1] ?? 0) * 3;
    const i2 = (indices[t * 3 + 2] ?? 0) * 3;
    const cx = ((positions[i0] ?? 0) + (positions[i1] ?? 0) + (positions[i2] ?? 0)) / 3 - cameraX;
    const cy = ((positions[i0 + 1] ?? 0) + (positions[i1 + 1] ?? 0) + (positions[i2 + 1] ?? 0)) / 3 - cameraY;
    const cz = ((positions[i0 + 2] ?? 0) + (positions[i1 + 2] ?? 0) + (positions[i2 + 2] ?? 0)) / 3 - cameraZ;
    const d = cx * cx + cy * cy + cz * cz;
    out[t] = d;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** 並べ替えた三角形の順序に従ってインデックスを書き出す */
function writeIndices(indices: IndexArray, order: Uint32Array, triangles: number, out: IndexArray): void {
  for (let i = 0; i < triangles; i++) {
    const t = (order[i] ?? 0) * 3;
    out[i * 3] = indices[t] ?? 0;
    out[i * 3 + 1] = indices[t + 1] ?? 0;
    out[i * 3 + 2] = indices[t + 2] ?? 0;
  }
}

/**
 * 素朴版：距離を求めて比較関数でソートする。
 * 最適化の前に必ずこちらで計測する（§6.3「最適化の前に必ず計測する」）。
 */
export function sortTrianglesByDepthNaive(
  positions: Float32Array,
  indices: IndexArray,
  cameraPos: ArrayLike<number>,
  out: IndexArray,
  workspace: TriangleSortWorkspace,
): void {
  const triangles = indices.length / 3;
  const { distances } = workspace;
  computeDistances(positions, indices, cameraPos[0] ?? 0, cameraPos[1] ?? 0, cameraPos[2] ?? 0, distances);

  const order: number[] = new Array<number>(triangles);
  for (let t = 0; t < triangles; t++) order[t] = t;
  // 遠い順（降順）。奥から描いて手前で上書きする
  order.sort((a, b) => (distances[b] ?? 0) - (distances[a] ?? 0));

  for (let i = 0; i < triangles; i++) workspace.order[i] = order[i] ?? 0;
  writeIndices(indices, workspace.order, triangles, out);
}

/**
 * 最適化版：距離を 16bit へ量子化し、8bit × 2 パスの基数ソート（安定）で並べ替える。
 * 比較関数を呼ばないため、三角形数が増えても素朴版より緩やかにしか悪化しない。
 */
export function sortTrianglesByDepthRadix(
  positions: Float32Array,
  indices: IndexArray,
  cameraPos: ArrayLike<number>,
  out: IndexArray,
  workspace: TriangleSortWorkspace,
): void {
  const triangles = indices.length / 3;
  const { distances, keys, keysTemp, order, orderTemp, counts } = workspace;
  const { min, max } = computeDistances(
    positions,
    indices,
    cameraPos[0] ?? 0,
    cameraPos[1] ?? 0,
    cameraPos[2] ?? 0,
    distances,
  );

  // 距離を [0, KEY_MAX] へ写す。降順にしたいので反転させ、昇順の基数ソートで済ませる
  const span = max - min;
  const scale = span > 0 ? KEY_MAX / span : 0;
  for (let t = 0; t < triangles; t++) {
    const quantized = span > 0 ? ((distances[t] ?? 0) - min) * scale : 0;
    keys[t] = KEY_MAX - (quantized | 0);
    order[t] = t;
  }

  let src = keys;
  let srcOrder = order;
  let dst = keysTemp;
  let dstOrder = orderTemp;

  for (let shift = 0; shift < KEY_BITS; shift += RADIX_BITS) {
    counts.fill(0);
    for (let i = 0; i < triangles; i++) {
      counts[((src[i] ?? 0) >>> shift) & (RADIX_SIZE - 1)]!++;
    }
    // 累積和 → 各バケットの開始位置
    let sum = 0;
    for (let b = 0; b < RADIX_SIZE; b++) {
      const c = counts[b] ?? 0;
      counts[b] = sum;
      sum += c;
    }
    for (let i = 0; i < triangles; i++) {
      const key = src[i] ?? 0;
      const bucket = (key >>> shift) & (RADIX_SIZE - 1);
      const position = counts[bucket]!++;
      dst[position] = key;
      dstOrder[position] = srcOrder[i] ?? 0;
    }
    const tmpKeys = src;
    src = dst;
    dst = tmpKeys;
    const tmpOrder = srcOrder;
    srcOrder = dstOrder;
    dstOrder = tmpOrder;
  }

  writeIndices(indices, srcOrder, triangles, out);
}

/**
 * 既定の実装。呼び出し側は結果を VertexArray.updateIndices でアップロードする。
 *
 * 予算に収まらない場合の撤退手順（§5.4.3）は、この関数を
 * 「破綻を見せたいオブジェクト」だけに適用すること。切り替えはオブジェクト単位の
 * DrawFlags.polygonSort で行えるよう、最初から設計に入れてある。
 */
export const sortTrianglesByDepth = sortTrianglesByDepthRadix;
