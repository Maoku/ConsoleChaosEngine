/**
 * 世代ごとの描画経路の選択と事前コンパイル（T0-12 / V7、§5.4.2）。
 *
 * **このファイルと generation/profiles.ts だけが世代 ID を直接扱ってよい**（不変条件 I2）。
 * ただしここでも「世代 ID による分岐」は書かず、プロファイルの値で経路を組み立てる。
 * 世代 ID は「4 つ分を用意する」ためのキーとしてのみ使う。
 *
 * 設計上の要点:
 * - 4 世代分の FBO とシェーダは**起動時に全部作る**。切替時には何も確保しない
 * - 起動が終わったら sealShaderCompilation() でコンパイルを封じる。
 *   切替時にコンパイルが走ればその場で例外になる（V7 の受け入れ条件）
 * - 切替中は旧世代と新世代の両方を描画し、ノイズ付きでブレンドする
 */
import {
  bindScreen,
  createFramebuffer,
  createStateCache,
  sealShaderCompilation,
  type Framebuffer,
  type GLContext,
  type StateCache,
  type Texture,
} from './gl/index';
import { createPostChain, type PostChain, type PostPassSpec } from './postfx/chain';
import { createCrtPasses } from './postfx/crt';
import type { CrtPreset, CrtQuality } from './postfx/presets';
import { createFcQuantizePasses } from './quantize/palette_fc';
import { createSfcQuantizePasses } from './quantize/palette_sfc';
import { nearestMasterIndex } from './quantize/master_palette';
import { KEY_COLORS, type Rgb } from './key_palette';
import { GENERATION_IDS, PROFILES, type GenerationId, type GenerationProfile } from '@/generation/profiles';
import transitionSource from './shaders/transition.glsl?raw';

/** 内部解像度をドット感を保ったまま出力へ運ぶだけのパス */
const PRESENT = 'void main() { fragColor = sampleSource(snapToTexel(vUv, uSourceSize)); }';

/** 0..255 の色を、シェーダへ渡せる 0..1 の並びにする */
function unit(color: Rgb): [number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255];
}

/**
 * 切替のときに画面を横切る光の帯の色（KV-08、基準画 D の「白〜桃〜青の帯」）。
 * 実測値は `key_palette.ts` が持つので、ここは形を変えるだけ。
 */
const RIBBON_CORE = unit(KEY_COLORS.white);
const RIBBON_LEAD = unit(KEY_COLORS.titlePink);
const RIBBON_TRAIL = unit(KEY_COLORS.sky);

/** 世代ごとのシーン描画。ゲーム側は「プロファイルに従って描く」だけで、経路を知らない */
export type SceneDrawer = (profile: GenerationProfile) => void;

/**
 * スプライト面（T2-10。T2-11 で第2世代も持つようになった）。
 *
 * **実機の BG と OBJ は、色の制約を共有しない。**
 * 第1世代の BG は 16×16 の属性ブロックごとに色数が制限されるが、OBJ は自分のパレットを
 * 持つので、背景に何が描かれていても影響を受けない。1 枚の絵に混ぜてから量子化すると、
 * 背景の色数がキャラクタの色を食う（草の上に立つと靴が緑に潰れる、など）。
 *
 * そこで**プレイヤーを絵で描く世代だけ、絵を別の面へ描く**。
 * 面が空（α = 0）のところは背景がそのまま出る。
 *
 * **重ねるのは量子化パスの仕事**（`quantizePassesFor`）。第1世代はそれぞれの面で
 * 独立にブロックパレットを選んでから重ね、第2世代は色数制限を持たないので重ねるだけ。
 * 面を持つ理由は世代で違うが、描く側（`renderer3d.drawSprites`）は差を知らない。
 */
export type SpriteDrawer = (profile: GenerationProfile) => void;

export interface PipelineOptions {
  /** CRT の品質設定。毎フレーム評価される */
  quality: () => CrtQuality;
  /** 切替演出の乱れの強さ。光過敏への配慮で 0 にできる（GAME_PLAN §13） */
  glitchAmount?: () => number;
  /**
   * CRT プリセットの部分上書き（BR-05）。毎フレーム評価される。
   *
   * `postfx/crt.ts` は元から `override` を受け取れたが、`PipelineOptions` が
   * `quality` と `glitchAmount` しか受け取らず、道が繋がっていなかった。
   * **繋ぐだけ**にとどめ、シェーダにもプリセットにも分岐を足さない（計画 §2 の決定 4）。
   * 何を上書きするかは UI 側（`ui/settings.ts`）が決める
   */
  crtOverride?: () => Partial<CrtPreset>;
}

