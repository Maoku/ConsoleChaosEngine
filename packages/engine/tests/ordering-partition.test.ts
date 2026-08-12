import { describe, expect, it } from 'vitest';
import { mat4 } from 'gl-matrix';
import {
  createDrawPacketWorkspace,
  stableSortDrawPackets,
} from '../src/render/draw-packet';
import {
  createOrderingPartitionWorkspace,
  partitionTrianglesByViewDepth,
} from '../src/render/sort';
import type { MeshCommand } from '../src/render/frame';

function mesh(id: string): MeshCommand {
  return {
    id,
    geometry: { kind: 'box' },
    transform: { position: [0, 0, 0] },
    color: '#ffffff',
  };
}

describe('OT12 stable triangle partition', () => {
  it('partitions by view-space depth without losing, duplicating, or destabilizing triangles', () => {
    const depths = [90, 10, 50, 50];
    const positions = new Float32Array(depths.flatMap((depth, triangle) => [
      triangle, 0, -depth,
      triangle, 1, -depth,
      triangle + 0.5, 0, -depth,
    ]));
    const indices = new Uint16Array(Array.from({ length: 12 }, (_, index) => index));
    const output = new Uint16Array(indices.length);
    const workspace = createOrderingPartitionWorkspace(4);
    const ranges = partitionTrianglesByViewDepth(
      positions,
      indices,
      mat4.create(),
      0,
      100,
      [1, 8],
      output,
      workspace,
    );

    expect(ranges).toBe(workspace.ranges);
    expect(Array.from(output)).toEqual([
      0, 1, 2,
      6, 7, 8,
      9, 10, 11,
      3, 4, 5,
    ]);
    expect(new Set(output).size).toBe(indices.length);
    expect(ranges.reduce((total, entry) => total + entry.count, 0)).toBe(indices.length);
    expect(workspace.depths).toEqual(new Float32Array(depths));
  });

  it('reuses all work buffers and rejects invalid ranges/capacity', () => {
    const workspace = createOrderingPartitionWorkspace(1);
    const counts = workspace.counts;
    const positions = new Float32Array([0, 0, -1, 1, 0, -1, 0, 1, -1]);
    const indices = new Uint32Array([0, 1, 2]);
    const output = new Uint32Array(3);
    for (let run = 0; run < 3; run++) {
      partitionTrianglesByViewDepth(positions, indices, mat4.create(), 0, 10, [1, 8], output, workspace);
    }
    expect(workspace.counts).toBe(counts);
    expect(() => partitionTrianglesByViewDepth(positions, indices, mat4.create(), 0, 10, [8, 1], output, workspace)).toThrow(RangeError);
    expect(() => partitionTrianglesByViewDepth(positions, new Uint32Array([0, 1, 2, 0, 1, 2]), mat4.create(), 0, 10, [1, 8], new Uint32Array(6), workspace)).toThrow(/capacity/);
  });
});

describe('draw packet workspace', () => {
  it('reuses packet objects and keeps opaque/translucent far-to-near ordering stable', () => {
    const workspace = createDrawPacketWorkspace(5);
    const input = [
      { depth: 2, translucent: true },
      { depth: 5, translucent: false },
      { depth: 5, translucent: false },
      { depth: 8, translucent: true },
      { depth: 2, translucent: true },
    ];
    const packets = input.map((entry, index) => {
      const packet = workspace.take('mesh', mesh(String(index)));
      packet.viewDepth = entry.depth;
      packet.translucent = entry.translucent;
      return packet;
    });
    const firstPacket = workspace.packets[0];
    stableSortDrawPackets(packets);
    expect(packets.map((packet) => packet.sequence)).toEqual([1, 2, 3, 0, 4]);
    workspace.reset();
    expect(workspace.take('mesh', mesh('again'))).toBe(firstPacket);
  });
});
