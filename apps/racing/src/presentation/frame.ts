import type { GameContext, RenderFrame, Vec2 } from '@console-chaos/engine';
import { racingTheme } from '../config/themes';
import type { RacerState, RaceState } from '../gameplay/race';

const PAD = 10;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function carCommand(frame: RenderFrame, racer: RacerState, color: string): void {
  frame.sprites.push({
    id: racer.id,
    position: [racer.car.position[0], 0.2, racer.car.position[1]],
    size: [1.35, 2.35],
    color,
    rotation: racer.car.heading + Math.PI / 2,
    layer: 10,
  });
}

export function buildRacingFrame(frame: RenderFrame, state: RaceState, context: GameContext): void {
  const profile = context.generation.profile;
  const theme = racingTheme(profile.id);
  const player = state.player.car;
  const cameraDistance = profile.video.projection === 'ortho2d' ? 22 : 17;
  frame.camera = {
    projection: profile.video.projection === 'ortho2d' ? 'orthographic' : 'perspective',
    position: [player.position[0] - Math.cos(player.heading) * cameraDistance, 26, player.position[1] - Math.sin(player.heading) * cameraDistance],
    target: [player.position[0] + Math.cos(player.heading) * 4, 0, player.position[1] + Math.sin(player.heading) * 4],
    zoom: theme.cameraZoom,
  };
  frame.backgrounds.push({ color: theme.ground, secondaryColor: theme.sky });
  frame.meshes.push({
    id: 'track',
    geometry: { kind: 'polyline', points: state.track.points, width: state.track.halfWidth * 2, closed: true },
    transform: { position: [0, 0, 0] },
    color: theme.road,
    stroke: theme.road,
    layer: 0,
  });
  frame.meshes.push({
    id: 'center-line',
    geometry: { kind: 'polyline', points: state.track.points, width: 0.12, closed: true },
    transform: { position: [0, 0.02, 0] },
    color: theme.roadEdge,
    stroke: theme.roadEdge,
    layer: 1,
  });
  state.track.checkpoints.forEach((checkpoint, index) => {
    frame.meshes.push({
      id: `checkpoint-${index}`,
      geometry: { kind: 'circle', radius: index === 0 ? 1.2 : 0.65 },
      transform: { position: [checkpoint[0], 0.03, checkpoint[1]] },
      color: index === state.player.laps.nextCheckpoint ? theme.checkpoint : '#ffffff',
      layer: 2,
    });
  });
  carCommand(frame, state.player, theme.player);
  for (const opponent of state.opponents) carCommand(frame, opponent, theme.opponent);

  const width = profile.video.internalWidth;
  const height = profile.video.internalHeight;
  const elapsed = Math.max(0, state.tick - 180) / 60;
  const lap = Math.min(state.player.laps.lap + 1, 3);
  const hudFont = profile.id === 'FC' ? '10px monospace' : '12px monospace';
  frame.overlays.push(
    { kind: 'rect', position: [0, 0], size: [width, 28], color: '#07101ccc' },
    { kind: 'text', position: [PAD, 8], text: theme.label, color: '#ffffff', font: hudFont },
    { kind: 'text', position: [width / 2, 8], text: `LAP ${lap}/3`, color: '#ffffff', align: 'center', font: hudFont },
    { kind: 'text', position: [width - PAD, 8], text: `P${state.rank}/2  ${formatTime(elapsed)}`, color: '#ffffff', align: 'right', font: hudFont },
  );

  if (state.phase === 'countdown') {
    const count = Math.max(1, Math.ceil(state.countdownTicks / 60));
    frame.overlays.push({ kind: 'text', position: [width / 2, height / 2 - 18], text: `${count}`, color: '#ffffff', align: 'center', font: 'bold 36px monospace' });
  } else if (state.phase === 'finished') {
    const size: Vec2 = [Math.min(300, width - 30), 92];
    frame.overlays.push(
      { kind: 'rect', position: [(width - size[0]) / 2, (height - size[1]) / 2], size, color: '#07101ce8' },
      { kind: 'text', position: [width / 2, height / 2 - 30], text: `FINISH  P${state.rank}`, color: '#ffd43b', align: 'center', font: 'bold 20px monospace' },
      { kind: 'text', position: [width / 2, height / 2], text: formatTime(state.resultTime ?? 0), color: '#ffffff', align: 'center', font: '14px monospace' },
      { kind: 'text', position: [width / 2, height / 2 + 24], text: 'R / GAMEPAD Y: RESTART', color: '#a9bed5', align: 'center', font: '10px monospace' },
    );
  }
}

