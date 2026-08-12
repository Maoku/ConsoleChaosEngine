export const GEN3_ORDERING_TABLE_LENGTH = 12;

export type OrderingTableIndex =
  | 0 | 1 | 2 | 3 | 4 | 5
  | 6 | 7 | 8 | 9 | 10 | 11;

export interface OrderingCommand {
  orderTableIndex?: OrderingTableIndex;
  polygonSortRange?: readonly [OrderingTableIndex, OrderingTableIndex];
}

export type OrderingPacketKind = 'world' | 'screen-space' | 'debug';

export interface OrderingTableWorkspace<Packet> {
  readonly lists: readonly Packet[][];
  reset(): void;
}

export function createOrderingTableWorkspace<Packet>(): OrderingTableWorkspace<Packet> {
  const lists: Packet[][] = Array.from(
    { length: GEN3_ORDERING_TABLE_LENGTH },
    () => [],
  );
  return {
    lists,
    reset(): void {
      for (const list of lists) list.length = 0;
    },
  };
}

export function isOrderingTableIndex(value: number): value is OrderingTableIndex {
  return Number.isInteger(value) && value >= 0 && value < GEN3_ORDERING_TABLE_LENGTH;
}

export function assertOrderingTableIndex(value: number): asserts value is OrderingTableIndex {
  if (!isOrderingTableIndex(value)) {
    throw new RangeError(`Ordering table index must be an integer from 0 to 11; received ${value}`);
  }
}

export function assertPolygonSortRange(
  range: readonly [number, number],
): asserts range is readonly [OrderingTableIndex, OrderingTableIndex] {
  assertOrderingTableIndex(range[0]);
  assertOrderingTableIndex(range[1]);
  if (range[0] > range[1]) {
    throw new RangeError(`Ordering table range must be ascending; received ${range[0]}..${range[1]}`);
  }
}

/** Maps positive view-space depth to a far-to-near ordering-table range. */
export function orderingTableIndexForDepth(
  viewDepth: number,
  nearDepth: number,
  farDepth: number,
  range: readonly [OrderingTableIndex, OrderingTableIndex] = [1, 8],
): OrderingTableIndex {
  assertPolygonSortRange(range);
  const start = range[0];
  const end = range[1];
  if (start === end || farDepth <= nearDepth) return end;
  const normalized = Math.min(1, Math.max(0, (viewDepth - nearDepth) / (farDepth - nearDepth)));
  return (end - Math.round(normalized * (end - start))) as OrderingTableIndex;
}

export function defaultOrderingTableIndex(options: {
  explicit?: OrderingTableIndex;
  kind: OrderingPacketKind;
  translucent: boolean;
  viewDepth: number;
  nearDepth: number;
  farDepth: number;
}): OrderingTableIndex {
  if (options.explicit !== undefined) {
    assertOrderingTableIndex(options.explicit);
    return options.explicit;
  }
  if (options.kind === 'debug') return 11;
  if (options.kind === 'screen-space') return 10;
  if (options.translucent) return 9;
  return orderingTableIndexForDepth(options.viewDepth, options.nearDepth, options.farDepth);
}

export function visitOrderingTable<Packet>(
  workspace: OrderingTableWorkspace<Packet>,
  visitor: (packet: Packet, index: OrderingTableIndex) => void,
): void {
  if (workspace.lists.length !== GEN3_ORDERING_TABLE_LENGTH) {
    throw new Error(`Ordering table must contain exactly ${GEN3_ORDERING_TABLE_LENGTH} lists`);
  }
  for (let index = 0; index < GEN3_ORDERING_TABLE_LENGTH; index++) {
    for (const packet of workspace.lists[index] ?? []) {
      visitor(packet, index as OrderingTableIndex);
    }
  }
}
