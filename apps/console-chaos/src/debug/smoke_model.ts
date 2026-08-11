/**
 * T0-06 の受け入れ確認：glTF サブセットローダで読んだスキンメッシュを表示し、
 * ボーンアニメを再生する。ゲーム本体の描画経路とは無関係の足場。
 */
import { mat4 } from 'gl-matrix';
import {
  createBuffer,
  createProgram,
  createStateCache,
  createVertexArray,
  type GLContext,
  type StateCache,
  type VertexArray,
} from '@/render/gl/index';
import {
  computeGlobalMatrices,
  computeJointMatrices,
  createPose,
  loadGltf,
  sampleAnimation,
  type GltfModel,
  type Pose,
} from '@/render/loader/gltf';
import vertexSource from '@/render/shaders/skinned_test.vert.glsl?raw';
import fragmentSource from '@/render/shaders/skinned_test.frag.glsl?raw';

export interface SmokeModel {
  /** @param timeSeconds アニメーションの時刻。世代ごとの量子化は呼び出し側の責務 */
  draw(timeSeconds: number, aspect: number): void;
  readonly triangleCount: number;
  dispose(): void;
}

export async function createSmokeModel(ctx: GLContext, url: string): Promise<SmokeModel> {
  const { gl } = ctx;
  const model: GltfModel = await loadGltf(url);
  const primitive = model.meshes[0]?.primitives[0];
  if (!primitive) throw new Error(`${url} にプリミティブが無い`);

  const positions = createBuffer(ctx, 'vertex', primitive.positions);
  const normals = createBuffer(ctx, 'vertex', primitive.normals ?? new Float32Array(primitive.positions.length));
  const uvs = createBuffer(ctx, 'vertex', primitive.uvs ?? new Float32Array((primitive.positions.length / 3) * 2));
  const jointIndices = new Float32Array(primitive.joints ?? new Uint16Array((primitive.positions.length / 3) * 4));
  const joints = createBuffer(ctx, 'vertex', jointIndices);
  const weights = createBuffer(
    ctx,
    'vertex',
    primitive.weights ?? new Float32Array((primitive.positions.length / 3) * 4),
  );
  const indices = createBuffer(ctx, 'index', primitive.indices);

  const vao: VertexArray = createVertexArray(
    ctx,
    [
      { location: 0, size: 3, buffer: positions },
      { location: 1, size: 3, buffer: normals },
      { location: 2, size: 2, buffer: uvs },
      { location: 3, size: 4, buffer: joints },
      { location: 4, size: 4, buffer: weights },
    ],
    { buffer: indices, type: primitive.indices instanceof Uint32Array ? 'uint' : 'ushort' },
  );

  const program = createProgram(ctx, 'skinned_test', vertexSource, fragmentSource);
  const state: StateCache = createStateCache(ctx);

  // 毎フレームのアロケーションを避けるため、作業用配列は先に確保する（§5.4.3 の原則）
  const pose: Pose = createPose(model);
  const globals = new Float32Array(model.nodes.length * 16);
  const jointMatrices = new Float32Array(Math.max(model.skins[0]?.joints.length ?? 1, 1) * 16);
  const view = mat4.create();
  const projection = mat4.create();
  const viewProjection = mat4.create();
  const baseColor = model.materials[primitive.material ?? 0]?.baseColorFactor ?? [1, 1, 1, 1];
  const animation = model.animations[0];

  return {
    triangleCount: primitive.indices.length / 3,
    draw(timeSeconds, aspect): void {
      if (animation) sampleAnimation(animation, timeSeconds, pose);
      computeGlobalMatrices(model, pose, globals);
      if (model.skins.length > 0) computeJointMatrices(model, 0, globals, jointMatrices);

      mat4.perspective(projection, (50 * Math.PI) / 180, aspect, 0.1, 100);
      mat4.lookAt(view, [0, 1.2, 5], [0, 1, 0], [0, 1, 0]);
      mat4.multiply(viewProjection, projection, view);

      state.apply({ depthTest: true, depthWrite: true, blend: 'none', cull: 'none' });
      state.clear(0.05, 0.05, 0.08, 1, true);
      program.use();
      program.setUniforms({
        uJoints: jointMatrices,
        uViewProjection: viewProjection as Float32Array,
        uBaseColor: baseColor,
      });
      vao.bind();
      gl.drawElements(gl.TRIANGLES, primitive.indices.length, vao.indexType, 0);
    },
    dispose(): void {
      vao.dispose();
      for (const b of [positions, normals, uvs, joints, weights, indices]) b.dispose();
      program.dispose();
    },
  };
}
