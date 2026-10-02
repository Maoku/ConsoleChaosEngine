import type { GameModule, GameInstance, GenerationId } from '@console-chaos/engine';
import { createConsoleChaosStageModule, type ConsoleChaosModuleHooks } from '@/app';
import { createReleaseGuard } from '@/config/release-guard';
import { CAMPAIGN_ID, CONTENT_REVISION } from '@/content/stages';
import type { StageFile } from '@/content/stage-schema';
import type { CampaignSave } from './save';
import type { Session } from './session';

export type CampaignMode = 'title' | 'playing' | 'stageComplete' | 'finished' | 'loading' | 'error';
export interface CampaignController {
  readonly mode: CampaignMode;
  readonly stageIndex: number;
  readonly session: Session | null;
  readonly canResume: boolean;
  startNew(): void;
  resume(): void;
  next(): void;
  returnTitle(): void;
  retry(): void;
}
export interface CampaignOptions {
  stages: readonly StageFile[];
  saved: CampaignSave | null;
  save(save: CampaignSave): void;
  hooks?: ConsoleChaosModuleHooks;
  onReady(controller: CampaignController): void;
  onNewRun?(): void;
  onState?(controller: CampaignController): void;
}

/** One host and one active instance; ownership never overlaps across stage boundaries. */
export function createCampaignModule(options: CampaignOptions): GameModule {
  return {
    id: CAMPAIGN_ID,
    async create(context) {
      let mode: CampaignMode = 'loading';
      let index = 0;
      let active: GameInstance | null = null;
      let session: Session | null = null;
      let saved = options.saved;
      let seed = saved?.seed ?? 0x436861;
      let stableGeneration: GenerationId = saved?.generation ?? 'FC';
      let disposed = false;
      let fingerprint = '';
      const guard = createReleaseGuard();
      const emit = (): void => options.onState?.(controller);
      const write = (value: CampaignSave): void => { saved = value; options.save(value); };
      const snapshot = (): CampaignSave => ({ version: 1, campaign: CAMPAIGN_ID, revision: CONTENT_REVISION,
        seed, stageId: options.stages[index]!.id, completed: options.stages.slice(0, index).map((stage) => stage.id),
        generation: stableGeneration, finished: false, state: session!.snapshot() });
      const saveChanges = (): void => {
        if (context.generation.transition.active || !session || session.checkpoints.phase !== 'playing') return;
        stableGeneration = context.generation.generation;
        const next = snapshot();
        // Channel changes alone are not a storage write trigger.
        const key = JSON.stringify(next.state);
        if (key !== fingerprint) { fingerprint = key; write(next); }
      };
      async function change(nextIndex: number, restore: CampaignSave | null, nextMode: CampaignMode): Promise<void> {
        if (disposed || mode === 'loading' && active) return;
        mode = 'loading'; guard.lock(); emit();
        active?.dispose(); active = null; session = null;
        for (let t = 0; t < 5 && context.generation.transition.active; t++) context.generation.advance(1000);
        context.generation.request(restore?.generation ?? 'FC');
        for (let t = 0; t < 5 && context.generation.transition.active; t++) context.generation.advance(1000);
        stableGeneration = context.generation.generation;
        index = nextIndex;
        try {
          const created = await createConsoleChaosStageModule(options.stages[index]!, {
            ...options.hooks, seed, ...(restore ? { restore: restore.state } : {}),
            shouldSimulate: () => mode === 'playing' && guard.accept(context.input.snapshot),
            onCreate(current, audio, presentation) {
              session = current;
              options.hooks?.onCreate?.(current, audio, presentation);
            },
            onFixedUpdate(current) {
              options.hooks?.onFixedUpdate?.(current);
              saveChanges();
              if (!current.cleared || mode !== 'playing') return;
              const final = index === options.stages.length - 1;
              const value = snapshot();
              value.completed.push(options.stages[index]!.id);
              if (final) value.finished = true;
              else {
                value.stageId = options.stages[index + 1]!.id;
                value.generation = 'FC';
                value.state = { checkpointId: null, achievements: [], gardens: {} };
              }
              write(value);
              mode = final ? 'finished' : 'stageComplete'; guard.lock(); emit();
            },
          }).create(context);
          if (disposed) { created.dispose(); return; }
          active = created;
          fingerprint = session ? JSON.stringify((session as Session).snapshot()) : '';
          mode = nextMode; emit();
        } catch (error) {
          (session as Session | null)?.dispose(); session = null;
          mode = 'error'; emit();
          console.error('Campaign stage initialization failed', error);
        }
      }
      const controller: CampaignController = {
        get mode() { return mode; }, get stageIndex() { return index; }, get session() { return session; },
        get canResume() { return saved !== null && !saved.finished; },
        startNew() {
          if (mode !== 'title' && mode !== 'finished') return;
          options.onNewRun?.();
          seed = (seed + 1) >>> 0;
          saved = null;
          void change(0, null, 'playing').then(() => { if (mode === 'playing') write(snapshot()); });
        },
        resume() {
          if (mode !== 'title' || !saved || saved.finished) return;
          seed = saved.seed;
          const target = options.stages.findIndex((stage) => stage.id === saved!.stageId);
          void change(target, saved, 'playing');
        },
        next() {
          if (mode !== 'stageComplete' || !saved) return;
          void change(index + 1, saved, 'playing');
        },
        returnTitle() {
          if (mode === 'loading' || disposed) return;
          if (mode === 'playing') saveChanges();
          mode = 'title'; guard.lock(); emit();
        },
        retry() { if (mode === 'playing') { session?.retryCheckpoint(); guard.lock(); } },
      };
      await change(0, null, 'title');
      options.onReady(controller);
      return {
        prepareFixedUpdate(frame) { active?.prepareFixedUpdate?.(frame); },
        fixedUpdate(frame) { active?.fixedUpdate(frame); },
        buildRenderFrame(frame, alpha) { active?.buildRenderFrame(frame, alpha); },
        dispose() { if (disposed) return; disposed = true; active?.dispose(); active = null; session = null; },
      };
    },
  };
}
