/**
 * 試遊の進行（T1-20）。**開始画面 → プレイ → 終了画面**の 3 つだけを持つ。
 *
 * 試遊は「進行役がついて、初対面の人に触ってもらう」場で行う。そこで必要なのは
 *
 * 1. 試遊者が**説明を読まずに始められる**こと（操作だけを出す）
 * 2. 記録が**押し忘れで消えない**こと（自動で localStorage に退避する）
 * 3. 進行役が**いつでも終われる**こと（時間切れでも記録は残る）
 *
 * の 3 点で、これはゲート判定（G1-1〜G1-3）の前提になる。
 *
 * **開始画面はルールを説明しない。** 絵とボタンだけを置き、
 * 2D / 3D・奥行き・世代の特性には触れない（G0-1 と同じ理由。IMPLEMENTATION_PLAN §8.1）。
 * ここが崩れると「説明なしで理解できるか」を測れなくなる。
 *
 * 開始画面はキービジュアル 1 枚（`public/assets/title/key_visual.png`）で構成する。
 * 文字による案内は一切持たない。**操作の一覧は `playtest_hud.ts` が遊んでいる間ずっと
 * 画面の隅に出し続ける**ので、ここで重ねて出す必要がない。
 * 目指す絵は `Docs/GRAPHICS_KEY_VISUAL_PLAN.md` の基準そのもので、
 * 開始画面はその基準を試遊者と開発者の双方に見せる場でもある。
 *
 * 併せて、開始ボタンの押下は**ブラウザが音を鳴らすために要求するユーザ操作**を兼ねる。
 *
 * これは製品のタイトル画面ではない（それはフェーズ 4）。試遊キットの一部として debug/ に置く。
 */
import type { PlaytestLog } from './playtest_log';

/** 記録を退避する間隔（ミリ秒）。落ちても直近の状態は残る */
export const KEEP_INTERVAL_MS = 10_000;

/**
 * キービジュアル。**配置先の相対で引く**（試遊はビルド成果物を配って行うので、
 * サイトの直下に置けるとは限らない。base は `vite.config.ts` の `'./'`）
 */
const KEY_VISUAL_URL = `${import.meta.env.BASE_URL}assets/title/key_visual.png`;

/** キービジュアルの余白に敷く色。絵のいちばん暗い青に合わせ、額縁として馴染ませる */
const LETTERBOX = '#080a1c';

/** キービジュアルの縦横比（1280 × 720）。ボタンを絵に対して固定するために要る */
const KEY_VISUAL_ASPECT = '16 / 9';

export interface PlaytestFlowOptions {
  log: PlaytestLog;
  /** ゴールに着いたか */
  isCleared: () => boolean;
  /** 「はじめる」が押された。音の開始と計測のやり直しをここへ繋ぐ */
  onStart: () => void;
  /** 「もう一度」が押された */
  onRestart: () => void;
  host?: HTMLElement;
  /** 試遊者の識別（`?tester=03`）。氏名は入れない */
  tester?: string | undefined;
}

export interface PlaytestFlow {
  /** 開始前は false。ゲームを進めてよいかの判定に使う */
  readonly started: boolean;
  readonly finished: boolean;
  /** 毎フレーム呼ぶ。ゴール到達の検出と記録の退避を行う */
  update(): void;
  /** 進行役が時間切れで終える */
  finish(): void;
  dispose(): void;
}

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

