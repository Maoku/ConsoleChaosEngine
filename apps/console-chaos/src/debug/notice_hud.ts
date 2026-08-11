/**
 * 押した直後だけ出す短い知らせ（BGM の曲名、表示設定の入/切）。
 *
 * **出しっぱなしにしない。** 試遊で測りたいのはゲームの理解であって
 * 設定の状態ではないので（`playtest_hud.ts` の方針）、押した直後だけ数秒出して消す。
 * 文面は呼び出し元が作る（ここは出し方だけを持つ）。
 *
 * BR-05 で表示設定（モアレ・平面化）の知らせも同じ場所に出すようになったため、
 * `bgm_hud.ts` から改名した。**画面の同じ隅を 2 つの HUD で奪い合わせない**ためで、
 * 呼び出し元は 1 つのインスタンスを共有する。
 */

/** 出したままにする時間（ミリ秒）。消えるまでの余韻は CSS の transition が持つ */
export const NOTICE_MS = 1800;

export interface NoticeHud {
  show(text: string): void;
  dispose(): void;
}

export function createNoticeHud(host: HTMLElement = document.body): NoticeHud {
  const root = document.createElement('div');
  // 右下に出す。上の帯は HUD（チャンネルと進捗。T1-18）が、
  // 左下は操作一覧（`playtest_hud.ts`）が使っているので、空いているのはここだけ
  root.style.cssText =
    'position:fixed;bottom:16px;right:20px;z-index:10;pointer-events:none;opacity:0;' +
    'transition:opacity .25s ease;padding:6px 12px;border-radius:4px;' +
    'background:rgba(8,12,20,.72);color:#eaf2ff;' +
    'font:13px/1.4 system-ui,sans-serif;text-shadow:0 1px 3px #000;';
  host.append(root);

  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    show(text): void {
      root.textContent = text;
      root.style.opacity = '1';
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        root.style.opacity = '0';
        timer = null;
      }, NOTICE_MS);
    },
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
      root.remove();
    },
  };
}
