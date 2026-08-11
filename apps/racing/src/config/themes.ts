import { defineGenerationVariant, type GenerationId } from '@console-chaos/engine';

export interface RacingGenerationTheme {
  label: string;
  sky: string;
  ground: string;
  road: string;
  roadEdge: string;
  player: string;
  opponent: string;
  checkpoint: string;
  cameraZoom: number;
}

export const RACING_THEMES = defineGenerationVariant<RacingGenerationTheme>({
  FC: { label: 'CH 1 / 8-BIT', sky: '#18345c', ground: '#24512f', road: '#55585f', roadEdge: '#e0d060', player: '#f4e05a', opponent: '#e04444', checkpoint: '#62d7ef', cameraZoom: 45 },
  SFC: { label: 'CH 2 / 16-BIT', sky: '#426fa3', ground: '#3c7848', road: '#5b6370', roadEdge: '#f3e6a2', player: '#ffd43b', opponent: '#f06565', checkpoint: '#66d9e8', cameraZoom: 42 },
  PS1: { label: 'CH 3 / POLYGON', sky: '#7087a2', ground: '#526d45', road: '#4c5159', roadEdge: '#ddd2a5', player: '#f5c542', opponent: '#ca3c55', checkpoint: '#4dd4e9', cameraZoom: 37 },
  PS2: { label: 'CH 4 / BROADBAND', sky: '#88aeca', ground: '#567c4c', road: '#3f4650', roadEdge: '#f5efe1', player: '#ffc928', opponent: '#db3153', checkpoint: '#46e1f2', cameraZoom: 34 },
});

export const racingTheme = (generation: GenerationId): RacingGenerationTheme => RACING_THEMES[generation];

