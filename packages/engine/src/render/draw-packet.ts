import type { MaterialCommand, MeshCommand, SkinnedMeshCommand, SpriteCommand } from './frame';
import type { OrderingTableIndex } from './ordering-table';

export type DrawPacketKind = 'mesh' | 'skinned-mesh' | 'sprite';
export type DrawPacketCommand = MeshCommand | SkinnedMeshCommand | SpriteCommand;

export interface DrawPacket {
  kind: DrawPacketKind;
  command: DrawPacketCommand | null;
  material: MaterialCommand | undefined;
  viewDepth: number;
  sequence: number;
  translucent: boolean;
  polygonSlot: OrderingTableIndex | undefined;
  debug: boolean;
}

export interface DrawPacketWorkspace {
  readonly capacity: number;
  readonly packets: readonly DrawPacket[];
  readonly count: number;
  reset(): void;
  take(kind: DrawPacketKind, command: DrawPacketCommand): DrawPacket;
}

export function createDrawPacketWorkspace(capacity: number): DrawPacketWorkspace {
  const packets: DrawPacket[] = Array.from({ length: capacity }, () => ({
    kind: 'mesh',
    command: null,
    material: undefined,
    viewDepth: 0,
    sequence: 0,
    translucent: false,
    polygonSlot: undefined,
    debug: false,
  }));
  let count = 0;
  return {
    capacity,
    packets,
    get count() {
      return count;
    },
    reset(): void {
      for (let index = 0; index < count; index++) packets[index]!.command = null;
      count = 0;
    },
    take(kind, command): DrawPacket {
      const packet = packets[count++];
      if (!packet) throw new RangeError(`Draw packet capacity ${capacity} exceeded`);
      packet.kind = kind;
      packet.command = command;
      packet.material = undefined;
      packet.viewDepth = 0;
      packet.sequence = count - 1;
      packet.translucent = false;
      packet.polygonSlot = undefined;
      packet.debug = false;
      return packet;
    },
  };
}

/** Stable in-place ordering: opaque then translucent, each far-to-near. */
export function stableSortDrawPackets(packets: DrawPacket[]): void {
  for (let index = 1; index < packets.length; index++) {
    const packet = packets[index]!;
    let insertion = index;
    while (insertion > 0) {
      const previous = packets[insertion - 1]!;
      const packetGroup = packet.translucent ? 1 : 0;
      const previousGroup = previous.translucent ? 1 : 0;
      const shouldMove = packetGroup < previousGroup
        || (packetGroup === previousGroup && packet.viewDepth > previous.viewDepth);
      if (!shouldMove) break;
      packets[insertion] = previous;
      insertion--;
    }
    packets[insertion] = packet;
  }
}
