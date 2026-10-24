import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION_WEBGL_RENDERER_LIMITS,
  geometryCommandKey,
} from '../src/render/webgl-renderer';
import { boxMesh, quadMesh, segmentsFor } from '../src/render/geometry';
import { createForwardFragmentShader } from '../src/render/shaders/ps1_forward';
import { createSkinnedVertexShader } from '../src/render/shaders/skinned_test.vert';

describe('configurable 3D render capabilities', () => {
  it('keeps box tessellation options distinct in the geometry cache', () => {
    expect(geometryCommandKey({ kind: 'box', density: 1, maxSegments: 8 }))
      .not.toBe(geometryCommandKey({ kind: 'box', density: 2, maxSegments: 32 }));
    expect(segmentsFor([10, 1, 1], 2, 32)).toEqual([32, 4, 4]);
    expect(() => segmentsFor([1, 1, 1], 1, 0)).toThrow(RangeError);
  });

  it('uses independent U and V repeat values for quads', () => {
    const mesh = quadMesh([2, 5]);
    const uv = (vertex: number): readonly [number, number] => [mesh.vertices[vertex * 8 + 6]!, mesh.vertices[vertex * 8 + 7]!];
    expect(uv(1)).toEqual([2, 0]);
    expect(uv(2)).toEqual([2, 5]);
    expect(uv(3)).toEqual([0, 5]);
  });

  it('keeps dense boxes addressable beyond the 16-bit vertex limit', () => {
    const mesh = boxMesh([52, 52, 52], { uvScale: 0, maxSegments: 104 });
    const vertexCount = mesh.vertices.length / 8;

    expect(vertexCount).toBeGreaterThan(65_536);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    let maxIndex = 0;
    for (const index of mesh.indices) maxIndex = Math.max(maxIndex, index);
    expect(maxIndex).toBe(vertexCount - 1);
    expect(boxMesh([1, 1, 1], { uvScale: 0 }).indices).toBeInstanceOf(Uint16Array);
  });

  it('injects configured light and joint capacities into shader sources', () => {
    expect(DEFAULT_GENERATION_WEBGL_RENDERER_LIMITS).toEqual({
      directionalLights: 4,
      pointLights: 4,
      jointsPerSkin: 24,
    });
    expect(createForwardFragmentShader(3, 7)).toContain('const int MAX_DIRECTIONAL_LIGHTS = 3;');
    expect(createForwardFragmentShader(3, 7)).toContain('const int MAX_POINT_LIGHTS = 7;');
    expect(createSkinnedVertexShader(48)).toContain('const int MAX_JOINTS = 48;');
  });
});
