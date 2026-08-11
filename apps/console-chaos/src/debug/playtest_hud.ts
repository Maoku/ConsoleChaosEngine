/**
 * 試遊中に出しておく操作の案内。
 *
 * **ゲートの性質上、ここに書いてよいのは「操作方法」だけ。**
 * 2D / 3D・奥行き・投影といった**ルールの説明は一切出さない**。
 * 出した瞬間に「説明なしで理解できるか」を測れなくなる（IMPLEMENTATION_PLAN §8.1 G0-1）。
 *
 * かつてはチャンネル表示とゴール時間もここが持っていたが、
 * チャンネルは T1-18 の HUD（`ui/hud.ts`）へ、終了の知らせと記録は
 * T1-20 の `playtest_flow.ts` / `playtest_log.ts` へ移した。
 * 残っているのは**画面の隅に出し続ける操作一覧**だけ。
 */

/** 操作の案内。ルールに触れない言葉だけを使う */
const CONTROLS = [
  ['移動', '← → ↑ ↓ / W A S D'],
  ['ジャンプ', 'Space'],
  ['チャンネル', '1 2 3 4（Q / E で隣へ）'],
  ['ヒント', 'H'],
  ['やり直し', 'R'],
  // 不具合の報告用（T1-29）。ルールの説明ではなく操作なので、ここに置いてよい
  ['当たり判定', 'C'],
  // 音の切替。曲名は押した直後だけ画面の隅に出る（`notice_hud.ts`）
  ['BGM', 'B（曲）/ M（消音）'],
  // 表示の切替（BR-05）。T3-06 で設定画面へ移すまでの暫定
  ['モアレ', 'N'],
  ['平面化', 'F'],
] as const;

export interface PlaytestHud {
  dispose(): void;
}

function styled(tag: string, css: string, text = ''): HTMLElement {
  const element = document.createElement(tag);
  element.style.cssText = css;
  element.textContent = text;
  return element;
}

export function createPlaytestHud(host: HTMLElement = document.body): PlaytestHud {
  const root = styled(
    'div',
    'position:absolute;inset:0;pointer-events:none;font:14px/1.6 system-ui,sans-serif;color:#cfd6e4;',
  );

  const controls = styled('div', 'position:absolute;bottom:16px;left:20px;opacity:.75;text-shadow:0 2px 6px #000;');
  for (const [name, keys] of CONTROLS) {
    const row = styled('div', '');
    row.append(styled('span', 'display:inline-block;width:7.5em;opacity:.7;', name), styled('span', '', keys));
    controls.append(row);
  }

  root.append(controls);
  host.append(root);

  return {
    dispose(): void {
      root.remove();
    },
  };
}

