import { ENGINE_VERSION } from '@console-chaos/engine';

document.documentElement.dataset.consoleChaosEngine = ENGINE_VERSION;
document.documentElement.dataset.consoleChaosRuntime = 'game-host';
try {
  await import('./engine-bootstrap');
} catch (error) {
  console.error('Console Chaos startup failed', error);
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:0;background:#080a1c;color:#e8edf7;display:grid;place-content:center;text-align:center;font:18px system-ui;';
  const message = document.createElement('p'); message.textContent = 'ゲームを準備できませんでした。進行は保存したままです。';
  const retry = document.createElement('button'); retry.textContent = '再読み込み'; retry.onclick = () => location.reload();
  panel.append(message, retry); document.body.append(panel);
}
