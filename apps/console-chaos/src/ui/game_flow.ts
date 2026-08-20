export type RunMode = 'title' | 'manual' | 'demo' | 'clear';

export const TITLE_DEMO_IDLE_MS = 10_000;
export const GAMEPAD_ACTIVITY_DEADZONE = 0.25;

export interface GameFlowControllerOptions {
  now?: () => number;
  isCleared: () => boolean;
  onManualStart: () => void;
  onManualRestart: () => void;
  onManualFinish: (cleared: boolean) => void;
  onDemoStart?: () => boolean;
  onReturnTitle?: () => void;
  onModeChange?: (mode: RunMode) => void;
}

export interface GameFlowController {
  readonly mode: RunMode;
  update(now?: number, gamepadActive?: boolean): void;
  activity(now?: number): void;
  setVisible(visible: boolean, now?: number): void;
  startManual(): void;
  finishManual(): void;
  restartManual(): void;
  returnToTitle(now?: number): void;
}

/** 実時間のタイトル待機とゲーム状態遷移だけを持つ、DOM 非依存 controller。 */
export function createGameFlowController(options: GameFlowControllerOptions): GameFlowController {
  const now = options.now ?? (() => performance.now());
  let mode: RunMode = 'title';
  let visible = true;
  let lastTitleActivityMs = now();

  const setMode = (next: RunMode): void => {
    if (mode === next) return;
    mode = next;
    options.onModeChange?.(mode);
  };

  const returnToTitle = (at = now()): void => {
    options.onReturnTitle?.();
    lastTitleActivityMs = at;
    setMode('title');
  };

  return {
    get mode() {
      return mode;
    },
    update(at = now(), gamepadActive = false): void {
      if (mode === 'manual' && options.isCleared()) {
        options.onManualFinish(true);
        setMode('clear');
        return;
      }
      if (mode !== 'title' || !visible) return;
      if (gamepadActive) {
        lastTitleActivityMs = at;
        return;
      }
      if (at - lastTitleActivityMs < TITLE_DEMO_IDLE_MS) return;
      // アンカー不足などで開始できない場合も、毎フレーム再要求しない。
      lastTitleActivityMs = at;
      if (options.onDemoStart?.() === true) setMode('demo');
    },
    activity(at = now()): void {
      if (mode === 'title') {
        lastTitleActivityMs = at;
      } else if (mode === 'demo') {
        returnToTitle(at);
      }
    },
    setVisible(nextVisible, at = now()): void {
      visible = nextVisible;
      // 非表示中の実時間をタイトル待機へ算入しない。
      if (visible && mode === 'title') lastTitleActivityMs = at;
    },
    startManual(): void {
      if (mode !== 'title') return;
      options.onManualStart();
      setMode('manual');
    },
    finishManual(): void {
      if (mode !== 'manual') return;
      options.onManualFinish(false);
      setMode('clear');
    },
    restartManual(): void {
      if (mode !== 'clear') return;
      options.onManualRestart();
      setMode('manual');
    },
    returnToTitle,
  };
}

export interface ClearQuestion {
  puzzleId: string;
  label: string;
}

export interface ClearScreenModel {
  title: string;
  body: string;
  questions: readonly ClearQuestion[];
}

export interface GameFlowOptions extends Omit<GameFlowControllerOptions, 'onModeChange'> {
  clearModel: () => ClearScreenModel;
  onExplained: (puzzleId: string, value: boolean) => void;
  onSave: () => void;
  host?: HTMLElement;
}

export interface GameFlow {
  readonly mode: RunMode;
  update(): void;
  finishManual(): void;
  returnToTitle(): void;
  dispose(): void;
}

const KEY_VISUAL_URL = `${import.meta.env.BASE_URL}assets/title/key_visual.png`;
const LETTERBOX = '#080a1c';
const KEY_VISUAL_ASPECT = '16 / 9';

function panel(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.96);' +
    'font:16px/1.7 system-ui,sans-serif;color:#e8edf7;text-align:center;z-index:10;';
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  element.style.cssText =
    'margin:8px 6px 0;padding:12px 28px;font:600 16px system-ui,sans-serif;color:#0b0f18;' +
    'background:#8ef0b0;border:0;border-radius:6px;cursor:pointer;';
  return element;
}

function gamepadActive(): boolean {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (!pad) continue;
    if (pad.buttons.some((item) => item.pressed || item.value > GAMEPAD_ACTIVITY_DEADZONE)) return true;
    if (pad.axes.some((axis) => Math.abs(axis) > GAMEPAD_ACTIVITY_DEADZONE)) return true;
  }
  return false;
}

