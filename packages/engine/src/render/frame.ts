import type { GenerationId } from '../generation/profiles';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Color = string;

export interface TransformCommand {
  position: Vec3;
  rotationY?: number;
  scale?: Vec3;
}

export interface CameraCommand {
  projection: 'orthographic' | 'perspective';
  position: Vec3;
  target: Vec3;
  zoom: number;
  orthoHeight?: number;
  fovDegrees?: number;
}

export type GeometryCommand =
  | { kind: 'box'; halfExtents?: Vec3; uvScale?: number }
  | { kind: 'quad'; halfSize: Vec2; uvRepeat?: Vec2 }
  | { kind: 'circle'; radius: number }
  | { kind: 'polygon'; points: readonly Vec2[] }
  | { kind: 'polyline'; points: readonly Vec2[]; width: number; closed?: boolean };

export interface MeshCommand {
  id: string;
  geometry: GeometryCommand;
  transform: TransformCommand;
  color: Color;
  stroke?: Color;
  wireframe?: boolean;
  layer?: number;
  asset?: string;
  material?: string;
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  groundY?: number;
  generations?: readonly GenerationId[];
}

export interface SkinnedMeshCommand {
  id: string;
  model: string;
  clip: string;
  animationTime: number;
  transform: TransformCommand;
  tint?: Color;
  tintFactor?: readonly [number, number, number, number];
  frontAxis?: '-Z' | '+Z';
  material?: string;
  layer?: number;
  visible?: boolean;
  generations?: readonly GenerationId[];
}

export interface SpriteCommand {
  id: string;
  position: Vec3;
  size: Vec2;
  color: Color;
  rotation?: number;
  layer?: number;
  texture?: string;
  atlas?: string;
  cell?: number;
  flipX?: boolean;
  alphaCutoff?: number;
  visible?: boolean;
  generations?: readonly GenerationId[];
}

export interface LightCommand {
  id: string;
  position: Vec3;
  color: Color;
  intensity: number;
  radius: number;
  kind?: 'point' | 'directional' | 'ambient';
  generations?: readonly GenerationId[];
}

export interface BackgroundCommand {
  color: Color;
  secondaryColor?: Color;
  texture?: string;
  repeat?: Vec2;
  parallax?: Vec2;
  offset?: Vec2;
  placement?: { bottom: number; height: number };
  brightness?: number;
  fogDensity?: number;
  generations?: readonly GenerationId[];
}

export interface MaterialCommand {
  id: string;
  color?: Color;
  colorFactor?: readonly [number, number, number, number];
  baseColorTexture?: string;
  topColorTexture?: string;
  normalTexture?: string;
  emissiveTexture?: string;
  filter?: 'nearest' | 'linear';
  blendMode?: 'opaque' | 'alpha' | 'additive';
  uvMode?: 'perspective' | 'affine';
  castShadow?: boolean;
  receiveShadow?: boolean;
  uvScale?: number;
  alphaCutoff?: number;
  ambient?: number;
  diffuse?: number;
  polygonSort?: boolean;
  floatAmplitude?: number;
  uvScrollY?: number;
  generations?: readonly GenerationId[];
}

export interface OverlayCommand {
  kind: 'text' | 'rect';
  position: Vec2;
  size?: Vec2;
  text?: string;
  color: Color;
  align?: CanvasTextAlign;
  font?: string;
}

export interface RenderFrame {
  timeSeconds: number;
  camera: CameraCommand;
  readonly meshes: MeshCommand[];
  readonly skinnedMeshes: SkinnedMeshCommand[];
  readonly sprites: SpriteCommand[];
  readonly lights: LightCommand[];
  readonly backgrounds: BackgroundCommand[];
  readonly overlays: OverlayCommand[];
  readonly materials: MaterialCommand[];
  reset(): void;
}

const DEFAULT_CAMERA: CameraCommand = {
  projection: 'orthographic',
  position: [0, 20, 0],
  target: [0, 0, 0],
  zoom: 16,
};

export function createRenderFrame(): RenderFrame {
  const frame: RenderFrame = {
    timeSeconds: 0,
    camera: { ...DEFAULT_CAMERA },
    meshes: [],
    skinnedMeshes: [],
    sprites: [],
    lights: [],
    backgrounds: [],
    overlays: [],
    materials: [],
    reset(): void {
      frame.timeSeconds = 0;
      frame.camera = { ...DEFAULT_CAMERA };
      frame.meshes.length = 0;
      frame.skinnedMeshes.length = 0;
      frame.sprites.length = 0;
      frame.lights.length = 0;
      frame.backgrounds.length = 0;
      frame.overlays.length = 0;
      frame.materials.length = 0;
    },
  };
  return frame;
}
