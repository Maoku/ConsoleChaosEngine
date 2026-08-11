/**
 * 本編の 3D 描画（T0-08 で置き場だけ作り、T1-24 で本実装）。
 *
 * **ここはレベルもパズルも知らない。**`render/frame.ts` に積まれたものを描くだけで、
 * 「何を積むか」は `gameplay/scene.ts` が決める（§4.2 の依存方向）。
 *
 * 世代差はすべて `GenerationProfile` の値から出す。世代 ID による分岐は書かない（不変条件 I2）。
 *
 * | プロファイル値 | ここでの現れ方 |
 * |---|---|
 * | `projection` | 正射影 / 透視投影 |
 * | `depthBuffer` | 深度テストの有無。持たない世代は奥から順に描く |
 * | `vertexQuantize` | 頂点の揺れ（シェーダ側。分割した面で「波打ち」になる） |
 * | `affineTexture` | UV の遠近補正なし（シェーダ側） |
 * | `textureFilter` | nearest / linear |
 * | `animationHz` | ボーンアニメのコマ落ち（再生時刻の量子化） |
 * | `player.kind` | プレイヤーを骨のあるモデルで描くか、コマ送りの絵で描くか（T2-09） |
 * | `art.backdrop` | 背景（空と最大 2 枚の層）。シーンの最初に 1 枚敷く（KV-02） |
 * | `art.textureSet` | どのセットの絵を貼るか。**セット名を前に付けるのはここだけ**（KV-03） |
 * | `art.fogDensity` | 遠景を背景色へ溶かす濃さ（シェーダ側。KV-06） |
 */
import { mat4, vec3 } from 'gl-matrix';
import {
  createBuffer,
  createProgram,
  createStateCache,
  createTexture,
  createVertexArray,
  type GLBuffer,
  type GLContext,
  type Program,
  type StateCache,
  type Texture,
  type VertexArray,
} from './gl/index';
import { createCamera, type Camera } from './camera';
import { billboardMesh, boxMesh, quadMesh } from './geometry';
import { spriteCellCount, spriteCellOf, spriteUvRect } from './sprite_sheet';
import { projectShadowQuad } from './shadow';
import type { Frame, FrameDrawable } from './frame';
import { DEFAULT_AMBIENT, DEFAULT_DIFFUSE, MATERIALS, requiredModels, requiredTextures, type Material } from './material';
import { createSortWorkspace, sortTrianglesByDepth, type TriangleSortWorkspace } from './sort';
import {
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  loadGltf,
  sampleAnimation,
  type GltfModel,
  type GltfPrimitive,
} from './loader/gltf';
import {
  PROFILES,
  type ArtProfile,
  type BackdropLayer,
  type GenerationProfile,
  type PlayerModelProfile,
  type PlayerSpriteProfile,
  type VideoProfile,
} from '@/generation/profiles';
import ps1Vertex from './shaders/ps1_vertex.glsl?raw';
import ps1Fragment from './shaders/ps1_forward.glsl?raw';
import skinnedVertex from './shaders/skinned_test.vert.glsl?raw';
import backdropVertex from './shaders/backdrop.vert.glsl?raw';
import backdropFragment from './shaders/backdrop.frag.glsl?raw';

/** 世界を照らす固定光。T0-15 から変えていない */
const STATIC_LIGHT: [number, number, number] = [0.4, 1, 0.6];

/**
 * 上下に揺れる速さ（ラジアン / 秒。SG-07）。
 * 1 往復におよそ 6 秒。速くすると「浮いている」ではなく「揺れている」に見える
 */
const FLOAT_RATE = 1.0;

/** 落ち影の濃さ（0..1）。1 で真っ黒 */
const SHADOW_STRENGTH = 0.72;

/**
 * UV を送らないときの uUvScroll（SG-08）。
 * **uniform はプログラムに残る**ので、送らないものには毎回 0 を渡し直す
 */
const NO_UV_SCROLL: [number, number] = [0, 0];

/** 明度（`common.glsl` の luma と同じ重み）。環境光の色を正規化するのに使う */
function luma(color: readonly number[]): number {
  return 0.299 * color[0]! + 0.587 * color[1]! + 0.114 * color[2]!;
}

/** 陰影を受けない板（落ち影・スプライト）へ渡す環境光。色を乗せない */
const WHITE_AMBIENT: [number, number, number] = [1, 1, 1];

/** 松明が消えているときの uTorch（w = 0 なら点光源なし） */
const NO_TORCH: [number, number, number, number] = [0, 0, 0, 0];

/** 霧を掛けないときの uFog（w = 0 なら霧なし） */
const NO_FOG: [number, number, number, number] = [0, 0, 0, 0];

/** 回る面のテクスチャの繰り返し数。面の半径（24m）に合わせてある */
const PLANE_UV_REPEAT = 24;

/** 背景の層を持たないときに渡す矩形。x（繰り返し数）が 0 以下なら層は描かれない */
const NO_LAYER: [number, number, number, number] = [0, 0, 0, 0];

/**
 * 層を持たないときにサンプラへ通す絵。使われないが、束ねないと GL が警告を出す。
 * 影の板が同じ理由で `stone_floor.png` を通しているのと同じ扱い
 */
const FALLBACK_TEXTURE = 'stone_floor.png';

/** 当たり判定の中心（腰）からモデルの原点（足元）までの高さ。PlayerBody の既定値の半分 */
export const PLAYER_FEET_OFFSET = 0.8;

/**
 * スプライトの抜きのしきい値（T2-09）。
 *
 * アトラスのアルファは既に 0 か 255 なので、間のどこで切っても結果は同じ。
 * 半透明合成を持たない世代の絵なので、混ぜずに抜く。
 */
const SPRITE_ALPHA_CUTOFF = 0.5;

