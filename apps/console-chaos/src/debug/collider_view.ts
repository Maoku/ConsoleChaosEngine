/**
 * 当たり判定の可視化（デバッグ）。
 *
 * **目的は「見えない床」を報告できる形にすること。**
 * 試遊で「乗れるのに何も無い」「歩けるはずの所で止まる」が起きたとき、
 * 何が起きているのかを言葉にするには、実体（当たり判定）と絵（描画）の
 * どちらが欠けているのかが分かる必要がある。この 2 つの食い違いを
 * **色で**出すのがここの役目。
 *
 *   緑 … 実体があり、絵も出ている（正常）
 *   赤 … 実体があるのに絵が出ていない（＝見えない床・見えない壁）
 *   紫 … 当たり判定だけを持つ板（見た目は別の 1 つのモデルが受け持つ。P1-2 の殻）。
 *        **紫とモデルの位置がずれていたら、それがそのまま不具合**
 *   青 … すり抜ける（トリガ・未実体のギミック）
 *   白 … プレイヤー
 *
 * 線はシーンと同じカメラ・同じ内部解像度で描くので、位置がずれない。
 * 深度テストを切ってあるため、**壁の裏の当たり判定も透けて見える**。
 *
 * 描画は `render/` の外（debug/）に置く。世代差もパズルも知らず、
 * 「積まれた当たり判定を線で描く」だけを行う。
 */
import { mat4 } from 'gl-matrix';
import {
  createBuffer,
  createProgram,
  createStateCache,
  createVertexArray,
  type GLContext,
  type Program,
  type StateCache,
  type VertexArray,
} from '@/render/gl/index';
import { createCamera, type Camera } from '@/render/camera';
import type { Frame } from '@/render/frame';
import { materialFor } from '@/render/material';
import type { VideoProfile } from '@/generation/profiles';
import { aabbFromCenter, overlaps, type Vec3 } from '@/gameplay/projection';
import type { Session } from '@/gameplay/session';

/** 当たり判定と絵の食い違いの分類。**赤（hidden）が探しているもの** */
export type ColliderKind = 'solid' | 'hidden' | 'proxy' | 'passable' | 'player';

export const COLLIDER_COLORS: Record<ColliderKind, readonly [number, number, number, number]> = {
  solid: [0.3, 1, 0.4, 0.85],
  hidden: [1, 0.2, 0.25, 1],
  proxy: [0.85, 0.4, 1, 0.85],
  passable: [0.35, 0.65, 1, 0.7],
  player: [1, 1, 1, 0.9],
};

/** 画面に出す凡例。報告のときに色の意味を書き写せるようにする */
export const COLLIDER_LEGEND =
  '緑=実体+表示 / 赤=実体なのに非表示 / 紫=判定だけの板 / 青=すり抜け / 白=自分';

export interface ColliderBox {
  /** レベル要素の id（プレイヤーは 'player'） */
  id: string;
  kind: ColliderKind;
  center: Vec3;
  half: Vec3;
}

/**
 * 世界の当たり判定 → 線で描く箱。
 *
 * 「絵が出ている」の判定は `Frame` を見る。
 * 当たり判定だけを持つ板（`collisionOnly`）はそもそも drawables に積まれないが、
 * これは**別のモデルが見た目を受け持つ約束**なので `proxy` として区別する
 *（区別しないと、正常な板と本当の「見えない床」が同じ赤になって報告に使えない）。
 */
