import type { ConsoleChaosGenerationView } from '@/config/generation';
import type { StageRuntime } from './puzzles/stage-instances';
import type { Vec3 } from './projection';

/** The fixed garden view has a 17.14-world-unit width: keep the avatar inside its bounds. */
export function activeGarden(runtime: StageRuntime | undefined, position: Vec3) {
  return runtime && [...runtime.gardens].find(([, pose]) => Math.abs(pose.center[0] - position[0]) <= 8);
}
export function stageCameraProfile(profile: ConsoleChaosGenerationView, runtime: StageRuntime | undefined, position: Vec3): ConsoleChaosGenerationView {
  if (!activeGarden(runtime, position)) return profile;
  return { ...profile, theme: { ...profile.theme, camera: { ...profile.theme.camera, forward: [0, -1] } } };
}