export interface Renderer3dOptions {
  /** アセットの基準 URL（`import.meta.env.BASE_URL`） */
  assets: string;
  /** 描画対象。レベル読み込み時に 1 度だけ決まる */
  drawables: readonly FrameDrawable[];
  /**
   * 動きの強さ（0..1、既定 1。SG-07 / SG-08）。毎フレーム評価される。
   *
   * 雲の上下（`Material.float`）と滝の UV 送り（`Material.uvScrollY`）に掛かる。
   * `PipelineOptions.glitchAmount` と同じ形にしてあるので、
   * T3-06 で光過敏の設定画面を作るときに 1 か所から両方へ配れる
   *（`src/ui/a11y.ts` は現在まだ空のファイルで、設定の本体は無い）
   */
  motionAmount?: () => number;
}

export interface Renderer3d {
  /**
   * 背景（BG 面）を 1 フレーム描く。パイプラインの `SceneDrawer` からそのまま呼べる形。
   * **プレイヤーを絵で描く世代では、プレイヤーはここに含まれない**（`drawSprites`）
   */
  draw(profile: GenerationProfile, frame: Frame): void;
  /**
   * スプライト面を 1 フレーム描く（T2-10）。パイプラインの `SpriteDrawer` の形。
   * 絵で描かない世代では何もしない（プレイヤーは `draw` の側に出る）
   */
  drawSprites(profile: GenerationProfile, frame: Frame): void;
  /** 直近のフレームで描いた三角形数（予算の確認用。asset-rules.md §8） */
  readonly triangleCount: number;
  dispose(): void;
}

/** 描ける形 1 つ */
interface Shape {
  vao: VertexArray;
  count: number;
  triangles: number;
  /**
   * glTF のノード変換（頂点はノード座標系のまま持っているので、描くときに掛ける）。
   * 単位行列のときは持たない。`inverse` は三角形ソートでカメラを送るのに使う
   */
  local?: { matrix: mat4; inverse: mat4 };
  /** 三角形単位のソートに要るもの（`polygonSort` の材質だけが持つ。T1-27） */
  sortable?: {
    positions: Float32Array;
    indices: Uint16Array;
    out: Uint16Array;
    workspace: TriangleSortWorkspace;
  };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error(`テクスチャを読めない: ${url}`));
    image.src = url;
  });
}

