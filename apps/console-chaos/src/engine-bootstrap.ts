import {
  createBrowserLoopHost,
  createAssetManager,
  createGameHost,
  createGenerationAudioService,
  createGenerationWebGlRenderer,
  createKeyboardGamepadSource,
  createNullAudioService,
  installAudioUnlock,
  observeCanvasResize,
  type AudioService,
  type CrtQuality,
  type GameModule,
} from '@console-chaos/engine';
import { createConsoleChaosModule } from './app';
import type { ConsoleAudioPresenter } from './audio/presenter';
import { songOf } from './audio/songs';
import { bgmStatusText, createBgmControl } from './debug/bgm_control';
import { createColliderHud } from './debug/collider_hud';
import { createNoticeHud } from './debug/notice_hud';
import { createPlaytestFlow, type PlaytestFlow } from './debug/playtest_flow';
import {
  createConsoleDebugModule,
  initialGenerationForScene,
  isConsoleDebugScene,
} from './debug/scenes';
import { createPlaytestLog, saveStoredRecords, storedRecords, type PlaytestLog } from './debug/playtest_log';
import { createPlaytestHud } from './debug/playtest_hud';
import { loadLevel } from './level/loader';
import { createConsoleChaosRenderManifest } from './presentation/catalog';
import type { ConsoleChaosPresentation } from './presentation/frame';
import { KEY_COLORS } from './render/key_palette';
import type { Session } from './gameplay/session';
import { startNewRun } from './gameplay/run';
import { createHud, hudModelFromSession, type Hud } from './ui/hud';
import { createDisplaySettings, DISPLAY_LABELS, type DisplayOptions } from './ui/settings';

function requireScreenCanvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>('#screen');
  if (!element) throw new Error('Missing #screen canvas');
  return element;
}

const canvas = requireScreenCanvas();
canvas.width = 960;
canvas.height = 720;

function fitCanvasToStage(): void {
  const stage = canvas.parentElement;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height, 1);
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

const params = new URLSearchParams(location.search);
const levelId = params.get('level') ?? 'area1';
const requestedScene = params.get('scene') ?? 'mini';
const debugScene = isConsoleDebugScene(requestedScene) ? requestedScene : null;
const isMini = debugScene === null;
const level = await loadLevel(`${import.meta.env.BASE_URL}assets/levels/${levelId}.json`);
const display = createDisplaySettings();
const crtQualities: readonly CrtQuality[] = ['full', 'light', 'off'];
let crtQualityIndex = 0;
const cycleCrtQuality = (): void => {
  crtQualityIndex = (crtQualityIndex + 1) % crtQualities.length;
};
const assets = createAssetManager();
const unit = (color: readonly [number, number, number]): [number, number, number] =>
  [color[0] / 255, color[1] / 255, color[2] / 255];
const renderer = await createGenerationWebGlRenderer(canvas, {
  assets,
  manifest: createConsoleChaosRenderManifest(level),
  quality: () => crtQualities[crtQualityIndex]!,
  crtOverride: () => display.crtOverride(),
  transitionColors: {
    core: unit(KEY_COLORS.white),
    lead: unit(KEY_COLORS.titlePink),
    trail: unit(KEY_COLORS.sky),
  },
});
const input = createKeyboardGamepadSource();
const initialSong = songOf(params.get('bgm'));
let audio: AudioService = createNullAudioService(initialSong.score.bpm);
if (isMini) {
  try {
    audio = createGenerationAudioService(new AudioContext({ latencyHint: 'interactive' }), initialSong.score);
  } catch {
    // Automated browsers and restricted WebViews can run the complete game without Web Audio.
  }
}

const resize = observeCanvasResize(canvas, () => renderer.resize());
const unlock = installAudioUnlock(document, () => audio.unlock());
const playtestHud = isMini ? createPlaytestHud() : null;
const colliderHud = isMini ? createColliderHud() : null;
fitCanvasToStage();
const notice = createNoticeHud();
let session: Session | null = null;
let audioPresenter: ConsoleAudioPresenter | null = null;
let presentation: ConsoleChaosPresentation | null = null;
let hud: Hud | null = null;
let playtest: PlaytestLog | null = null;
let flow: PlaytestFlow | null = null;
const bgm = isMini
  ? createBgmControl({
      audio: () => audioPresenter,
      songId: initialSong.id,
      onChange: (status) => notice.show(bgmStatusText(status)),
    })
  : null;

const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input,
  audio,
  assets,
  initialGeneration: initialGenerationForScene(debugScene ?? 'mini'),
  seed: 0x436861,
});

const module: GameModule = debugScene
  ? createConsoleDebugModule(debugScene, { cycleQuality: cycleCrtQuality })
  : createConsoleChaosModule(level, {
      initialSong: initialSong.score,
      onCreate(created, presenter, createdPresentation) {
        session = created;
        audioPresenter = presenter;
        presentation = createdPresentation;
        bgm?.sync();
        hud = createHud(canvas);
        playtest = createPlaytestLog(created, levelId);
        if (params.get('playtest') !== '0') {
          flow = createPlaytestFlow({
            log: playtest,
            tester: params.get('tester') ?? undefined,
            isCleared: () => created.cleared,
            onStart: () => {
              startNewRun(created);
              playtest?.reset();
            },
            onRestart: () => {
              startNewRun(created);
              playtest?.reset();
            },
          });
        }
      },
      shouldSimulate: () => flow === null || (flow.started && !flow.finished),
      onFixedUpdate(current) {
        flow?.update();
        hud?.update(hudModelFromSession(current));
        playtest?.update();
      },
      onRender(current, currentPresentation) {
        colliderHud?.update(current, currentPresentation.colliderBoxes);
      },
      onDispose(current) {
        if (session === current) session = null;
        audioPresenter = null;
        presentation = null;
        playtest?.keep();
        playtest?.dispose();
        flow?.dispose();
        flow = null;
        hud?.dispose();
        hud = null;
        playtest = null;
      },
    });
await host.start(module);

const displayKeys: Record<string, keyof DisplayOptions> = { n: 'moire', f: 'flatten' };
const windowResize = (): void => {
  fitCanvasToStage();
  hud?.layout();
};
window.addEventListener('resize', windowResize);
const keydown = (event: KeyboardEvent): void => {
  const key = event.key.toLowerCase();
  if (key === 'h') session?.requestHint();
  if (key === 'c') presentation?.toggleColliders();
  if (key === 'b') bgm?.nextSong();
  if (key === 'm') bgm?.toggleMute();
  if (key === 'p') playtest?.save();
  if (event.key === 'Escape') flow?.finish();
  if (key === 'r') {
    playtest?.keep();
    session?.reset();
    playtest?.reset();
  }
  const setting = displayKeys[key];
  if (setting) {
    const enabled = display.toggle(setting);
    notice.show(`${DISPLAY_LABELS[setting]}：${enabled ? '入' : '切'}`);
  }
};
window.addEventListener('keydown', keydown);

const pagehide = (): void => {
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('resize', windowResize);
  resize.dispose();
  unlock.dispose();
  notice.dispose();
  playtestHud?.dispose();
  colliderHud?.dispose();
  host.dispose();
};
window.addEventListener('pagehide', pagehide, { once: true });

document.documentElement.dataset.consoleChaosScene = requestedScene;
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)['__consoleChaos'] = {
    host,
    renderer,
    get session() {
      return session;
    },
    get flow() {
      return flow;
    },
  };
}

(globalThis as Record<string, unknown>)['__playtest'] = {
  records: storedRecords,
  saveAll: saveStoredRecords,
};
