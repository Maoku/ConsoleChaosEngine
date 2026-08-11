/**
 * 描画コマンドバッファ（T1-01 で置き場だけ作り、T1-24 で中身を入れた）。
 *
 * **ゲーム側と描画側の唯一の接点。**
 * `gameplay/` は「何がどこにあるか」をここへ積むだけで、GL も世代も知らない（§4.2）。
 * `render/renderer3d.ts` は積まれたものを描くだけで、レベルもパズルも知らない。
 *
 * 形の決まりごと:
 * - **静的な情報（材質・大きさ）は読み込み時に 1 度だけ決める。** 毎フレーム作り直さない
 * - 毎フレーム変わる情報（位置・可視）は**平坦な配列**に持ち、アロケーションを行わない
 */
import type { Material } from './material';
import type { PlayerClip } from '@/generation/profiles';

export type Vec3 = [number, number, number];

/** レベル読み込み時に決まる描画対象。1 要素につき 1 つ */
export interface FrameDrawable {
  /** レベル要素の id。記録と対応づけのためだけに持つ */
  key: string;
  material: Material;
  halfExtents: Vec3;
  /**
   * レベルが置いた静止位置（SG-05）。
   *
   * **当たり判定を持たない要素（装飾）の位置の出どころはここしか無い。**
   * `session.bodies()` は `collidersOf` から作られるので、装飾はそこに居ない。
   * 動くものは毎ティック `place()` で上書きされるので、この値は使われない
   */
  position: Vec3;
  /**
   * 落ち影が着地する床の高さ。`material.castShadow` のときだけ意味を持つ。
   * どの床の上にあるかはレベルの構造の話なので、gameplay/ 側で決めて渡す
   */
  groundY: number;
}

export interface FrameCamera {
  projection: 'ortho' | 'perspective';
  /** 正射影の縦方向の可視範囲（ワールド単位） */
  orthoHeight: number;
  position: Vec3;
  target: Vec3;
}

/** プレイヤー（スキンメッシュ）。1 体しかいないので配列に混ぜない */
export interface FramePlayer {
  position: Vec3;
  /** Y 軸まわりの向き（ラジアン）。モデルで描く世代が使う */
  yaw: number;
  /**
   * 左右の向き（-1 = 左 / 1 = 右）。**スプライトで描く世代が使う**（T2-09）。
   *
   * `yaw` から取り出せそうに見えるが、絵は回らない。1 枚の絵を左右反転するだけなので、
   * 回転角ではなく「どちら側か」がそのまま要る
   */
  facing: -1 | 1;
  /**
   * 再生するクリップ。**ゲーム側の名前**であって、アセット内の名前ではない。
   * どのアニメーションに対応するかは `GenerationProfile.player.clips` が決める
   */
  clip: PlayerClip;
  /** アニメーションの時刻（秒）。世代ごとの量子化は描画側が行う */
  animationSeconds: number;
  /** モデルの色に掛ける係数 */
  tint: [number, number, number, number];
}

/**
 * プレイヤーが持つ松明（T2-04）。動的ライティングを持つ世代でだけ灯る。
 * `radius` が 0 のときは松明そのものが無い（暗室は環境光だけになる）。
 */
export interface FrameTorch {
  position: Vec3;
  radius: number;
}

/**
 * 回る面（S-1、T2-03）。**画面いっぱいの床を 1 枚の面として回す。**
 * 回せる世代（`video.affinePlane`）でだけ `visible` が真になる。
 */
export interface FramePlane {
  visible: boolean;
  /** 面の中心（ワールドの XZ と、床の高さ） */
  center: Vec3;
  /** 回転角（ラジアン）。パズル側と同じ値を使うので、島の位置と面の模様がずれない */
  angle: number;
  /** 面の半径（ワールド単位） */
  radius: number;
}

/**
 * 背景の見え方のうち、**毎フレーム変わるぶんだけ**（KV-02）。
 *
 * 色と層の指定は `GenerationProfile.art.backdrop` が持ち、ここには置かない。
 * 世代ごとの見た目をここへ持ち込むと、ゲーム側が世代の絵を知ることになるため
 *（描画側は `draw(profile, frame)` の両方を受け取るので、二重に運ぶ必要も無い）。
 */
export interface FrameBackdrop {
  /**
   * 背景をずらす量（メートル）。**カメラの位置を、画面の右方向へ測ったもの。**
   *
   * 構図（`CameraProfile.forward`）が世代ごとに違うので、ワールドの X をそのまま
   * 使うと第4世代（通路の奥を向く構図）で背景が横に流れない。
   * 「画面の右へ何 m 動いたか」に直しておけば、どの構図でも同じ意味になる
   */
  offset: number;
  /**
   * 背景を縦へずらす量（メートル。BR-01 / BR-02）。**カメラの高さそのもの。**
   *
   * 横（`offset`）と違って構図による読み替えが要らない。どの世代でもカメラの Y が
   * そのまま「画面の上へ何 m 動いたか」になるため。
   * 層をいくつ動かすかは `BackdropLayer.scrollY` が世代ごとに決める
   */
  verticalOffset: number;
  /**
   * 背景に掛ける明るさ（0..1、既定 1。BR-03）。
   *
   * **空の見えない部屋（`Material.interior`）にいる間だけ 0 へ向かう。**
   * KV-02 で背景が全画面 1 枚になったことで、P2-1 の暗室でもほぼ黒の床が
   * 空を背にしたシルエットとして読めるようになった。「何も見えない」が仕掛けそのものなので、
   * ここだけは基準画 F（どこにも黒が無い）の例外にする。
   *
   * 世代ではなく**場所**で決まる（不変条件 I2）。決めるのは `gameplay/scene.ts`。
   */
  brightness: number;
}

export interface Frame {
  readonly drawables: readonly FrameDrawable[];
  /** 中心座標（3 要素 × 個数） */
  readonly positions: Float32Array;
  /** 0 = 描かない、1 = 描く */
  readonly visible: Uint8Array;
  readonly camera: FrameCamera;
  readonly player: FramePlayer;
  readonly torch: FrameTorch;
  readonly plane: FramePlane;
  readonly backdrop: FrameBackdrop;
  /** 経過時刻（秒）。時間に依る表現が読む */
  timeSeconds: number;
  /** 1 要素ぶんの位置と可視を書き込む */
  place(index: number, position: ArrayLike<number>, visible: boolean): void;
}

export function createFrame(drawables: readonly FrameDrawable[]): Frame {
  const positions = new Float32Array(drawables.length * 3);
  const visible = new Uint8Array(drawables.length);
  return {
    drawables,
    positions,
    visible,
    camera: {
      projection: 'perspective',
      orthoHeight: 7,
      position: [0, 0, 0],
      target: [0, 0, 0],
    },
    player: {
      position: [0, 0, 0],
      yaw: 0,
      facing: 1,
      clip: 'idle',
      animationSeconds: 0,
      tint: [1, 1, 1, 1],
    },
    torch: { position: [0, 0, 0], radius: 0 },
    plane: { visible: false, center: [0, 0, 0], angle: 0, radius: 0 },
    backdrop: { offset: 0, verticalOffset: 0, brightness: 1 },
    timeSeconds: 0,
    place(index, position, isVisible): void {
      positions[index * 3] = position[0] ?? 0;
      positions[index * 3 + 1] = position[1] ?? 0;
      positions[index * 3 + 2] = position[2] ?? 0;
      visible[index] = isVisible ? 1 : 0;
    },
  };
}
