export interface EngineStats {
  frames: number;
  fixedUpdates: number;
  drawCommands: number;
  droppedTicks: number;
}

export function createEngineStats(): EngineStats {
  return { frames: 0, fixedUpdates: 0, drawCommands: 0, droppedTicks: 0 };
}

