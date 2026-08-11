/**
 * 世界 → 描画コマンドの組み立て（T1-24）。
 *
 * **ここが「本編の描画」の game 側の半分。** 改訂前はこの役目が
 * `debug/mini_level.ts` の中にあり、フェーズ 0 の足場のまま本編が動いていた（計画 §2.1）。
 *
 * このファイルは GL を一切知らない（§4.2）。材質表と `render/frame.ts` の形だけを使い、
 * 「何がどこにあって、見えているか」を毎ティック書き込む。
 * 逆に `render/renderer3d.ts` はレベルもパズルも知らない。
 */
import { materialFor } from '@/render/material';
import { createFrame, type Frame, type FrameDrawable, type Vec3 } from '@/render/frame';
import { TORCH_HEIGHT, TORCH_RADIUS } from '@/render/shadow';
import { collidersOf } from '@/level/loader';
import { sectorAt } from '@/level/sector';
import { PIXELS_PER_WORLD_UNIT, type LevelEntity, type LevelFile } from '@/level/schema';
import { planeAngleAt, S1_PIVOT } from './puzzles/s1_affine_plane';
import type { Session } from './session';

/** 回る面の広がり（S-1）。どの縮尺でも画面をはみ出す大きさにする */
const S1_PLANE_RADIUS = 24;

/** 歩いていると見なす水平速度（m/s） */
const WALK_SPEED = 0.2;

/**
 * 空の見えない部屋へ出入りするときに、背景が明るさを変えきる時間（秒。BR-03）。
 * 一瞬で切り替わると目に痛いので補間する。長すぎると部屋の中で空が残る
 */
const BACKDROP_FADE_SECONDS = 0.25;

/**
 * 空の見えない部屋（`Material.interior`）を含むセクタの id（BR-03）。
 *
 * **暗室かどうかは場所の話**なので、レベルが持つ「どの要素がどのセクタか」と
 * 材質表の宣言だけから読み込み時に 1 度求める。レベルスキーマには何も足さない（§5.9）。
 */
export function interiorSectorIds(level: LevelFile): Set<string> {
  const ids = new Set<string>();
  for (const entity of level.entities) {
    if (materialFor(entity.type, entity.id).interior) ids.add(entity.sector);
  }
  return ids;
}

/** 正面が -Z のモデルを、右（+X）へ向けるための回転 */
const YAW_FACING_RIGHT = -Math.PI / 2;

export interface Scene {
  readonly frame: Frame;
  /** 1 ティックぶん進める。描画の直前に呼ぶ */
  update(dtSeconds: number): void;
}

/**
 * 落ち影が着地する床の高さを求める。
 * XZ が重なる要素のうち、自分より下にある一番高い天面を採る。無ければ自分の足元。
 */
function groundYOf(entity: LevelEntity, candidates: readonly LevelEntity[]): number {
  const [x, y, z] = entity.transform.position;
  const half = entity.collider?.halfExtents ?? [0, 0, 0];
  let best = y - half[1];
  for (const other of candidates) {
    if (other.id === entity.id || !other.collider) continue;
    const [ox, oy, oz] = other.transform.position;
    const [ohx, ohy, ohz] = other.collider.halfExtents;
    if (Math.abs(ox - x) > ohx + half[0] || Math.abs(oz - z) > ohz + half[2]) continue;
    const top = oy + ohy;
    if (top <= y - half[1] && top > best - 1e-6) best = top;
  }
  return best;
}

/**
 * 描くものを 1 度だけ数え上げる。
 *
 * **SG-05 で `collidersOf` から全要素へ広げた。** 装飾（`collider` を持たない要素）は
 * 物理に居ないので、以前はここで落ちて画面に出なかった（上位計画 §2 の事実 5）。
 * 大きさは `collider.halfExtents` が無ければ `transform.scale`（省略時は等倍）を使う。
 */
export function buildDrawables(level: LevelFile): FrameDrawable[] {
  const solids = collidersOf(level);
  return level.entities
    // 当たり判定だけを持つ要素は描画に積まない（P1-2 の殻の板。見た目はモデル 1 つが受け持つ）
    .filter((entity) => !materialFor(entity.type, entity.id).collisionOnly)
    .map((entity) => ({
      key: entity.id,
      material: materialFor(entity.type, entity.id),
      halfExtents: (entity.collider?.halfExtents ?? entity.transform.scale ?? [1, 1, 1]).slice() as Vec3,
      position: [...entity.transform.position] as Vec3,
      groundY: groundYOf(entity, solids),
    }));
}