export function collectColliderBoxes(session: Session, frame: Frame): ColliderBox[] {
  const drawn = new Set<string>();
  frame.drawables.forEach((drawable, index) => {
    if (frame.visible[index] === 1) drawn.add(drawable.key);
  });
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

/** プレイヤーが触れている当たり判定（足元も含めたいので少しだけ膨らませて見る） */
export function touchingBoxes(session: Session, boxes: readonly ColliderBox[], margin = 0.06): ColliderBox[] {
  const half = session.player.halfExtents;
  const probe = aabbFromCenter(session.player.position, [half[0] + margin, half[1] + margin, half[2] + margin]);
  const mode = session.profile.video.projection;
  return boxes.filter(
    (box) => box.kind !== 'player' && overlaps(probe, aabbFromCenter(box.center, box.half), mode),
  );
}

/** 近くにある「見えない実体」。報告に書く順（近い順）で返す */
export function nearbyHidden(session: Session, boxes: readonly ColliderBox[], radius = 14): Array<[string, number]> {
  const [px, py, pz] = session.player.position;
  return boxes
    .filter((box) => box.kind === 'hidden')
    .map((box): [string, number] => [
      box.id,
      Math.hypot(box.center[0] - px, box.center[1] - py, box.center[2] - pz),
    ])
    .filter(([, distance]) => distance <= radius)
    .sort((a, b) => a[1] - b[1]);
}

// --- 線の描画 ---------------------------------------------------------------

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}`;

/** [-1, 1] の立方体の 8 隅 */
const CORNERS = new Float32Array([
  -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
  -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1,
]);
/** 12 本の辺 */
const EDGES = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
]);

export interface ColliderView {
  /** 1 フレーム分の線を描く。シーンの描画の**最後**に呼ぶ */
  draw(video: VideoProfile, frame: Frame, boxes: readonly ColliderBox[]): void;
  dispose(): void;
}

/**
 * **`sealShaderCompilation()` より前に作ること**（＝ `createPipeline` より前）。
 * 切替時のコンパイルを禁じてあるため、後から作ると例外になる（V7）。
 */
export function createColliderView(ctx: GLContext): ColliderView {
  const { gl } = ctx;
  const program: Program = createProgram(ctx, 'collider', VERTEX_SOURCE, FRAGMENT_SOURCE);
  const vbo = createBuffer(ctx, 'vertex', CORNERS);
  const ibo = createBuffer(ctx, 'index', EDGES);
  const vao: VertexArray = createVertexArray(ctx, [{ location: 0, size: 3, buffer: vbo }], {
    buffer: ibo,
    type: 'ushort',
  });
  // 自前のキャッシュを持つが、描き終わりに**シーンの状態へ戻す**ので
  // 呼び出し元（renderer3d / pipeline）のキャッシュとずれない
  const state: StateCache = createStateCache(ctx);
  const camera: Camera = createCamera('perspective');
  const model = mat4.create();

  return {
    draw(video, frame, boxes): void {
      camera.projection = frame.camera.projection;
      camera.orthoHeight = frame.camera.orthoHeight;
      for (let axis = 0; axis < 3; axis++) {
        camera.position[axis] = frame.camera.position[axis]!;
        camera.target[axis] = frame.camera.target[axis]!;
      }
      camera.update(video.internalWidth / video.internalHeight);

      // 深度テストなし＝壁の裏の当たり判定も透けて見える（見えない床を探す道具なので）
      state.invalidate();
      state.apply({ depthTest: false, depthWrite: false, blend: 'alpha', cull: 'none' });
      program.use();
      vao.bind();
      for (const box of boxes) {
        mat4.identity(model);
        mat4.translate(model, model, box.center);
        mat4.scale(model, model, box.half);
        program.setUniforms({
          uModel: model as Float32Array,
          uViewProjection: camera.viewProjection as Float32Array,
          uColor: [...COLLIDER_COLORS[box.kind]],
        });
        gl.drawElements(gl.LINES, EDGES.length, vao.indexType, 0);
      }
      // シーンの描画状態へ戻す（renderer3d が描き終わった時点と同じ値）
      state.invalidate();
      state.apply({
        depthTest: video.depthBuffer,
        depthWrite: video.depthBuffer,
        blend: 'none',
        cull: 'back',
      });
    },
    dispose(): void {
      vao.dispose();
      vbo.dispose();
      ibo.dispose();
      program.dispose();
    },
  };
}
