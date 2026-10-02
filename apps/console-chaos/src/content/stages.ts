import { loadStage, type StageFile } from './stage-schema';
export const CAMPAIGN_ID = 'four-stage-demo';
export const CONTENT_REVISION = 'four-stage-demo-1';
export const STAGE_IDS = ['demo_stage1', 'demo_stage2', 'demo_stage3', 'demo_stage4'] as const;
export function loadCampaign(base: string): Promise<StageFile[]> {
  return Promise.all(STAGE_IDS.map((id) => loadStage(base + 'assets/levels/' + id + '.json')));
}
