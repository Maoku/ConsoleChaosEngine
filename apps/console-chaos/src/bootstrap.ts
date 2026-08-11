import { ENGINE_VERSION } from '@console-chaos/engine';

document.documentElement.dataset.consoleChaosEngine = ENGINE_VERSION;
await import('./main');

