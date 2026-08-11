/**
 * HUD（T1-18、GAME_PLAN §13）。
 *
 * **受け入れ条件は「CRT フレームの外側に表示され、ゲーム画面の再現性を汚さない」。**
 * そのために HUD は
 *
 * 1. WebGL のフレームバッファに一切書かない（DOM だけで作る）
 * 2. キャンバスの矩形を実測し、その**外側**に帯を置く（`layout()`）
 *
 * の 2 点で条件を守る。1 だけでは「キャンバスに重ねた DOM」になり、
 * 走査線やにじみの見えを覆ってしまうので、2 が要る。
 *
 * 例外は復帰時の暗転（`fade`）だけ。あれは情報表示ではなく画面遷移そのものなので、
 * キャンバスの上に重ねる。暗転中はどのみち世代の見えを確認できない。
 *
 * 表示するのは 4 つ:
 *   チャンネル / 進行（解けたパズル数）/ ヒント / 復帰の暗転
 */
import { fadeAmount } from '@/gameplay/checkpoint';
import { NO_PENALTY_NOTE, type HintMessage } from '@/gameplay/hints';
import type { Session } from '@/gameplay/session';
import { createChannelIndicator, type ChannelView } from './channel_indicator';

/** キャンバスの上下に確保する帯の高さ（画素） */
export const BAR_HEIGHT_PX = 40;

export interface HudModel {
  channel: ChannelView;
  /** 解けたパズル数 / 配置されたパズル数 */
  solvedCount: number;
  puzzleCount: number;
  hint: HintMessage | null;
  /** 復帰の暗さ 0..1 */
  fade: number;
}

/** セッションの状態を HUD の入力へ落とす。UI はセッションを直接触らない */
export function hudModelFromSession(session: Session): HudModel {
  const switcher = session.generation;
  return {
    channel: {
      generation: switcher.generation,
      from: switcher.transition.active ? switcher.transition.from : null,
      pending: switcher.pending,
      forced: switcher.forced,
      warningRemainingMs: switcher.warningRemainingMs,
      warningTo: switcher.warningTo,
    },
    solvedCount: session.solved.size,
    puzzleCount: session.level.puzzles.length,
    hint: session.hints.message,
    fade: fadeAmount(session.checkpoints),
  };
}

/** 進行の表示。「解けた数 / 全体」だけを出す（順路を指示しない） */
export function progressText(model: HudModel): string {
  return `${model.solvedCount} / ${model.puzzleCount}`;
}

/** ヒントの表示文。段階を添えるのは「まだ先がある」と分かるようにするため */
export function hintText(hint: HintMessage | null): string {
  if (!hint) return '';
  return `ヒント ${hint.stage}／4  ${hint.text}`;
}

export interface Hud {
  /** 毎フレーム呼ぶ */
  update(model: HudModel): void;
  /** キャンバスの位置・大きさが変わったときに呼ぶ（既定でウィンドウのリサイズに追従する） */
  layout(): void;
  dispose(): void;
}

export interface HudSlots {
  /** キャンバスの上下に用意された帯（index.html の #hud-top / #hud-bottom） */
  top?: HTMLElement | null;
  bottom?: HTMLElement | null;
  host?: HTMLElement;
}

function styled(css: string, text = ''): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText = css;
  element.textContent = text;
  return element;
}

/**
 * 帯の置き場所は **ページのレイアウトが用意する**（index.html の `#hud-top` / `#hud-bottom`）。
 * 場所が用意されていないページでは、キャンバスの矩形を実測して外側へ逃がす。
 * どちらの経路でも「ゲーム画面の上に情報を重ねない」ことは変わらない。
 *
 * @param canvas 位置の基準にするゲーム画面
 */
export function createHud(canvas: HTMLCanvasElement, slots: HudSlots = {}): Hud {
  const host = slots.host ?? document.body;
  const topSlot = slots.top ?? document.getElementById('hud-top');
  const bottomSlot = slots.bottom ?? document.getElementById('hud-bottom');
  const detached = topSlot === null || bottomSlot === null;

  // 帯そのもの。幅はキャンバスに合わせる（レイアウトが用意した場所の中で中央に置く）
  const barCss = `height:${BAR_HEIGHT_PX}px;display:flex;align-items:center;`;
  const topBar = styled(`${barCss}justify-content:space-between;gap:24px;`);
  const indicator = createChannelIndicator();
  const progress = styled('opacity:.75;font-variant-numeric:tabular-nums;');
  topBar.append(indicator.element, progress);

  const bottomBar = styled(`${barCss}flex-direction:column;justify-content:center;align-items:flex-start;`);
  const hint = styled('color:#ffd479;');
  // ペナルティが無いことは、ヒントが出ているときだけ添える（§13.1）
  const note = styled('font-size:12px;opacity:.55;display:none;', NO_PENALTY_NOTE);
  bottomBar.append(hint, note);

  // 暗転だけはキャンバスに重ねる（情報表示ではなく画面遷移のため）
  const overlay = styled(
    'position:fixed;inset:0;pointer-events:none;font:14px/1.5 system-ui,sans-serif;color:#cfd6e4;',
  );
  const fade = styled('position:absolute;background:#000;opacity:0;');
  overlay.append(fade);
  host.append(overlay);

  if (detached) {
    // 場所が無いページ向けの退避経路。帯を実測でキャンバスの外へ置く
    topBar.style.position = 'absolute';
    bottomBar.style.position = 'absolute';
    overlay.append(topBar, bottomBar);
  } else {
    topSlot.append(topBar);
    bottomSlot.append(bottomBar);
  }

  function layout(): void {
    const rect = canvas.getBoundingClientRect();
    for (const bar of [topBar, bottomBar]) bar.style.width = `${rect.width}px`;
    if (detached) {
      topBar.style.left = `${rect.left}px`;
      topBar.style.top = `${Math.max(0, rect.top - BAR_HEIGHT_PX)}px`;
      bottomBar.style.left = `${rect.left}px`;
      bottomBar.style.top = `${Math.min(window.innerHeight - BAR_HEIGHT_PX, rect.bottom)}px`;
    }
    fade.style.left = `${rect.left}px`;
    fade.style.top = `${rect.top}px`;
    fade.style.width = `${rect.width}px`;
    fade.style.height = `${rect.height}px`;
  }

  layout();
  window.addEventListener('resize', layout);

  return {
    update(model): void {
      indicator.update(model.channel);
      progress.textContent = progressText(model);
      hint.textContent = hintText(model.hint);
      note.style.display = model.hint ? 'block' : 'none';
      fade.style.opacity = String(model.fade);
    },
    layout,
    dispose(): void {
      window.removeEventListener('resize', layout);
      indicator.dispose();
      topBar.remove();
      bottomBar.remove();
      overlay.remove();
    },
  };
}
