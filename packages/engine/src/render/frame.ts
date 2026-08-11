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
}

export type GeometryCommand =
  | { kind: 'box' }
  | { kind: 'circle'; radius: number }
  | { kind: 'polygon'; points: readonly Vec2[] }
  | { kind: 'polyline'; points: readonly Vec2[]; width: number; closed?: boolean };

export interface MeshCommand {
  id: string;
  geometry: GeometryCommand;
  transform: TransformCommand;
  color: Color;
  stroke?: Color;
  layer?: number;
}

export interface SpriteCommand {
  id: string;
  position: Vec3;
  size: Vec2;
  color: Color;
  rotation?: number;
  layer?: number;
}

export interface LightCommand {
  id: string;
  position: Vec3;
  color: Color;
  intensity: number;
  radius: number;
}

export interface BackgroundCommand {
  color: Color;
  secondaryColor?: Color;
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
  camera: CameraCommand;
  readonly meshes: MeshCommand[];
  readonly sprites: SpriteCommand[];
  readonly lights: LightCommand[];
  readonly backgrounds: BackgroundCommand[];
  readonly overlays: OverlayCommand[];
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
    camera: { ...DEFAULT_CAMERA },
    meshes: [],
    sprites: [],
    lights: [],
    backgrounds: [],
    overlays: [],
    reset(): void {
      frame.camera = { ...DEFAULT_CAMERA };
      frame.meshes.length = 0;
      frame.sprites.length = 0;
      frame.lights.length = 0;
      frame.backgrounds.length = 0;
      frame.overlays.length = 0;
    },
  };
  return frame;
}

