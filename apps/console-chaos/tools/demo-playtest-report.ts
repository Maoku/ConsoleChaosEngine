import { readFileSync } from 'node:fs';
import { STAGE_IDS } from '../src/content/stages';
import type { createDemoPlaytest } from '../src/debug/demo-playtest';
type Record = ReturnType<ReturnType<typeof createDemoPlaytest>['record']>;
const records: Record[] = [];
for (const file of process.argv.slice(2)) {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1 ||
      !('stages' in data) || !Array.isArray(data.stages)) throw new Error('4ステージ試遊記録ではない: ' + file);
  records.push(data as Record);
}
if (!records.length) throw new Error('試遊JSONのパスを指定してください');
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2;
};
const freshComplete = records.filter((record) => record.stages.length === 4 && record.stages.every((stage, index) =>
  stage.stageId === STAGE_IDS[index] && stage.cleared && stage.resumedAchievements.length === 0));
const totalTimes = freshComplete.map((record) => record.elapsedSeconds);
const devices = [...new Set(records.map((record) => record.device))];
process.stdout.write(JSON.stringify({
  samples: records.length, completeFreshRuns: freshComplete.length,
  medianSeconds: median(totalTimes), within15To30Minutes: totalTimes.filter((time) => time >= 900 && time <= 1800).length,
  stages: STAGE_IDS.map((id) => {
    const samples = records.flatMap((record) => record.stages.filter((stage) => stage.stageId === id));
    return { id, samples: samples.length, clears: samples.filter((stage) => stage.cleared).length,
      medianSeconds: median(samples.filter((stage) => stage.cleared && !stage.resumedAchievements.length).map((stage) => stage.elapsedSeconds)),
      falls: samples.reduce((sum, stage) => sum + stage.falls, 0),
      hintUses: samples.reduce((sum, stage) => sum + stage.instances.filter((p) => p.hintStage > 0).length, 0),
      directHintUses: samples.reduce((sum, stage) => sum + stage.instances.filter((p) => p.hintStage === 4).length, 0) };
  }),
  devices: devices.map((device) => ({ device, samples: records.filter((r) => r.device === device).length,
    medianCompleteSeconds: median(freshComplete.filter((r) => r.device === device).map((r) => r.elapsedSeconds)) })),
}, null, 2) + '\n');