export function createGameFlow(options: GameFlowOptions): GameFlow {
  const host = options.host ?? document.body;
  const startPanel = panel();
  startPanel.style.background = LETTERBOX;
  startPanel.style.backgroundImage = `url(${KEY_VISUAL_URL})`;
  startPanel.style.backgroundSize = 'contain';
  startPanel.style.backgroundPosition = 'center';
  startPanel.style.backgroundRepeat = 'no-repeat';
  const startFrame = document.createElement('div');
  startFrame.style.cssText =
    `width:min(100vw, calc(100vh * ${KEY_VISUAL_ASPECT}));aspect-ratio:${KEY_VISUAL_ASPECT};` +
    'display:grid;align-items:end;justify-items:end;padding:0 4% 5% 0;box-sizing:border-box;';
  const startButton = button('はじめる');
  startButton.style.background = '#ff4f8b';
  startButton.style.color = '#fff';
  startButton.style.padding = '14px 44px';
  startButton.style.letterSpacing = '.08em';
  startButton.style.boxShadow = '0 0 0 3px #10132e, 0 6px 22px rgba(0,0,0,.6)';
  startFrame.append(startButton);
  startPanel.append(startFrame);
  host.append(startPanel);

  const endPanel = panel();
  endPanel.style.display = 'none';
  const endBox = document.createElement('div');
  const endTitle = document.createElement('div');
  endTitle.style.cssText = 'font-size:24px;font-weight:700;margin-bottom:8px;';
  const endBody = document.createElement('div');
  endBody.style.cssText = 'opacity:.75;';
  const askTitle = document.createElement('div');
  askTitle.style.cssText = 'margin-top:22px;font-size:13px;opacity:.55;';
  askTitle.textContent = '進行役の記入：何が起きたか、本人の言葉で説明できましたか';
  const askList = document.createElement('div');
  askList.style.cssText =
    'display:grid;grid-template-columns:auto auto auto;gap:6px 10px;justify-content:center;' +
    'align-items:center;margin-top:8px;font-size:14px;max-height:min(42vh,360px);' +
    'overflow-y:auto;padding:0 12px;';
  const saveButton = button('記録を保存');
  const againButton = button('もう一度');
  againButton.style.background = '#42506b';
  againButton.style.color = '#e8edf7';
  endBox.append(endTitle, endBody, askTitle, askList, saveButton, againButton);
  endPanel.append(endBox);
  host.append(endPanel);

  const renderClear = (): void => {
    const model = options.clearModel();
    endTitle.textContent = model.title;
    endBody.textContent = model.body;
    askList.replaceChildren();
    for (const question of model.questions) {
      const label = document.createElement('div');
      label.style.cssText = 'opacity:.7;text-align:right;';
      label.textContent = question.label;
      const choices: HTMLButtonElement[] = [];
      for (const [text, value] of [['可', true], ['否', false]] as Array<[string, boolean]>) {
        const choice = button(text);
        choice.style.cssText += 'margin:0;padding:4px 16px;font-size:14px;background:#2a3346;color:#e8edf7;';
        choice.addEventListener('click', () => {
          options.onExplained(question.puzzleId, value);
          for (const other of choices) {
            other.style.background = '#2a3346';
            other.style.color = '#e8edf7';
          }
          choice.style.background = value ? '#8ef0b0' : '#f0a08e';
          choice.style.color = '#0b0f18';
        });
        choices.push(choice);
      }
      askList.append(label, ...choices);
    }
  };

  const controller = createGameFlowController({
    ...options,
    onModeChange(mode): void {
      startPanel.style.display = mode === 'title' ? 'grid' : 'none';
      endPanel.style.display = mode === 'clear' ? 'grid' : 'none';
      if (mode === 'clear') renderClear();
    },
  });
  const activity = (): void => controller.activity();
  const visibility = (): void => controller.setVisible(document.visibilityState !== 'hidden');
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'touchstart'] as const) {
    window.addEventListener(type, activity, { passive: true });
  }
  document.addEventListener('visibilitychange', visibility);
  startButton.addEventListener('click', () => controller.startManual());
  saveButton.addEventListener('click', options.onSave);
  againButton.addEventListener('click', () => controller.restartManual());

  return {
    get mode() {
      return controller.mode;
    },
    update: () => controller.update(performance.now(), gamepadActive()),
    finishManual: () => controller.finishManual(),
    returnToTitle: () => controller.returnToTitle(),
    dispose(): void {
      for (const type of ['keydown', 'pointerdown', 'pointermove', 'touchstart'] as const) {
        window.removeEventListener(type, activity);
      }
      document.removeEventListener('visibilitychange', visibility);
      startPanel.remove();
      endPanel.remove();
    },
  };
}
