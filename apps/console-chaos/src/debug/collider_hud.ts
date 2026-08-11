/**
 * 当たり判定表示の読み上げ（デバッグ）。
 *
 * 線（`collider_view.ts`）だけでは「どこで何が起きたか」を文字に起こせない。
 * **試遊者がそのまま書き写せる 1 画面**を出すのがここの役目で、
 * 位置・世代・触れている当たり判定・近くの「見えない実体」を並べる。
 *
 * 文面を作る `colliderReportLines` は DOM を触らない純関数にしてある
 *（ヘッドレスで内容を固定できるようにするため）。
 */
import { DISPLAY_NAMES } from '@/generation/profiles';
import type { Session } from '@/gameplay/session';
import {
  COLLIDER_LEGEND,
  nearbyHidden,
  touchingBoxes,
  type ColliderBox,
  type ColliderKind,
} from './collider_view';

const KIND_LABELS: Record<ColliderKind, string> = {
  solid: '実体',
  hidden: '見えない実体',
  proxy: '判定だけの板',
  passable: 'すり抜け',
  player: '自分',
};

function meters(value: number): string {
  return value.toFixed(2);
}

/** 試遊者が書き写す 1 画面ぶんの文面。1 要素 = 1 行 */
export function colliderReportLines(session: Session, boxes: readonly ColliderBox[]): string[] {
  const [x, y, z] = session.player.position;
  const touching = touchingBoxes(session, boxes);
  const hidden = nearbyHidden(session, boxes);
  const channel = DISPLAY_NAMES[session.switcher.generation].channel;

  return [
    '当たり判定 ON（C で切替）',
    COLLIDER_LEGEND,
    `${channel}  x ${meters(x)}  y ${meters(y)}  z ${meters(z)}  接地 ${session.player.grounded ? 'あり' : 'なし'}`,
    `接触 ${
      touching.length === 0
        ? 'なし'
        : touching.map((box) => `${box.id}(${KIND_LABELS[box.kind]})`).join('  ')
    }`,
    `近くの見えない実体 ${
      hidden.length === 0 ? 'なし' : hidden.map(([id, distance]) => `${id} ${distance.toFixed(1)}m`).join('  ')
    }`,
  ];
}

export interface ColliderHud {
  /**
   * 毎フレーム呼ぶ。`boxes` は描画側が既に組み立てたものをそのまま渡す
   *（同じ 1 フレームについて 2 度組み立てない）。切れていれば何も出さない
   */
  update(session: Session, boxes: readonly ColliderBox[]): void;
  dispose(): void;
}

/**
 * 画面の隅に出す読み上げ。**キャンバスには書かない**（HUD と同じ方針。§13）。
 * デバッグ表示なので CRT の外側という制約までは負わず、隅に重ねるだけにする。
 */
export function createColliderHud(host: HTMLElement = document.body): ColliderHud {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;top:8px;left:12px;z-index:10;pointer-events:none;display:none;' +
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eaf2ff;' +
    'text-shadow:0 1px 3px #000,0 0 8px #000;white-space:pre;';
  host.append(root);

  return {
    update(session, boxes): void {
      // 表示が切れている間は箱が積まれない。そのまま「出さない」の合図として使う
      root.style.display = boxes.length === 0 ? 'none' : 'block';
      if (boxes.length === 0) return;
      root.textContent = colliderReportLines(session, boxes).join('\n');
    },
    dispose(): void {
      root.remove();
    },
  };
}