export function createPlaytestFlow(options: PlaytestFlowOptions): PlaytestFlow {
  const host = options.host ?? document.body;
  if (options.tester) options.log.setTester(options.tester);

  let started = false;
  let finished = false;
  let lastKeptMs = 0;

  // --- 開始画面 ---
  // 絵は**切らずに全体を出す**（`contain`）。題字が上、主人公が中央という構図そのものが
  // 見せたいものなので、画面比が合わないときは切るのではなく余白を足す
  const startPanel = panel();
  startPanel.style.background = LETTERBOX;
  startPanel.style.backgroundImage = `url(${KEY_VISUAL_URL})`;
  startPanel.style.backgroundSize = 'contain';
  startPanel.style.backgroundPosition = 'center';
  startPanel.style.backgroundRepeat = 'no-repeat';
  /**
   * ボタンを置くための、**絵とぴったり同じ大きさの枠**。
   * 背景の `contain` と同じ計算（16:9 に収まる最大の矩形）を再現しているので、
   * 画面比が変わってもボタンは絵に対して同じところに乗り続ける。
   * 枠を使わずに画面へ直接寄せると、縦長の画面で絵から遠く離れてしまう。
   */
  const startFrame = document.createElement('div');
  startFrame.style.cssText =
    `width:min(100vw, calc(100vh * ${KEY_VISUAL_ASPECT}));aspect-ratio:${KEY_VISUAL_ASPECT};` +
    // ボタンは右下。中央下は主人公の足が来るので、**絵のいちばん静かなところ**に置く
    'display:grid;align-items:end;justify-items:end;padding:0 4% 5% 0;box-sizing:border-box;';

  const startButton = button('はじめる');
  // キービジュアルの色（桃 → 白）に合わせる。既定の緑は絵から浮く
  startButton.style.background = '#ff4f8b';
  startButton.style.color = '#fff';
  startButton.style.padding = '14px 44px';
  startButton.style.letterSpacing = '.08em';
  startButton.style.boxShadow = '0 0 0 3px #10132e, 0 6px 22px rgba(0,0,0,.6)';
  startFrame.append(startButton);
  startPanel.append(startFrame);
  host.append(startPanel);

  // --- 終了画面 ---
  const endPanel = panel();
  endPanel.style.display = 'none';
  const endBox = document.createElement('div');
  const endTitle = document.createElement('div');
  endTitle.style.cssText = 'font-size:24px;font-weight:700;margin-bottom:8px;';
  const endBody = document.createElement('div');
  endBody.style.cssText = 'opacity:.75;';
  /**
   * 進行役の記入欄（T1-28 の追加の観測）。
   * 部屋ごとに「何が起きたか、自分の言葉で説明できたか」を可否で入れる。
   * **所見 2・3 が解けたかの直接の指標**なので、クリア時間より先に見る。
   */
  const askTitle = document.createElement('div');
  askTitle.style.cssText = 'margin-top:22px;font-size:13px;opacity:.55;';
  askTitle.textContent = '進行役の記入：何が起きたか、本人の言葉で説明できましたか';
  const askList = document.createElement('div');
  askList.style.cssText =
    'display:grid;grid-template-columns:auto auto auto;gap:6px 10px;justify-content:center;' +
    'align-items:center;margin-top:8px;font-size:14px;';

  const saveButton = button('記録を保存');
  const againButton = button('もう一度');
  againButton.style.background = '#42506b';
  againButton.style.color = '#e8edf7';
  endBox.append(endTitle, endBody, askTitle, askList, saveButton, againButton);
  endPanel.append(endBox);
  host.append(endPanel);

  /** 可 / 否 の 2 つ。押した側が明るくなるだけの最小の作り */
  function askRow(puzzleId: string): void {
    const label = document.createElement('div');
    label.style.cssText = 'opacity:.7;text-align:right;';
    label.textContent = puzzleId;
    const buttons: HTMLButtonElement[] = [];
    for (const [text, value] of [['可', true], ['否', false]] as Array<[string, boolean]>) {
      const choice = button(text);
      choice.style.cssText += 'margin:0;padding:4px 16px;font-size:14px;background:#2a3346;color:#e8edf7;';
      choice.addEventListener('click', () => {
        options.log.setExplained(puzzleId, value);
        // **押すたびに退避する。** 終了時の keep() は記入前に走るので、
        // ここで書き戻さないと「保存を押し忘れた回」から記入だけが消える
        options.log.keep();
        for (const other of buttons) {
          other.style.background = '#2a3346';
          other.style.color = '#e8edf7';
        }
        choice.style.background = value ? '#8ef0b0' : '#f0a08e';
        choice.style.color = '#0b0f18';
      });
      buttons.push(choice);
      askList.append(choice);
    }
    askList.insertBefore(label, buttons[0]!);
  }

  function finish(): void {
    if (finished || !started) return;
    finished = true;
    options.log.keep();
    const record = options.log.record();
    endTitle.textContent = record.cleared ? 'おしまい' : 'ここまでにします';
    endBody.textContent =
      `${Math.round(record.elapsedSeconds / 60)} 分 / 解けた仕掛け ${record.solvedCount} / ${record.puzzles.length}` +
      '　— 進行役にお知らせください';
    askList.replaceChildren();
    for (const puzzle of record.puzzles) askRow(puzzle.puzzleId);
    endPanel.style.display = 'grid';
  }

  startButton.addEventListener('click', () => {
    startPanel.style.display = 'none';
    started = true;
    lastKeptMs = performance.now();
    options.onStart();
  });

  saveButton.addEventListener('click', () => options.log.save());
  againButton.addEventListener('click', () => {
    endPanel.style.display = 'none';
    finished = false;
    options.onRestart();
  });

  return {
    get started() {
      return started;
    },
    get finished() {
      return finished;
    },
    update(): void {
      if (!started || finished) return;
      if (options.isCleared()) {
        options.log.markCleared();
        finish();
        return;
      }
      const now = performance.now();
      if (now - lastKeptMs >= KEEP_INTERVAL_MS) {
        lastKeptMs = now;
        options.log.keep();
      }
    },
    finish,
    dispose(): void {
      startPanel.remove();
      endPanel.remove();
    },
  };
}
