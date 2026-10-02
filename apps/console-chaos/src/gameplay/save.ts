import { GENERATION_IDS, type GenerationId } from '@console-chaos/engine';
import { CAMPAIGN_ID, CONTENT_REVISION } from '@/content/stages';
import type { StageFile } from '@/content/stage-schema';
import type { StageSnapshot } from './stage-snapshot';

export const SAVE_KEY = 'chaos.campaign.four-stage.v1';
export interface CampaignSave {
  version: 1;
  campaign: typeof CAMPAIGN_ID;
  revision: typeof CONTENT_REVISION;
  seed: number;
  stageId: string;
  completed: string[];
  generation: GenerationId;
  finished: boolean;
  state: StageSnapshot;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') && new Set(value).size === value.length;
}
export function decodeSave(raw: string, stages: readonly StageFile[]): CampaignSave | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.version !== 1 || data.campaign !== CAMPAIGN_ID || data.revision !== CONTENT_REVISION ||
        !Number.isSafeInteger(data.seed) || Number(data.seed) < 0 || Number(data.seed) > 0xffffffff ||
        !GENERATION_IDS.includes(data.generation as GenerationId) || typeof data.finished !== 'boolean' ||
        !uniqueStrings(data.completed)) return null;
    const index = stages.findIndex((stage) => stage.id === data.stageId);
    if (index < 0 || (data.finished && index !== stages.length - 1)) return null;
    const expected = stages.slice(0, data.finished ? stages.length : index).map((stage) => stage.id);
    if (expected.join() !== data.completed.join()) return null;
    const stage = stages[index]!;
    const state = data.state;
    if (!record(state) || (state.checkpointId !== null && typeof state.checkpointId !== 'string') ||
        !uniqueStrings(state.achievements) || state.achievements.some((id) => !stage.instances.some((p) => p.achievement === id)) || !record(state.gardens)) return null;
    if (data.finished && !stage.exit.requires.every((id) => (state.achievements as string[]).includes(id))) return null;
    for (const [id, phase] of Object.entries(state.gardens)) {
      if (!stage.instances.some((p) => p.id === id && p.kind === 'S-1') || !record(phase) ||
          !Number.isSafeInteger(phase.ticks) || Number(phase.ticks) < 0 || Number(phase.ticks) > 1e9 ||
          !Number.isSafeInteger(phase.carriedTicks) || Number(phase.carriedTicks) < 0 || Number(phase.carriedTicks) > Number(phase.ticks)) return null;
    }
    return data as unknown as CampaignSave;
  } catch { return null; }
}
export interface SaveStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function createCampaignStorage(stages: readonly StageFile[], storage: SaveStorage | null, onFailure: () => void) {
  return {
    read(): CampaignSave | null {
      try { const raw = storage?.getItem(SAVE_KEY); return raw ? decodeSave(raw, stages) : null; }
      catch { onFailure(); return null; }
    },
    write(save: CampaignSave): boolean {
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(SAVE_KEY, JSON.stringify(save)); return true;
      } catch { onFailure(); return false; }
    },
  };
}
