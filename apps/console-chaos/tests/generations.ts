import { GENERATION_IDS, type GenerationId } from '@console-chaos/engine';
import { generationView, type ConsoleChaosGenerationView } from '@/config/generation';

export { GENERATION_IDS };
export type { GenerationId };

export const GENERATION_VIEWS: Readonly<Record<GenerationId, ConsoleChaosGenerationView>> =
  Object.fromEntries(GENERATION_IDS.map((id) => [id, generationView(id)])) as Record<
    GenerationId,
    ConsoleChaosGenerationView
  >;
