import type { CampaignController } from '@/gameplay/campaign';

export function createCampaignFlow(controller: CampaignController) {
  const panel = document.createElement('div');
  panel.dataset.campaignPanel = 'true';
  panel.style.cssText = 'position:fixed;inset:0;z-index:15;display:grid;place-items:center;background:rgba(8,10,28,.92);color:#e8edf7;font:16px/1.8 system-ui;text-align:center;';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:600px;padding:30px;';
  panel.append(box); document.body.append(panel);
  const button = (label: string, action: () => void): void => {
    const element = document.createElement('button'); element.textContent = label;
    element.style.cssText = 'margin:12px 6px;padding:12px 24px;border:0;border-radius:6px;background:#8ef0b0;color:#10132e;font:600 16px system-ui;cursor:pointer;';
    element.onclick = action; box.append(element);
  };
  const update = (): void => {
    const mode = controller.mode;
    panel.style.display = mode === 'playing' ? 'none' : 'grid';
    panel.dataset.mode = mode;
    box.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = mode === 'title' ? 'Console Chaos' : mode === 'stageComplete' ? '信号が次の場所へ届いた' : mode === 'finished' ? '四つの時代が、ひとつにつながった' : mode === 'error' ? 'ステージを準備できませんでした' : '準備中…';
    const body = document.createElement('p');
    body.textContent = mode === 'title' ? '世代を切り替え、技術の違いを使って進む、4ステージの謎解きアクション。移動 WASD / 矢印、ジャンプ Space、切替 1〜4、ヒント H。' : mode === 'stageComplete' ? controller.session?.runtime?.stage.title + '　復旧完了' : mode === 'finished' ? '色の合流、回転の中継、継ぎ目の復旧、光の反応。異なる技術の成果が、終端の心臓を動かした。' : mode === 'error' ? '保存した進行から再開できます。' : '足場と装置を準備しています。';
    box.append(title, body);
    if (mode === 'title') { if (controller.canResume) button('続きから', () => controller.resume()); button('最初から', () => controller.startNew()); }
    if (mode === 'stageComplete') button('次のステージへ', () => controller.next());
    if (mode === 'finished') button('もう一度', () => controller.startNew());
    if (mode !== 'title' && mode !== 'loading') button('タイトルへ', () => controller.returnTitle());
  };
  update();
  return { update, dispose() { panel.remove(); } };
}
