export interface GardenSafety { ticks: number; carriedTicks: number }
export interface StageSnapshot {
  checkpointId: string | null;
  achievements: string[];
  gardens: Record<string, GardenSafety>;
}