export function createScene(session: Session): Scene {
  const drawables = buildDrawables(session.level);
  const frame = createFrame(drawables);
  // レベル要素の id → 実体（走査線制限で消えているかを引くため）
  const entityIds = drawables.map((drawable) => session.entities.get(drawable.key));
  // 空の見えない部屋（BR-03）。読み込み時に 1 度だけ決まる
  const interiors = interiorSectorIds(session.level);

  function update(dtSeconds: number): void {
    const bodies = session.bodies();
    const video = session.profile.video;
    frame.timeSeconds += dtSeconds;

    drawables.forEach((drawable, index) => {
      const body = bodies.get(drawable.key);
      // 装飾は物理に居ない（SG-05）。レベルが置いた場所に、動かないまま出す
      if (!body) return frame.place(index, drawable.position, true);

      const entity = entityIds[index];
      // 消える条件は 3 つだけ。**それ以外は「見え方が変わる」で表す**（計画 §3-4）
      //  1. 走査線制限で今ティック消えている（F-2。消えること自体がルール）
      //  2. 現れること自体が意味を持つ仕掛けが、まだ実体でない（F-1 の橋）
      //  3. 半透明でしか存在しないものを、加算合成を持たない世代で見ている（S-1）
      const culled = entity !== undefined && session.culled.has(entity);
      const notMaterialized = drawable.material.hideWhenPassable && !body.solid;
      const noBlend = drawable.material.translucent && !video.alphaBlend;
      frame.place(index, body.position, !culled && !notMaterialized && !noBlend);
    });

    // --- 松明（T2-04）。動的ライティングを持つ世代でだけ灯る ---
    const torchPlayer = session.player;
    frame.torch.radius = video.dynamicLight ? TORCH_RADIUS : 0;
    frame.torch.position[0] = torchPlayer.position[0];
    frame.torch.position[1] = torchPlayer.position[1] + TORCH_HEIGHT;
    frame.torch.position[2] = torchPlayer.position[2];

    // --- 回る面（T2-03）。回せる世代でだけ回り、角度はパズルと同じ式から出す。
    //     面の中心はレベルが置いた印（`s1_pivot`）そのもの ---
    const pivot = bodies.get(S1_PIVOT);
    frame.plane.visible = video.affinePlane && pivot !== undefined;
    frame.plane.angle = planeAngleAt(session.tickIndex);
    if (pivot) {
      frame.plane.center[0] = pivot.position[0];
      frame.plane.center[1] = pivot.position[1];
      frame.plane.center[2] = pivot.position[2];
    }
    frame.plane.radius = S1_PLANE_RADIUS;

    // --- カメラ（T2-08）---
    // 構図は世代プロファイルが持ち、ここは組み立てるだけ。
    // 同じ `forward` を移動の基底にも使うので、画面の奥と入力の奥が必ず一致する
    const player = session.player;
    const lens = session.profile.camera;
    const is2D = video.projection === 'ortho2d';
    const [forwardX, forwardZ] = lens.forward;

    frame.camera.projection = is2D ? 'ortho' : 'perspective';
    // 2D の縮尺は「1 ワールド単位 = 32 画素」に固定する（T1-08 の計測）。
    // レベルの 0.25 単位グリッド・第1世代の 8px タイル・16px カラーブロックがすべて一致する
    frame.camera.orthoHeight = video.internalHeight / PIXELS_PER_WORLD_UNIT;
    frame.camera.position[0] = player.position[0] - forwardX * lens.distance;
    frame.camera.position[1] = player.position[1] + lens.height;
    frame.camera.position[2] = player.position[2] - forwardZ * lens.distance;
    frame.camera.target[0] = player.position[0] + forwardX * lens.lookAhead;
    frame.camera.target[1] = player.position[1] + lens.targetHeight;
    frame.camera.target[2] = player.position[2] + forwardZ * lens.lookAhead;

    // --- 背景（KV-02）---
    // 層を横へ流す量は「カメラが画面の右へ何 m 動いたか」。
    // 画面の右は視線を Y 軸まわりに 90° 回した向き（forward = [0,-1] なら +X、[1,0] なら +Z）で、
    // 構図が変わっても背景の流れる向きが画面と食い違わない
    frame.backdrop.offset =
      frame.camera.position[0] * -forwardZ + frame.camera.position[2] * forwardX;
    // 縦は読み替えが要らない。カメラの高さがそのまま「画面の上へ何 m」になる（BR-01）
    frame.backdrop.verticalOffset = frame.camera.position[1];

    // 空の見えない部屋では背景も落とす（BR-03）。**世代ではなく今いる部屋で決まる。**
    // 出入りで一瞬に切り替わると目に痛いので、0.25 秒かけて追いつかせる
    const sector = sectorAt(session.level, player.position);
    const wanted = sector !== null && interiors.has(sector.id) ? 0 : 1;
    const step = dtSeconds / BACKDROP_FADE_SECONDS;
    const gap = wanted - frame.backdrop.brightness;
    frame.backdrop.brightness += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;

    // --- プレイヤー ---
    frame.player.position[0] = player.position[0];
    frame.player.position[1] = player.position[1];
    frame.player.position[2] = player.position[2];
    // 正面が -Z のモデルは、右を向くときに -90° 回す。左はその逆。
    // 正面が +Z のアセット（第3・第4世代）はそこから半回転ぶんずらす（T2-08）。
    // 絵で描く世代（T2-09）は回らないので、向きは facing のほうを読む
    const visual = session.profile.player;
    const halfTurn = visual.kind === 'model' && visual.front === '+Z' ? Math.PI : 0;
    frame.player.facing = session.playerState.facing;
    frame.player.yaw = session.playerState.facing * YAW_FACING_RIGHT + halfTurn;

    const moving = Math.abs(player.velocity[0]) > WALK_SPEED || Math.abs(player.velocity[2]) > WALK_SPEED;
    const clip = !player.grounded ? 'jump' : moving ? 'walk' : 'idle';
    if (clip !== frame.player.clip) {
      frame.player.clip = clip;
      frame.player.animationSeconds = 0;
    } else {
      frame.player.animationSeconds += dtSeconds;
    }
  }

  return { frame, update };
}
