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
} from '@console-chaos/engine';
import { createConsoleChaosModule } from './app';
import { songOf } from './audio/songs';
import { createNoticeHud } from './debug/notice_hud';
import { createPlaytestLog, saveStoredRecords, storedRecords, type PlaytestLog } from './debug/playtest_log';
import { createPlaytestHud } from './debug/playtest_hud';
import { loadLevel } from './level/loader';
import { createConsoleChaosRenderManifest } from './presentation/catalog';
import { KEY_COLORS } from './render/key_palette';
import type { Session } from './gameplay/session';
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
const level = await loadLevel(`${import.meta.env.BASE_URL}assets/levels/${levelId}.json`);
const display = createDisplaySettings();
const assets = createAssetManager();
const unit = (color: readonly [number, number, number]): [number, number, number] =>
  [color[0] / 255, color[1] / 255, color[2] / 255];
const renderer = await createGenerationWebGlRenderer(canvas, {
  assets,
  manifest: createConsoleChaosRenderManifest(level),
  quality: () => 'full',
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
try {
  audio = createGenerationAudioService(new AudioContext({ latencyHint: 'interactive' }), initialSong.score);
} catch {
  // Automated browsers and restricted WebViews can run the complete game without Web Audio.
}

const resize = observeCanvasResize(canvas, () => renderer.resize());
const unlock = installAudioUnlock(document, () => audio.unlock());
const playtestHud = createPlaytestHud();
fitCanvasToStage();
const notice = createNoticeHud();
let session: Session | null = null;
let hud: Hud | null = null;
let playtest: PlaytestLog | null = null;

const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input,
  audio,
  assets,
  initialGeneration: 'PS1',
  seed: 0x436861,
});

await host.start(createConsoleChaosModule(level, {
  onCreate(created) {
    session = created;
    hud = createHud(canvas);
    playtest = createPlaytestLog(created, levelId);
  },
  onFixedUpdate(current) {
    hud?.update(hudModelFromSession(current));
    playtest?.update();
  },
  onDispose(current) {
    if (session === current) session = null;
    playtest?.keep();
    hud?.dispose();
    hud = null;
    playtest = null;
  },
}));

const displayKeys: Record<string, keyof DisplayOptions> = { n: 'moire', f: 'flatten' };
const windowResize = (): void => {
  fitCanvasToStage();
  hud?.layout();
};
window.addEventListener('resize', windowResize);
const keydown = (event: KeyboardEvent): void => {
  const key = event.key.toLowerCase();
  if (key === 'h') session?.requestHint();
  if (key === 'p') playtest?.save();
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
  playtestHud.dispose();
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
  };
}

(globalThis as Record<string, unknown>)['__playtest'] = {
  records: storedRecords,
  saveAll: saveStoredRecords,
};