export interface RenderRequest {
  /** 現在の世代 */
  generation: GenerationId;
  /** 切替中の旧世代。切替していないときは null */
  from?: GenerationId | null;
  /** 切替の進行度 0..1。1 で完全に新世代 */
  blend?: number;
  screenWidth: number;
  screenHeight: number;
  timeSeconds: number;
}

export interface Pipeline {
  /** 各世代の内部解像度で描くための FBO（外部からは読み取り専用として扱う） */
  sceneTarget(generation: GenerationId): Framebuffer;
  /** スプライト面の FBO。持たない世代では null（T2-10） */
  spriteTarget(generation: GenerationId): Framebuffer | null;
  /**
   * @param drawSprites スプライト面の描画。**面を持つ世代でしか呼ばれない。**
   *   渡さない場合、その世代のスプライトは描かれない（面は空のまま）
   */
  render(request: RenderRequest, drawScene: SceneDrawer, drawSprites?: SpriteDrawer): void;
  /** 直近のフレームで実行した世代数（1 = 通常、2 = 切替中）。テスト・計測用 */
  readonly lastGenerationsDrawn: number;
  dispose(): void;
}

/**
 * 背景の下端色が固定 54 色のどれになるか（KV-04）。
 * 実機の「背景色」（画面共通の 1 色）に相当する枠へ、その世代の空を入れるために使う。
 */
function backdropIndexOf(profile: GenerationProfile): number {
  const sky = profile.art.backdrop.sky[1];
  return nearestMasterIndex(sky[0], sky[1], sky[2]);
}

/** 世代の量子化パスを組み立てる。分岐の根拠は世代 ID ではなくプロファイルの値 */
function quantizePassesFor(
  profile: GenerationProfile,
  scene: () => Framebuffer,
  sprites: () => Framebuffer | null,
): PostPassSpec[] {
  const { internalWidth: width, internalHeight: height } = profile.video;
  // 面を重ねるのは量子化パスだけなので、面を持たない世代でこれが呼ばれたら描く先が無い。
  // 黙って絵が消えるより、その場で落として profiles.ts の宣言との食い違いに気づけるようにする
  const spritePlane = (): Texture => {
    const plane = sprites();
    if (!plane) throw new Error(`${profile.id} の量子化はスプライト面を要求する（profiles.ts の player.kind）`);
    return plane.color;
  };

  // 固定パレット + ブロック単位の色数制限を持つのは第1世代のみ（signal で判別する）
  if (profile.video.signal === 'rf') {
    return createFcQuantizePasses({
      width,
      height,
      scene: () => scene().color,
      sprites: spritePlane,
      // 実機の「背景色」を空の色に合わせる（KV-04）。ブロックが 3 色を使い切っても、
      // 4 つ目の候補が空の色なら背景に穴が空かない。既定の黒のままだと、
      // 色数の多いブロックで空が黒く抜ける（基準画 F「どこにも黒が無い」に反する）
      backgroundIndex: () => backdropIndexOf(profile),
    });
  }
  // 第2世代は色数制限を持たないので、面は重ねるだけでよい（T2-11）
  if (profile.video.signal === 'composite') {
    return createSfcQuantizePasses({ width, height, sprites: spritePlane });
  }
  // 第3・第4世代は色量子化を行わない（CRT パスのみ）。プレイヤーもモデルなので面を持たない
  return [];
}

