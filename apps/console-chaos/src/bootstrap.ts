import { ENGINE_VERSION } from '@console-chaos/engine';

document.documentElement.dataset.consoleChaosEngine = ENGINE_VERSION;

const runtime = new URLSearchParams(location.search).get('runtime');
const useComparisonRuntime = import.meta.env.DEV && runtime === 'engine';
document.documentElement.dataset.consoleChaosRuntime = useComparisonRuntime ? 'engine-comparison' : 'legacy-baseline';

if (useComparisonRuntime) await import('./engine-bootstrap');
else await import('./main');