export async function createRenderer3d(ctx: GLContext, options: Renderer3dOptions): Promise<Renderer3d> {
  const { gl } = ctx;
  const disposables: Array<{ dispose(): void }> = [];
  const state: StateCache = createStateCache(ctx);
  const camera: Camera = createCamera('perspective');
  const model = mat4.create();
  /** ノード変換を掛けた後の行列（部品ごとに使い回す） */
  const partModel = mat4.create();

  // --- テクスチャ（KV-03 で世代ごとの 4 セットになった）---
  //
  // 敷き詰める面が繰り返しを使うので wrap は repeat。
  // v=0 を画像の下端にしたいので上下を入れ替えて読む（UV は素直に書ける）。
  //
  // **材質表（`material.ts`）は世代を知らない。** セットのディレクトリ名を前に付けるのは
  // ここだけの仕事で、鍵は `<セット>/<ファイル名>`（計画 §3 の決定 3）。
  // 4 セットとも起動時に読む。切替の瞬間に読み込みが走らないための前提（V7 と同じ趣旨）
  const sets = [...new Set(Object.values(PROFILES).map((profile) => profile.art.textureSet))];
  const wanted = new Set<string>();
  for (const profile of Object.values(PROFILES)) {
    const set = profile.art.textureSet;
    for (const file of requiredTextures()) wanted.add(`${set}/${file}`);
    // 背景の層は材質表に載らない（材質ではないので）。プロファイルから直接集める
    for (const layer of [profile.art.backdrop.far, profile.art.backdrop.near]) {
      if (layer) wanted.add(`${set}/${layer.texture}`);
    }
  }
  const loaded = await Promise.all(
    [...wanted].map(async (key) => [key, await loadImage(`${options.assets}assets/textures/${key}`)] as const),
  );
  const textures = new Map<string, Texture>();
  for (const [file, image] of loaded) {
    const texture = createTexture(ctx, {
      width: image.naturalWidth,
      height: image.naturalHeight,
      filter: 'nearest',
      wrap: 'repeat',
      flipY: true,
      data: image,
    });
    textures.set(file, texture);
    disposables.push(texture);
  }

  const program: Program = createProgram(ctx, 'scene', ps1Vertex, ps1Fragment);
  disposables.push(program);

  // 背景（KV-02）。頂点バッファを持たない全画面 1 枚で、シーンの最初に敷く
  const backdropProgram: Program = createProgram(ctx, 'backdrop', backdropVertex, backdropFragment);
  disposables.push(backdropProgram);

  /** 分割つきの箱（position/normal/uv をまとめた 1 本のバッファ） */
  function buildInterleaved(vertices: Float32Array, indices: Uint16Array): Shape {
    const stride = 8 * 4;
    const vbo = createBuffer(ctx, 'vertex', vertices);
    const ibo = createBuffer(ctx, 'index', indices);
    disposables.push(vbo, ibo);
    const vao = createVertexArray(
      ctx,
      [
        { location: 0, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 0 },
        { location: 1, size: 3, buffer: vbo, strideBytes: stride, offsetBytes: 12 },
        { location: 2, size: 2, buffer: vbo, strideBytes: stride, offsetBytes: 24 },
      ],
      { buffer: ibo, type: 'ushort' },
    );
    disposables.push(vao);
    return { vao, count: indices.length, triangles: indices.length / 3 };
  }

  /** glTF のプリミティブ（位置・法線・UV が別バッファ） */
  function buildPrimitive(primitive: GltfPrimitive, skinned = false, sortable = false): Shape {
    const vertexCount = primitive.positions.length / 3;
    const buffers: GLBuffer[] = [
      createBuffer(ctx, 'vertex', primitive.positions),
      createBuffer(ctx, 'vertex', primitive.normals ?? new Float32Array(vertexCount * 3)),
      createBuffer(ctx, 'vertex', primitive.uvs ?? new Float32Array(vertexCount * 2)),
    ];
    if (skinned) {
      // JOINTS_0 は整数だが、属性としては float で渡す（実装を単純に保つ。T1-08 と同じ）
      buffers.push(
        createBuffer(ctx, 'vertex', new Float32Array(primitive.joints ?? new Uint16Array(vertexCount * 4))),
        createBuffer(ctx, 'vertex', primitive.weights ?? new Float32Array(vertexCount * 4)),
      );
    }
    // ソートし直すものは毎フレーム書き換えるので dynamic で確保する（§5.4.3）
    const ibo = createBuffer(ctx, 'index', primitive.indices, sortable ? 'dynamic' : 'static');
    disposables.push(...buffers, ibo);
    const sizes: Array<1 | 2 | 3 | 4> = [3, 3, 2, 4, 4];
    const vao = createVertexArray(
      ctx,
      buffers.map((buffer, index) => ({ location: index, size: sizes[index]!, buffer })),
      { buffer: ibo, type: primitive.indices instanceof Uint32Array ? 'uint' : 'ushort' },
    );
    disposables.push(vao);
    const shape: Shape = { vao, count: primitive.indices.length, triangles: primitive.indices.length / 3 };
    if (sortable && primitive.indices instanceof Uint16Array) {
      shape.sortable = {
        positions: primitive.positions,
        indices: primitive.indices,
        out: new Uint16Array(primitive.indices.length),
        workspace: createSortWorkspace(primitive.indices.length / 3),
      };
    }
    return shape;
  }

  // プロップは種類ごとに 1 つだけ作って使い回す（同じ敵が 10 体並んでもバッファは 1 組）。
  // 三角形ソートの対象になるモデルは、インデックスを毎フレーム書き換えるので
  // **同じモデルを 2 箇所で使えない**。今は殻 1 つだけなので許容する
  const sortedModels = new Set(
    Object.values(MATERIALS).filter((material) => material.polygonSort && material.model).map((m) => m.model!),
  );
  /**
   * プロップを組み立てる。
   *
   * **メッシュではなくノードをたどる。** 頂点は自分のノードの座標系で書かれているので、
   * ノード変換を落とすと絵だけが当たり判定からずれる（T1-29 で判明。P1-2 の殻は
   * ノードに -0.875 / +0.75 の平行移動があり、殻が 1.75m ずれて描かれていた）。
   */
  function buildProp(gltf: GltfModel, sortable: boolean): Shape[] {
    const globals = new Float32Array(gltf.nodes.length * 16);
    computeGlobalMatrices(gltf, createPose(gltf), globals);
    const identity = mat4.create();
    const parts: Shape[] = [];
    gltf.nodes.forEach((node, index) => {
      if (node.mesh === null) return;
      const matrix = mat4.clone(globals.subarray(index * 16, index * 16 + 16));
      const moved = !mat4.exactEquals(matrix, identity);
      for (const primitive of gltf.meshes[node.mesh]?.primitives ?? []) {
        const shape = buildPrimitive(primitive, false, sortable);
        if (moved) shape.local = { matrix, inverse: mat4.invert(mat4.create(), matrix) ?? identity };
        parts.push(shape);
      }
    });
    return parts;
  }

  const props = new Map<string, Shape[]>();
  for (const name of requiredModels()) {
    const gltf: GltfModel = await loadGltf(`${options.assets}assets/models/${name}.gltf`);
    props.set(name, buildProp(gltf, sortedModels.has(name)));
  }

  // 落ち影は床に貼る 1 枚の板（T1-26）。大きさは毎フレーム行列で変える
  const shadowQuad = ((): Shape => {
    const mesh = quadMesh();
    return buildInterleaved(mesh.vertices, mesh.indices);
  })();

  // 回る面（S-1、T2-03）。半径 24m へ引き伸ばすので、模様は 24 回繰り返す
  const planeQuad = ((): Shape => {
    const mesh = quadMesh(PLANE_UV_REPEAT);
    return buildInterleaved(mesh.vertices, mesh.indices);
  })();

  /**
   * 要素ごとの形。
   *
   * プロップは **[-1, 1] の単位箱**で作ってあるので、描くときに halfExtents を掛ける。
   * 箱は分割数と UV が大きさで決まるため**実寸で作る**ので、掛けてはいけない
   *（両方に掛けると寸法が二乗になる）。この違いを `scaled` で持つ。
   */
  const shapes: Array<{ parts: Shape[]; scaled: boolean }> = options.drawables.map((drawable) => {
    const prop = drawable.material.model === null ? undefined : props.get(drawable.material.model);
    if (prop) return { parts: prop, scaled: true };
    const mesh = boxMesh(drawable.halfExtents, { uvScale: drawable.material.uvScale });
    return { parts: [buildInterleaved(mesh.vertices, mesh.indices)], scaled: false };
  });

  // --- プレイヤー（スキンメッシュ） ---
  // モデルは世代ごとに違う（T2-07）。どれを使うかは GenerationProfile.player が決めるので、
  // ここは「プロファイルが挙げたファイルをすべて読む」だけで、世代を知らない（不変条件 I2）。
  // 絵で描く世代（T2-09）はモデルを持たないので、ここでは読み飛ばす。
  const playerProgram: Program = createProgram(ctx, 'player', skinnedVertex, ps1Fragment);
  disposables.push(playerProgram);

  /** 1 つのモデルぶんの描画資源。世代を跨いで使い回すので毎フレーム作らない */
  interface PlayerRig {
    model: GltfModel;
    parts: Shape[];
    /** 部位ごとの色。色だけで作ったモデル（T1-08）はここで塗り分ける */
    colors: Array<[number, number, number, number]>;
    /** 部位ごとの絵。持たない部位は白 1 色を通し、色だけで決まるようにする */
    maps: Texture[];
    pose: ReturnType<typeof createPose>;
    globals: Float32Array;
    jointMatrices: Float32Array;
    clips: string[];
  }

  /** glTF に埋め込まれた絵を GL テクスチャにする。UV の原点は左上（glTF 既定）なので反転しない */
  async function uploadEmbedded(model: GltfModel, key: string): Promise<Array<Texture | null>> {
    return Promise.all(
      model.images.map(async (image, index) => {
        if (!image.data) return null;
        const bitmap = await createImageBitmap(new Blob([image.data as BlobPart], { type: image.mimeType }));
        const texture = createTexture(ctx, {
          width: bitmap.width,
          height: bitmap.height,
          filter: 'nearest',
          data: bitmap,
        });
        // 世代ごとのフィルタ切替と後始末を、外の絵と同じ経路に乗せる
        textures.set(`${key}#${index}`, texture);
        disposables.push(texture);
        return texture;
      }),
    );
  }

  const rigs = new Map<string, PlayerRig>();
  for (const profile of Object.values(PROFILES)) {
    if (profile.player.kind !== 'model') continue;
    const file = profile.player.file;
    if (rigs.has(file)) continue;
    const model: GltfModel = await loadGltf(`${options.assets}assets/models/${file}`);
    const embedded = await uploadEmbedded(model, file);
    const primitives = model.meshes.flatMap((mesh) => mesh.primitives);
    rigs.set(file, {
      model,
      parts: primitives.map((primitive) => buildPrimitive(primitive, true)),
      colors: primitives.map((primitive) => {
        const material = primitive.material === null ? null : model.materials[primitive.material];
        return (material?.baseColorFactor ?? [1, 1, 1, 1]) as [number, number, number, number];
      }),
      maps: primitives.map((primitive) => {
        const material = primitive.material === null ? null : model.materials[primitive.material];
        const image = material?.baseColorImage ?? null;
        return (image === null ? null : (embedded[image] ?? null)) ?? textures.get(`${sets[0]}/${FALLBACK_TEXTURE}`)!;
      }),
      pose: createPose(model),
      globals: new Float32Array(model.nodes.length * 16),
      jointMatrices: new Float32Array(Math.max(model.skins[0]?.joints.length ?? 1, 1) * 16),
      clips: model.animations.map((animation, index) => animation.name || `anim${index}`),
    });
  }

  // --- プレイヤー（スプライト。T2-09）---
  // 絵で描く世代のアトラスを読み、**セルごとに 1 枚の板**を作っておく。
  // UV を焼き込んだ板を並べておけば、コマ送りは「どの板を描くか」を選ぶだけになり、
  // シェーダにも毎フレームのバッファ書き換えにも手を入れずに済む
  interface PlayerSheet {
    texture: Texture;
    /** セル番号ごとの板。UV は焼き込み済み */
    cells: Shape[];
  }

  const sheets = new Map<string, PlayerSheet>();
  for (const profile of Object.values(PROFILES)) {
    const sprite = profile.player;
    if (sprite.kind !== 'sprite' || sheets.has(sprite.file)) continue;
    const image = await loadImage(`${options.assets}assets/sprites/${sprite.file}`);
    // UV の原点は左上なので上下は入れ替えない。端の繰り返しは無いので clamp
    const texture = createTexture(ctx, {
      width: image.naturalWidth,
      height: image.naturalHeight,
      filter: 'nearest',
      data: image,
    });
    // 世代ごとのフィルタ切替と後始末を、他の絵と同じ経路に乗せる
    textures.set(sprite.file, texture);
    disposables.push(texture);
    const cells: Shape[] = [];
    for (let cell = 0; cell < spriteCellCount(sprite); cell++) {
      const mesh = billboardMesh(spriteUvRect(sprite, cell));
      cells.push(buildInterleaved(mesh.vertices, mesh.indices));
    }
    sheets.set(sprite.file, { texture, cells });
  }

  // --- 毎フレームの作業領域（アロケーションを起こさない） ---
  /** いま描いている世代のテクスチャセット。`beginPass` が合わせる（KV-03） */
  let currentSet = sets[0]!;
  /** 直近に流し込んだフィルタ。世代が変わったときだけ 44 枚を触り直す */
  let appliedFilter: VideoProfile['textureFilter'] | null = null;
  const distances = new Float32Array(options.drawables.length);
  const order: number[] = Array.from({ length: options.drawables.length }, (_, i) => i);
  let triangleCount = 0;
  /** このフレームの松明。動的ライティングを持つ世代だけ w > 0 になる（T2-04） */
  const currentTorch: [number, number, number, number] = [0, 0, 0, 0];
  /**
   * このフレームの霧（KV-06）。色は背景の下端そのもので、濃さは `art.fogDensity`。
   * **加算合成のパスでは 0 に戻す**（足し算の上に霧の色を足すと、遠いものほど明るくなる）
   */
  const currentFog: [number, number, number, number] = [0, 0, 0, 0];
  /** モデル空間へ移したカメラ位置（三角形ソート用の作業領域） */
  const localCamera = new Float32Array(3);
  /** 環境光に掛ける色（明度 1 に正規化した空の下端色。SG-09） */
  const ambientTint: [number, number, number] = [1, 1, 1];
  /** 材質の取り分に色を掛けた環境光。毎フレーム作り直さないよう使い回す */
  const ambient: [number, number, number] = [0, 0, 0];

  /** `material.ambient × 空の色`。**明度は材質の値のまま**（判断 G） */
  function ambientOf(material: Material): [number, number, number] {
    for (let c = 0; c < 3; c++) ambient[c] = material.ambient * ambientTint[c]!;
    return ambient;
  }

  /**
   * 材質が挙げた絵を、**いま描いている世代のセットから**引く（KV-03）。
   * 材質表はセットを知らないので、ここが唯一の対応づけになる。
   */
  function textureOf(file: string): Texture {
    const texture = textures.get(`${currentSet}/${file}`);
    // 読んでいない絵を求められたら黙って別の絵を貼らずに落とす。
    // GL のサンプラは既定でユニット 0 を指すので、抜けると**直前に誰かが 0 番へ束ねた絵**が出る
    if (!texture) throw new Error(`${currentSet}/${file} を読み込んでいない（起動時の一覧に無い）`);
    return texture;
  }

  function drawShape(shape: Shape): void {
    shape.vao.bind();
    gl.drawElements(gl.TRIANGLES, shape.count, shape.vao.indexType, 0);
    triangleCount += shape.triangles;
  }

  /**
   * 描くものを選び、必要なら奥から順に並べる。
   *
   * - 不透明：深度バッファを持たない世代でのみ並べ替える（実機と同じく順序が前後関係を決める）
   * - 半透明：**どの世代でも**奥から描く。手前から描くと後ろのものが混ざらない
   */
  function collect(frame: Frame, translucent: boolean, sorted: boolean): number {
    let count = 0;
    for (let i = 0; i < options.drawables.length; i++) {
      if (frame.visible[i] === 0) continue;
      const material = options.drawables[i]!.material;
      if (material.translucent !== translucent) continue;
      const dx = frame.positions[i * 3]! - camera.position[0]!;
      const dy = frame.positions[i * 3 + 1]! - camera.position[1]!;
      const dz = frame.positions[i * 3 + 2]! - camera.position[2]!;
      distances[i] = dx * dx + dy * dy + dz * dz;
      order[count++] = i;
    }
    if (sorted) {
      const active = order.slice(0, count);
      active.sort((a, b) => distances[b]! - distances[a]!);
      for (let i = 0; i < count; i++) order[i] = active[i]!;
    }
    return count;
  }

  /**
   * 落ち影（T1-26 → T2-05）。**松明（点光源）が落とす影**なので、
   * プレイヤーが動くと影が扇のように振れる。動く光源を持つ世代でだけ通る。
   *
   * 影は単色の板で描く。改訂前はテクスチャのアルファを輪郭に使っていたが、
   * 実効の濃さが 0.21 にしかならず読めなかった（ギミックレビュー P2-1）。
   */
  function drawShadows(video: VideoProfile, frame: Frame): void {
    const light: [number, number, number] = [
      frame.torch.position[0],
      frame.torch.position[1],
      frame.torch.position[2],
    ];
    state.apply({ blend: 'alpha', depthWrite: false });
    for (let i = 0; i < options.drawables.length; i++) {
      const drawable = options.drawables[i]!;
      if (frame.visible[i] === 0 || !drawable.material.castShadow) continue;
      const quad = projectShadowQuad(
        [frame.positions[i * 3]!, frame.positions[i * 3 + 1]!, frame.positions[i * 3 + 2]!],
        drawable.halfExtents,
        drawable.groundY,
        light,
      );
      if (quad.strength <= 0) continue;
      mat4.identity(model);
      mat4.translate(model, model, quad.center);
      mat4.scale(model, model, quad.half);
      program.setUniforms({
        uModel: model as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [video.internalWidth, video.internalHeight],
        uQuantizeStep: video.vertexQuantize,
        uAffineAmount: video.affineTexture ? 1 : 0,
        // 不透明・模様つきだが、RGB は 0 倍され、使うのはアルファ（＝1）だけ
        uBaseColor: textureOf(FALLBACK_TEXTURE),
        // 影の板は上を向いているので 2 枚目のほうが読まれる。同じ絵を束ねる（SG-04）
        uTopColor: textureOf(FALLBACK_TEXTURE),
        // RGB を 0 にして、アルファのぶんだけ床を暗くする（掛け算の影）
        uBaseColorFactor: [0, 0, 0, SHADOW_STRENGTH * quad.strength],
        uLightDirection: [0, 1, 0],
        // 影そのものは陰影を受けない（掛け算で暗くする板なので、明るさは 1 で固定）
        uAmbient: WHITE_AMBIENT,
        uDiffuse: 0,
        uTorch: NO_TORCH,
        // 影は床の色を直接暗くする板なので、霧はその床のほうに掛かっている
        uFog: NO_FOG,
        uUvScroll: NO_UV_SCROLL,
        uAlphaCutoff: 0,
      });
      drawShape(shadowQuad);
    }
    state.apply({ blend: 'none', depthWrite: video.depthBuffer });
  }

  /**
   * 背景（KV-02、計画 §3 の決定 4）。**他の何よりも先に、全画面の面として 1 枚描く。**
   *
   * 深度は書かないので、後から来る形はそのまま上へ乗る。
   * `pipeline.ts` の黒クリアは残してあり、ここが描かなかった場合の下地になる。
   *
   * 層のテクスチャは世代のセットから引く。**材質表は世代を知らないまま**で、
   * セット名を前に付けるのはここだけの仕事にする（計画 §3 の決定 3）。
   */
  function drawBackdrop(art: ArtProfile, video: VideoProfile, frame: Frame): void {
    const [top, bottom] = art.backdrop.sky;
    // 縦のパララックスは層の**置き場**（下端）を動かすだけにする（BR-01 の決定 2）。
    // UV の v をずらすと帯の中で絵が伸び縮みして見切れるので、シェーダは触らない
    const rect = (layer: BackdropLayer | null): [number, number, number, number] =>
      layer === null
        ? NO_LAYER
        : [
            layer.repeat,
            frame.backdrop.offset * layer.scroll,
            layer.bottom - frame.backdrop.verticalOffset * layer.scrollY,
            layer.height,
          ];
    const map = (layer: BackdropLayer | null): Texture =>
      textureOf(layer === null ? FALLBACK_TEXTURE : layer.texture);

    // 全画面 1 枚なので、深度もカリングも要らない
    state.apply({ depthTest: false, depthWrite: false, blend: 'none', cull: 'none' });
    backdropProgram.use();
    // 形を持たない描画なので、直前の形が残した頂点配列を外しておく
    gl.bindVertexArray(null);
    backdropProgram.setUniforms({
      uSkyTop: [top[0] / 255, top[1] / 255, top[2] / 255],
      uSkyBottom: [bottom[0] / 255, bottom[1] / 255, bottom[2] / 255],
      uFar: map(art.backdrop.far),
      uNear: map(art.backdrop.near),
      uFarRect: rect(art.backdrop.far),
      uNearRect: rect(art.backdrop.near),
      // 空の見えない部屋では 0 へ向かう（BR-03）。決めるのは gameplay/scene.ts
      uBrightness: frame.backdrop.brightness,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    triangleCount += 1;
    // シーンの描画状態へ戻す
    state.apply({
      depthTest: video.depthBuffer,
      depthWrite: video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });
  }

  /**
   * 回る面（S-1、T2-03）。**画面いっぱいの床を 1 枚の面として回す。**
   * 回せる世代でだけ描く。当たり判定は持たない（島の公転はパズル側が受け持つ）。
   */
  function drawPlane(video: VideoProfile, frame: Frame): void {
    if (!frame.plane.visible) return;
    mat4.identity(model);
    mat4.translate(model, model, frame.plane.center);
    mat4.rotateY(model, model, frame.plane.angle);
    mat4.scale(model, model, [frame.plane.radius, 1, frame.plane.radius]);
    program.setUniforms({
      uModel: model as Float32Array,
      uViewProjection: camera.viewProjection as Float32Array,
      uResolution: [video.internalWidth, video.internalHeight],
      uQuantizeStep: video.vertexQuantize,
      uAffineAmount: video.affineTexture ? 1 : 0,
      uBaseColor: textureOf(MATERIALS['affine_floor']!.texture),
      uTopColor: textureOf(MATERIALS['affine_floor']!.texture),
      uBaseColorFactor: [...MATERIALS['affine_floor']!.color],
      uLightDirection: STATIC_LIGHT,
      uAmbient: ambientOf(MATERIALS['affine_floor']!),
      uDiffuse: MATERIALS['affine_floor']!.diffuse,
      uTorch: currentTorch,
      uFog: currentFog,
      uUvScroll: NO_UV_SCROLL,
      uAlphaCutoff: 0,
    });
    drawShape(planeQuad);
  }

  /**
   * 上下の揺れ（SG-07）。**位相は要素の位置から作る**ので、同じ入力から同じ動きが出る。
   * `gameplay/` はこれを知らない（`frame.positions` は書き換えない）。
   */
  function floatOffset(material: Material, x: number, z: number, seconds: number, motion: number): number {
    if (material.float === 0 || motion === 0) return 0;
    return Math.sin(seconds * FLOAT_RATE + x * 0.7 + z * 1.3) * material.float * motion;
  }

  function drawItem(index: number, video: VideoProfile, frame: Frame): void {
    const drawable = options.drawables[index]!;
    const material = drawable.material;
    const shape = shapes[index]!;
    const motion = options.motionAmount?.() ?? 1;
    const x = frame.positions[index * 3]!;
    const z = frame.positions[index * 3 + 2]!;
    mat4.identity(model);
    mat4.translate(model, model, [
      x,
      frame.positions[index * 3 + 1]! + floatOffset(material, x, z, frame.timeSeconds, motion),
      z,
    ]);
    // 単位箱で作ったプロップだけ大きさを掛ける（箱は実寸で作ってある）
    if (shape.scaled) mat4.scale(model, model, drawable.halfExtents);
    program.setUniforms({
      uModel: model as Float32Array,
      uViewProjection: camera.viewProjection as Float32Array,
      uResolution: [video.internalWidth, video.internalHeight],
      uQuantizeStep: video.vertexQuantize,
      uAffineAmount: video.affineTexture ? 1 : 0,
      uBaseColor: textureOf(material.texture),
      // 天面の絵を持たない材質には**同じ絵を 2 つ目のサンプラにも束ねる**（SG-04）
      uTopColor: textureOf(material.topTexture ?? material.texture),
      uBaseColorFactor: [...material.color],
      uLightDirection: STATIC_LIGHT,
      // 陰影の取り分は材質が決める。暗室（P2-1）だけが環境光をほぼ 0 にしている。
      // 色は空から来る（SG-09）。明度は材質の値のままなので、暗室の暗さは変わらない
      uAmbient: ambientOf(material),
      uDiffuse: material.diffuse,
      uTorch: currentTorch,
      uFog: currentFog,
      // 滝（SG-08）。頂点シェーダで UV へ加える。0 なら送らない
      uUvScroll: [0, material.uvScrollY * motion * frame.timeSeconds],
      uAlphaCutoff: material.alphaCutoff,
    });

    // 三角形単位のソート（T1-27）。
    // 深度バッファを持たない透視投影の世代でだけ通る。**重心の遠近と画素ごとの遠近は
    // 一致しない**ので、食い込んだ板どうしは交差線に沿って入れ替わって見える＝継ぎ目が裂ける
    const sorts =
      material.polygonSort && !video.depthBuffer && video.projection === 'perspective3d';
    for (const part of shape.parts) {
      // ノード変換を持つ部品は、そのぶんだけさらに動かす（glTF の階層をここで解く）
      if (part.local) mat4.multiply(partModel, model, part.local.matrix);
      program.setUniforms({ uModel: (part.local ? partModel : model) as Float32Array });

      if (sorts && part.sortable) {
        const { positions, indices, out, workspace } = part.sortable;
        // カメラをモデル空間へ移す（拡大縮小と平行移動は割り算・引き算で解ける）
        for (let axis = 0; axis < 3; axis++) {
          localCamera[axis] =
            (camera.position[axis]! - frame.positions[index * 3 + axis]!) /
            (shape.scaled ? drawable.halfExtents[axis]! : 1);
        }
        // ノード変換のぶんも戻さないと、ソートの向きが実際の見え方とずれる
        if (part.local) vec3.transformMat4(localCamera, localCamera, part.local.inverse);
        sortTrianglesByDepth(positions, indices, localCamera, out, workspace);
        part.vao.updateIndices(out);
      }
      drawShape(part);
    }
  }

  /**
   * プレイヤーを絵で描く（T2-09）。**板 1 枚をカメラの方へ立てるだけ。**
   *
   * セルの下端が接地線なので、板の下辺を足元へ合わせる。
   * 素材は右向きなので、左を向くときは X を反転する。
   * 裏返ると面の向きも裏になるため、この 1 枚だけ間引きを切る。
   */
  function drawPlayerSprite(sprite: PlayerSpriteProfile, video: VideoProfile, frame: Frame): void {
    const sheet = sheets.get(sprite.file)!;
    const cell = spriteCellOf(sprite.clips[frame.player.clip], frame.player.animationSeconds);
    const half = sprite.worldSize / 2;

    mat4.identity(model);
    mat4.translate(model, model, [
      frame.player.position[0],
      frame.player.position[1] - PLAYER_FEET_OFFSET + half,
      frame.player.position[2],
    ]);
    mat4.scale(model, model, [frame.player.facing * half, half, 1]);

    state.apply({ cull: 'none' });
    program.use();
    program.setUniforms({
      uModel: model as Float32Array,
      uViewProjection: camera.viewProjection as Float32Array,
      uResolution: [video.internalWidth, video.internalHeight],
      uQuantizeStep: video.vertexQuantize,
      uAffineAmount: video.affineTexture ? 1 : 0,
      uBaseColor: sheet.texture,
      uTopColor: sheet.texture,
      uBaseColorFactor: [...frame.player.tint],
      uLightDirection: STATIC_LIGHT,
      // 絵に陰影は焼き込まれている。立体として照らすと平らな板だと分かってしまう
      uAmbient: WHITE_AMBIENT,
      uDiffuse: 0,
      uTorch: currentTorch,
      uFog: currentFog,
      uUvScroll: NO_UV_SCROLL,
      uAlphaCutoff: SPRITE_ALPHA_CUTOFF,
    });
    drawShape(sheet.cells[cell]!);
    state.apply({ cull: 'back' });
  }

  function drawPlayerModel(visual: PlayerModelProfile, profile: GenerationProfile, frame: Frame): void {
    const video = profile.video;
    const rig = rigs.get(visual.file)!;
    // 世代ごとのコマ落ちは再生時刻の量子化で表す（アセットは常に滑らか。asset-rules.md §6）
    const step = 1 / video.animationHz;
    const quantized = Math.floor(frame.player.animationSeconds / step) * step;
    // クリップ名はアセットごとに違うので、プロファイルの対応表を通してから探す
    const ref = visual.clips[frame.player.clip];
    const index = rig.clips.indexOf(ref.animation);
    const animation = rig.model.animations[index >= 0 ? index : 0];
    if (animation) sampleAnimation(animation, ref.freeze ? 0 : quantized, rig.pose);
    computeGlobalMatrices(rig.model, rig.pose, rig.globals);
    if (rig.model.skins.length > 0) computeJointMatrices(rig.model, 0, rig.globals, rig.jointMatrices);

    mat4.identity(model);
    // モデルの原点は足元。当たり判定の中心は腰なので、半身ぶん下げる
    mat4.translate(model, model, [
      frame.player.position[0],
      frame.player.position[1] - PLAYER_FEET_OFFSET,
      frame.player.position[2],
    ]);
    mat4.rotateY(model, model, frame.player.yaw);

    playerProgram.use();
    rig.parts.forEach((part, i) => {
      const base = rig.colors[i] ?? [1, 1, 1, 1];
      playerProgram.setUniforms({
        uJoints: rig.jointMatrices,
        uModel: model as Float32Array,
        uViewProjection: camera.viewProjection as Float32Array,
        uResolution: [video.internalWidth, video.internalHeight],
        uQuantizeStep: video.vertexQuantize,
        uAffineAmount: video.affineTexture ? 1 : 0,
        // 絵を持つモデルはそれを貼り、色だけのモデル（T1-08）には白 1 色を通す
        uBaseColor: rig.maps[i]!,
        uTopColor: rig.maps[i]!,
        uBaseColorFactor: [
          base[0] * frame.player.tint[0],
          base[1] * frame.player.tint[1],
          base[2] * frame.player.tint[2],
          base[3] * frame.player.tint[3],
        ],
        uLightDirection: STATIC_LIGHT,
        // プレイヤーは松明を持つ側なので、暗室でも自分の光で見える
        uAmbient: [DEFAULT_AMBIENT * ambientTint[0], DEFAULT_AMBIENT * ambientTint[1], DEFAULT_AMBIENT * ambientTint[2]],
        uDiffuse: DEFAULT_DIFFUSE,
        uTorch: currentTorch,
        uFog: currentFog,
        uUvScroll: NO_UV_SCROLL,
        uAlphaCutoff: 0,
      });
      drawShape(part);
    });
  }

  /**
   * スプライト面を描く（T2-10）。**絵で描く世代のプレイヤーだけがここに出る。**
   *
   * 面を分ける理由は色の制約にある。実機の BG は 16×16 の属性ブロックごとに
   * 色数が制限されるが、OBJ は自分のパレットを持ち、背景の色数に影響されない。
   * 1 枚に混ぜてから量子化すると、草の上に立ったキャラクタの靴が緑に潰れる。
   * 合成は量子化パスが行う（`quantize/palette_fc.ts`）。
   */
  function drawSprites(profile: GenerationProfile, frame: Frame): void {
    const visual = profile.player;
    if (visual.kind !== 'sprite') return;
    // 面ごとに独立して呼べるよう、カメラとフィルタはここでも作り直す（呼ぶ順に依存しない）
    beginPass(profile, frame);
    drawPlayerSprite(visual, profile.video, frame);
  }

  /**
   * 面を 1 つ描き始める前の共通の準備。
   * カメラ・テクスチャセット・世代ごとのフィルタをここで合わせる。
   */
  function beginPass(profile: GenerationProfile, frame: Frame): void {
    const video = profile.video;
    currentSet = profile.art.textureSet;
    camera.projection = frame.camera.projection;
    camera.orthoHeight = frame.camera.orthoHeight;
    for (let axis = 0; axis < 3; axis++) {
      camera.position[axis] = frame.camera.position[axis]!;
      camera.target[axis] = frame.camera.target[axis]!;
    }
    camera.update(video.internalWidth / video.internalHeight);
    // フィルタは世代が変わったときだけ流し直す。4 セットぶんの枚数を毎パス触ると無駄が大きい
    if (appliedFilter !== video.textureFilter) {
      for (const texture of textures.values()) texture.setFilter(video.textureFilter);
      appliedFilter = video.textureFilter;
    }
  }

  function draw(profile: GenerationProfile, frame: Frame): void {
    const video = profile.video;
    triangleCount = 0;
    // 松明は動的ライティングを持つ世代だけ灯る。位置は scene.ts がプレイヤーから決める（T2-04）
    currentTorch[0] = frame.torch.position[0];
    currentTorch[1] = frame.torch.position[1];
    currentTorch[2] = frame.torch.position[2];
    currentTorch[3] = video.dynamicLight ? frame.torch.radius : 0;
    // 霧の色は背景の下端そのもの（KV-06）。遠景がそのまま背景へ抜ける。
    // **背景と同じ係数を掛ける**（BR-03）。掛けないと、暗室で遠景だけが灰色に光る
    const horizon = profile.art.backdrop.sky[1];
    for (let c = 0; c < 3; c++) currentFog[c] = (horizon[c]! / 255) * frame.backdrop.brightness;
    currentFog[3] = profile.art.fogDensity;

    // 環境光の色（SG-09、判断 G）。**空の下端色を明度で割って正規化する。**
    //
    // 正規化するのが要点である。これで `material.ambient` が持つ「陰影の取り分」の
    // 意味が変わらず、暗室（`ambient: 0.05`）の明るさも変わらない。
    // 変わるのは影側の色相だけになる（太陽が高い昼は、影が空の色に沈む。基準画の J）。
    //
    // 空の見えない部屋（BR-03）では**色だけが無彩色へ戻る**。背景の係数を素直に掛けると
    // 環境光そのものが 0 になり、暗室が「松明の外は真っ黒」から「完全な暗闇」へ変わってしまう。
    // 明度 1 の 2 つのベクトルを混ぜているので、どちらの端でも取り分は材質の値のままである
    const skyLuma = luma(horizon);
    const tint = frame.backdrop.brightness;
    for (let c = 0; c < 3; c++) {
      ambientTint[c] = skyLuma === 0 ? 1 : 1 + ((horizon[c]! / skyLuma) - 1) * tint;
    }

    beginPass(profile, frame);
    state.apply({
      depthTest: video.depthBuffer,
      depthWrite: video.depthBuffer,
      blend: 'none',
      cull: 'back',
    });

    // 1. 背景（KV-02）。**他の何よりも先に敷く**
    drawBackdrop(profile.art, video, frame);

    program.use();

    // 2. 回る面（S-1）。背景のすぐ上
    drawPlane(video, frame);

    // 3. 不透明
    const opaque = collect(frame, false, !video.depthBuffer);
    for (let slot = 0; slot < opaque; slot++) drawItem(order[slot]!, video, frame);

    // 4. 落ち影（松明を持つ世代のみ）。床の上に、プレイヤーより先に敷く
    if (video.dynamicLight) drawShadows(video, frame);

    // 5. プレイヤー。**絵で描く世代のプレイヤーはここに出ない**（別の面。`drawSprites`）。
    //    ここで見ているのはプロファイルの値であって、世代 ID ではない（不変条件 I2）
    if (profile.player.kind === 'model') drawPlayerModel(profile.player, profile, frame);

    // 6. 半透明（T1-25）。不透明のあと、奥から手前へ。
    //    `alphaBlend` を持たない世代では scene.ts が可視から外しているので、ここには来ない
    const translucent = collect(frame, true, true);
    if (translucent > 0) {
      state.apply({ blend: 'add', depthWrite: false });
      program.use();
      // 足し算のパスに霧を掛けない。混ぜるのではなく足すので、遠いものほど明るくなってしまう
      const density = currentFog[3];
      currentFog[3] = 0;
      for (let slot = 0; slot < translucent; slot++) drawItem(order[slot]!, video, frame);
      currentFog[3] = density;
      state.apply({ blend: 'none', depthWrite: video.depthBuffer });
    }
  }

  return {
    draw,
    drawSprites,
    get triangleCount() {
      return triangleCount;
    },
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}