export function createPipeline(ctx: GLContext, options: PipelineOptions): Pipeline {
  const state: StateCache = createStateCache(ctx);

  // --- 起動時にすべて確保する ---
  const scenes = {} as Record<GenerationId, Framebuffer>;
  /** スプライト面。プレイヤーを絵で描く世代だけが持つ（T2-10） */
  const sprites = {} as Record<GenerationId, Framebuffer | null>;
  const chains = {} as Record<GenerationId, PostChain>;

  for (const id of GENERATION_IDS) {
    const profile = PROFILES[id];
    scenes[id] = createFramebuffer(ctx, {
      width: profile.video.internalWidth,
      height: profile.video.internalHeight,
      filter: profile.video.textureFilter,
      depth: profile.video.depthBuffer,
    });
    // 面には抜き（α）が要るので深度は持たせない。奥行きは「背景の上に重ねる」だけで足りる
    sprites[id] =
      profile.player.kind === 'sprite'
        ? createFramebuffer(ctx, {
            width: profile.video.internalWidth,
            height: profile.video.internalHeight,
            filter: profile.video.textureFilter,
          })
        : null;
    chains[id] = createPostChain(ctx, state, [
      ...quantizePassesFor(profile, () => scenes[id], () => sprites[id]),
      ...createCrtPasses({
        signal: () => profile.video.signal,
        quality: options.quality,
        contentSize: () => ({ width: profile.video.internalWidth, height: profile.video.internalHeight }),
        // 上書きを持たない呼び出し元（各スモークシーン）ではプリセットがそのまま通る
        ...(options.crtOverride ? { override: options.crtOverride } : {}),
      }),
      // CRT を切った場合でも、必ず 1 パスは通って出力先に書かれるようにする
      {
        name: 'present',
        fragmentSource: PRESENT,
        enabled: () => options.quality() === 'off',
      },
    ]);
  }

  // 世代の出力を受ける 2 枚（現世代と旧世代）。切替中でも 2 枚あれば足りる
  const outputs: [Framebuffer, Framebuffer] = [
    createFramebuffer(ctx, { width: 1, height: 1, filter: 'linear' }),
    createFramebuffer(ctx, { width: 1, height: 1, filter: 'linear' }),
  ];

  let blendValue = 0;
  let glitchValue = 0;
  const composeChain: PostChain = createPostChain(ctx, state, [
    {
      name: 'transition',
      fragmentSource: transitionSource,
      uniforms: () => ({
        uPrevious: outputs[0].color,
        uBlend: blendValue,
        uGlitch: glitchValue,
        // 光の帯の色は基準画の実測値（KV-08）。シェーダに 16 進数を置かないため、
        // `key_palette.ts` からここで渡す
        uRibbonCore: RIBBON_CORE,
        uRibbonLead: RIBBON_LEAD,
        uRibbonTrail: RIBBON_TRAIL,
      }),
    },
  ]);

  // ここで全シェーダのコンパイルが終わっている。以降のコンパイルは例外にする（V7）
  sealShaderCompilation();

  let lastGenerationsDrawn = 0;

  function renderGeneration(
    id: GenerationId,
    request: RenderRequest,
    drawScene: SceneDrawer,
    drawSprites: SpriteDrawer | undefined,
    target: Framebuffer,
  ): void {
    const profile = PROFILES[id];
    const scene = scenes[id];
    scene.bind();
    // 深度の有無はプロファイルが決める（第3世代は深度バッファを持たない）
    state.apply({
      depthTest: profile.video.depthBuffer,
      depthWrite: profile.video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
    state.clear(0, 0, 0, 1, profile.video.depthBuffer);
    drawScene(profile);

    // スプライト面（T2-10）。**α = 0 で塗り潰す**ことで「何も描かれていない」を表す。
    // 面を持つ世代でも、絵を描かない呼び出し元（各スモークシーン）では空のまま量子化へ渡る
    const plane = sprites[id];
    if (plane) {
      plane.bind();
      state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'back' });
      state.clear(0, 0, 0, 0, false);
      drawSprites?.(profile);
    }

    chains[id].run(scene.color, request.screenWidth, request.screenHeight, request.timeSeconds, target);
  }

  return {
    sceneTarget: (generation) => scenes[generation],
    spriteTarget: (generation) => sprites[generation],
    get lastGenerationsDrawn() {
      return lastGenerationsDrawn;
    },
    render(request, drawScene, drawSprites): void {
      const blend = request.blend ?? 1;
      const from = request.from ?? null;
      const transitioning = from !== null && from !== request.generation && blend < 1;

      if (transitioning) {
        renderGeneration(from, request, drawScene, drawSprites, outputs[0]);
        lastGenerationsDrawn = 2;
      } else {
        lastGenerationsDrawn = 1;
      }
      renderGeneration(request.generation, request, drawScene, drawSprites, outputs[1]);

      blendValue = transitioning ? blend : 1;
      glitchValue = transitioning ? (options.glitchAmount?.() ?? 1) : 0;

      bindScreen(ctx, request.screenWidth, request.screenHeight);
      composeChain.run(
        outputs[1].color,
        request.screenWidth,
        request.screenHeight,
        request.timeSeconds,
      );
    },
    dispose(): void {
      composeChain.dispose();
      for (const output of outputs) output.dispose();
      for (const id of GENERATION_IDS) {
        chains[id].dispose();
        scenes[id].dispose();
        sprites[id]?.dispose();
      }
    },
  };
}
