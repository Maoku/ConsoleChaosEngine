import { readFileSync } from 'node:fs';
import { parseStage } from '@/content/stage-schema';

export function demoStage(index: number) {
  return parseStage(JSON.parse(readFileSync(new URL('../../public/assets/levels/demo_stage' + index + '.json', import.meta.url), 'utf8')));
}

