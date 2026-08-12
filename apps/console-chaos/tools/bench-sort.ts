/**
 * PS1 三角形ソートの計測（T0-09、§6.2）。
 *
 * 目的は「2.0ms のフレーム予算に収まる三角形数」を求め、
 * 安全率 0.7 を掛けた値を PS1 のポリゴン予算とすること（§16.1-a）。
 *
 * 素朴版と最適化版の**両方**を測る。最適化版だけを測ると、
 * 最適化が本当に効いているのかが後から分からなくなる（§5.4.3）。
 *
 *   npm run bench:sort            … 既定のサイズ列で計測
 *   npm run bench:sort -- --json  … 機械可読な出力
 */
import {
  createOrderingPartitionWorkspace,
  createSortWorkspace,
  partitionTrianglesByViewDepth,
  sortTrianglesByDepthNaive,
  sortTrianglesByDepthRadix,
} from '@console-chaos/engine';

/** §6.1 のフレーム予算配分より、PS1 のソートに割り当てられた時間 */
const BUDGET_MS = 2.0;
/** 計測環境の差と将来の負荷増を吸収する安全率（§6.2） */
const SAFETY_FACTOR = 0.7;

const SIZES = [500, 1000, 2000, 4000, 8000, 16000, 20000, 32000];
const WARMUP = 20;
const ITERATIONS = 60;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 実際のシーンに近い分布：奥行き方向に広く散らばった三角形 */
function makeMesh(triangles: number) {
  const random = mulberry32(20260801);
  const positions = new Float32Array(triangles * 9);
  const indices = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const x = random() * 40 - 20;
    const y = random() * 10;
    const z = -random() * 60;
    for (let v = 0; v < 3; v++) {
      const i = (t * 3 + v) * 3;
      positions[i] = x + random();
      positions[i + 1] = y + random();
      positions[i + 2] = z + random();
      indices[t * 3 + v] = t * 3 + v;
    }
  }
  return { positions, indices };
}

type SortFn = typeof sortTrianglesByDepthRadix;

function measure(fn: SortFn, triangles: number): { median: number; p95: number } {
  const { positions, indices } = makeMesh(triangles);
  const out = new Uint32Array(indices.length);
  const workspace = createSortWorkspace(triangles);
  const camera = [0, 2, 8];

  for (let i = 0; i < WARMUP; i++) fn(positions, indices, camera, out, workspace);

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    // カメラを動かして毎回同じ順序にならないようにする
    camera[2] = 8 + (i % 10) * 0.5;
    const start = performance.now();
    fn(positions, indices, camera, out, workspace);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)] ?? 0,
    p95: samples[Math.floor(samples.length * 0.95)] ?? 0,
  };
}

function measureOrderingPartition(triangles: number): { median: number; p95: number } {
  const { positions, indices } = makeMesh(triangles);
  const out = new Uint32Array(indices.length);
  const workspace = createOrderingPartitionWorkspace(triangles);
  const localToView = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -8, 1,
  ]);
  const partition = (): void => {
    partitionTrianglesByViewDepth(positions, indices, localToView, 0.1, 200, [1, 8], out, workspace);
  };

  for (let index = 0; index < WARMUP; index++) partition();

  const samples: number[] = [];
  for (let index = 0; index < ITERATIONS; index++) {
    localToView[14] = -(8 + (index % 10) * 0.5);
    const start = performance.now();
    partition();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return {
    median: samples[Math.floor(samples.length / 2)] ?? 0,
    p95: samples[Math.floor(samples.length * 0.95)] ?? 0,
  };
}

/** 計測点の線形補間で、予算に収まる三角形数を推定する */
function estimateBudget(points: Array<{ triangles: number; ms: number }>): number {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.ms >= BUDGET_MS) {
      if (prev.ms >= BUDGET_MS) return prev.triangles;
      const ratio = (BUDGET_MS - prev.ms) / (cur.ms - prev.ms);
      return Math.round(prev.triangles + (cur.triangles - prev.triangles) * ratio);
    }
  }
  // すべて予算内なら、最後の点から線形外挿する
  const last = points[points.length - 1]!;
  return Math.round((last.triangles * BUDGET_MS) / last.ms);
}

const naive: Array<{ triangles: number; ms: number; p95: number }> = [];
const radix: Array<{ triangles: number; ms: number; p95: number }> = [];
const ot12: Array<{ triangles: number; ms: number; p95: number }> = [];

for (const size of SIZES) {
  const n = measure(sortTrianglesByDepthNaive, size);
  const r = measure(sortTrianglesByDepthRadix, size);
  const o = measureOrderingPartition(size);
  naive.push({ triangles: size, ms: n.median, p95: n.p95 });
  radix.push({ triangles: size, ms: r.median, p95: r.p95 });
  ot12.push({ triangles: size, ms: o.median, p95: o.p95 });
}

const naiveBudget = estimateBudget(naive);
const radixBudget = estimateBudget(radix);
const ot12Budget = estimateBudget(ot12);
const budgets = {
  naive: { estimatedTriangles: naiveBudget, safeTriangles: Math.round(naiveBudget * SAFETY_FACTOR) },
  radix: { estimatedTriangles: radixBudget, safeTriangles: Math.round(radixBudget * SAFETY_FACTOR) },
  ot12: { estimatedTriangles: ot12Budget, safeTriangles: Math.round(ot12Budget * SAFETY_FACTOR) },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ budgetMs: BUDGET_MS, safetyFactor: SAFETY_FACTOR, naive, radix, ot12, budgets }, null, 2));
} else {
  console.log(`PS1 三角形ソート計測（予算 ${BUDGET_MS}ms / 中央値 ${ITERATIONS} 回）\n`);
  console.log('  三角形数 |    素朴版 (p95) |    基数ソート (p95) |      OT12 (p95) | OT/基数');
  console.log('  ---------|-----------------|---------------------|------------------|--------');
  for (let i = 0; i < SIZES.length; i++) {
    const n = naive[i]!;
    const r = radix[i]!;
    const o = ot12[i]!;
    console.log(
      `  ${String(n.triangles).padStart(8)} | ${n.ms.toFixed(3).padStart(7)}ms (${n.p95.toFixed(3)}) | ` +
        `${r.ms.toFixed(3).padStart(7)}ms (${r.p95.toFixed(3)})   | ` +
        `${o.ms.toFixed(3).padStart(7)}ms (${o.p95.toFixed(3)}) | ${(o.ms / r.ms).toFixed(2)}x`,
    );
  }
  console.log('\n予算に収まる三角形数（線形補間）');
  console.log(`  素朴版      : ${naiveBudget.toLocaleString()} → 安全率適用後 ${Math.round(naiveBudget * SAFETY_FACTOR).toLocaleString()}`);
  console.log(`  基数ソート  : ${radixBudget.toLocaleString()} → 安全率適用後 ${Math.round(radixBudget * SAFETY_FACTOR).toLocaleString()}`);
  console.log(`  OT12安定分割: ${ot12Budget.toLocaleString()} → 安全率適用後 ${Math.round(ot12Budget * SAFETY_FACTOR).toLocaleString()}`);
  console.log('\n計測結果は Docs/measurements/ に日付・機材・ブラウザとセットで記録すること（§6.2）');
}
