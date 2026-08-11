import { ENGINE_VERSION } from '@console-chaos/engine';

document.documentElement.dataset.consoleChaosEngine = ENGINE_VERSION;
document.documentElement.dataset.consoleChaosRuntime = 'game-host';
await import('./engine-bootstrap');
