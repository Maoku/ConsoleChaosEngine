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

export function colliderReportLines(session: Session, boxes: readonly ColliderBox[]): string[] {
  const [x, y, z] = session.player.position;
  const touching = touchingBoxes(session, boxes);
  const hidden = nearbyHidden(session, boxes);
  const channel = session.profile.theme.display.channel;
  return [
    '当たり判定 ON（C で切替）',
    COLLIDER_LEGEND,
    `${channel}  x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}  接地 ${session.player.grounded ? 'あり' : 'なし'}`,
    `接触 ${touching.length === 0 ? 'なし' : touching.map((box) => `${box.id}(${KIND_LABELS[box.kind]})`).join('  ')}`,
    `近くの見えない実体 ${hidden.length === 0 ? 'なし' : hidden.map(([id, distance]) => `${id} ${distance.toFixed(1)}m`).join('  ')}`,
  ];
}

export interface ColliderHud {
  update(session: Session, boxes: readonly ColliderBox[]): void;
  dispose(): void;
}

export function createColliderHud(host: HTMLElement = document.body): ColliderHud {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;top:8px;left:12px;z-index:10;pointer-events:none;display:none;' +
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eaf2ff;' +
    'text-shadow:0 1px 3px #000,0 0 8px #000;white-space:pre;';
  host.append(root);
  return {
    update(session, boxes): void {
      root.style.display = boxes.length === 0 ? 'none' : 'block';
      if (boxes.length > 0) root.textContent = colliderReportLines(session, boxes).join('\n');
    },
    dispose(): void {
      root.remove();
    },
  };
}
