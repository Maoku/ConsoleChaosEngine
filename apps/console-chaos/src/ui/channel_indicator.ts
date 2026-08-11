/**
 * チャンネルインジケータ（T1-18、GAME_PLAN §13）。
 *
 * **常時表示。ただし CRT フレームの外側に置く。**
 * ゲーム画面（＝世代の再現）に文字を焼き込むと、量子化・走査線・にじみの
 * 再現性が壊れる。だから HUD は DOM で、キャンバスの外に出す。
 * この制約は `ui/hud.ts` の配置計算が機械的に守る。
 *
 * 表示するのは**チャンネル番号と世代名だけ**（実機名は出さない。GAME_PLAN §7.1.1）。
 * 切替中は「行き先」を併記し、連打しても今どこへ向かっているかが読めるようにする。
 */
import { DISPLAY_NAMES, type GenerationId } from '@/generation/profiles';

export interface ChannelView {
  generation: GenerationId;
  /** 切替中の元の世代。切替中でなければ null */
  from: GenerationId | null;
  /** 完了待ちの切替先。無ければ null */
  pending: GenerationId | null;
  /** 強制切替の状態にあるか（GAME_PLAN §5.4） */
  forced: boolean;
  /** 強制切替の予告の残り時間（ミリ秒）。予告が出ていなければ null */
  warningRemainingMs: number | null;
  /** 予告の切替先 */
  warningTo: GenerationId | null;
}

export interface ChannelIndicatorModel {
  /** 例: 「CH 1」 */
  channel: string;
  /** 例: 「第1世代」 */
  label: string;
  /** 切替中・予約中に出す行き先。無ければ null */
  destination: string | null;
  switching: boolean;
  forced: boolean;
  /** 予告中の点滅。1.5 秒の予告のあいだ真偽が反転する（GAME_PLAN §5.4） */
  blinkOn: boolean;
}

/** 予告の点滅周期（ミリ秒）。速すぎると光過敏の配慮に反するので、ゆっくり点ける */
export const WARNING_BLINK_PERIOD_MS = 500;

export function channelIndicatorModel(view: ChannelView): ChannelIndicatorModel {
  const names = DISPLAY_NAMES[view.generation];
  // 行き先の優先順位: 予告 > 予約 > 切替中の現世代（＝ from から見た行き先）
  const destinationId = view.warningTo ?? view.pending ?? (view.from === null ? null : view.generation);
  const remaining = view.warningRemainingMs;
  return {
    channel: names.channel,
    label: names.label,
    destination: destinationId === null ? null : DISPLAY_NAMES[destinationId].channel,
    switching: view.from !== null || view.pending !== null,
    forced: view.forced || remaining !== null,
    blinkOn: remaining === null ? false : Math.floor(remaining / WARNING_BLINK_PERIOD_MS) % 2 === 0,
  };
}

/** 表示用の 1 行。テストしやすいよう、文字列の組み立てだけを切り出す */
export function channelIndicatorText(model: ChannelIndicatorModel): string {
  const head = `${model.channel} / ${model.label}`;
  return model.destination === null ? head : `${head}  →  ${model.destination}`;
}

export interface ChannelIndicator {
  readonly element: HTMLElement;
  update(view: ChannelView): void;
  dispose(): void;
}

/** DOM 側。要素を作るだけで、位置決めは `ui/hud.ts` が行う */
export function createChannelIndicator(): ChannelIndicator {
  const element = document.createElement('div');
  element.style.cssText =
    'font:600 18px/1.4 system-ui,sans-serif;letter-spacing:.08em;color:#e8edf7;white-space:nowrap;';

  return {
    element,
    update(view): void {
      const model = channelIndicatorModel(view);
      element.textContent = channelIndicatorText(model);
      // 強制切替の予告中だけ色を変える（普段は色に意味を持たせない）
      element.style.color = model.forced && model.blinkOn ? '#ff6b6b' : '#e8edf7';
      element.style.opacity = model.switching ? '0.75' : '1';
    },
    dispose(): void {
      element.remove();
    },
  };
}
