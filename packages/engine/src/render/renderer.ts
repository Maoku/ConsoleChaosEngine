import { quat, vec3 } from 'gl-matrix';
import type { GenerationController } from '../generation/controller';
import { HARDWARE_GENERATION_PROFILES, type HardwareGenerationProfile } from '../generation/profiles';
import type { GeometryCommand, MeshCommand, RenderFrame, Vec2, Vec3 } from './frame';
import { applyCameraCommand, createCamera, projectCameraPoint } from './camera';

export interface FrameRenderer {
  render(frame: RenderFrame, profile: HardwareGenerationProfile, generation: GenerationController): void;
  resize(): void;
  dispose(): void;
}

function hexToRgb(color: string): readonly [number, number, number] | null {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  return match ? [Number.parseInt(match[1] ?? '0', 16), Number.parseInt(match[2] ?? '0', 16), Number.parseInt(match[3] ?? '0', 16)] : null;
}

function applyRgb555(context: CanvasRenderingContext2D, width: number, height: number): void {
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = (pixels.data[index] ?? 0) & 0xf8;
    pixels.data[index + 1] = (pixels.data[index + 1] ?? 0) & 0xf8;
    pixels.data[index + 2] = (pixels.data[index + 2] ?? 0) & 0xf8;
  }
  context.putImageData(pixels, 0, 0);
}

function fixedPaletteColor(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  const levels = [0, 85, 170, 255];
  const nearest = (value: number): number => levels.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, 0);
  return `rgb(${nearest(rgb[0])} ${nearest(rgb[1])} ${nearest(rgb[2])})`;
}

export function createCanvasCommandRenderer(canvas: HTMLCanvasElement): FrameRenderer {
  const internal = document.createElement('canvas');
  const output = canvas.getContext('2d', { alpha: false });
  const context = internal.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!output || !context) throw new Error('Canvas 2D is unavailable');
  const camera = createCamera();
  const meshRotation = quat.create();
  const meshPoint = vec3.create();

  const project = (point: Vec3): Vec2 | null =>
    projectCameraPoint(camera, point, internal.width, internal.height) as Vec2 | null;

  const pathGeometry = (geometry: GeometryCommand, mesh: MeshCommand, frame: RenderFrame): boolean => {
    const position = mesh.transform.position;
    const scale = mesh.transform.scale ?? [1, 1, 1];
    if (mesh.transform.rotation) {
      quat.set(meshRotation, ...mesh.transform.rotation);
      if (quat.squaredLength(meshRotation) < 1e-12) quat.identity(meshRotation);
      else quat.normalize(meshRotation, meshRotation);
    } else {
      quat.setAxisAngle(meshRotation, [0, 1, 0], mesh.transform.rotationY ?? 0);
    }
    const transform = (point: Vec2): Vec3 => {
      vec3.set(meshPoint, point[0] * scale[0], 0, point[1] * scale[2]);
      vec3.transformQuat(meshPoint, meshPoint, meshRotation);
      return [position[0] + meshPoint[0], position[1] + meshPoint[1], position[2] + meshPoint[2]];
    };
    const points = geometry.kind === 'polygon' || geometry.kind === 'polyline'
      ? geometry.points
      : geometry.kind === 'box'
        ? (() => {
            const half = geometry.halfExtents ?? [0.5, 0.5, 0.5];
            return [[-half[0], -half[2]], [half[0], -half[2]], [half[0], half[2]], [-half[0], half[2]]] satisfies Vec2[];
          })()
        : geometry.kind === 'quad'
          ? [[-geometry.halfSize[0], -geometry.halfSize[1]], [geometry.halfSize[0], -geometry.halfSize[1]], [geometry.halfSize[0], geometry.halfSize[1]], [-geometry.halfSize[0], geometry.halfSize[1]]] satisfies Vec2[]
        : [];
    if (geometry.kind === 'circle') {
      context.beginPath();
      const center = project(position);
      const edge = project([position[0] + geometry.radius * scale[0], position[1], position[2]]);
      if (!center || !edge) return false;
      context.arc(center[0], center[1], Math.abs(edge[0] - center[0]), 0, Math.PI * 2);
      return true;
    }
    const screens = points.map((point) => project(transform(point)));
    context.beginPath();
    if (screens.some((screen) => screen === null)) return false;
    screens.forEach((screen, index) => {
      if (!screen) return;
      if (index === 0) context.moveTo(...screen);
      else context.lineTo(...screen);
    });
    if (geometry.kind !== 'polyline' || geometry.closed) context.closePath();
    if (geometry.kind === 'polyline') context.lineWidth = Math.max(geometry.width * Math.min(internal.width, internal.height) / frame.camera.zoom, 1);
    return true;
  };

  return {
    render(frame, profile, generation): void {
      if (internal.width !== profile.video.internalWidth || internal.height !== profile.video.internalHeight) {
        internal.width = profile.video.internalWidth;
        internal.height = profile.video.internalHeight;
      }
      applyCameraCommand(camera, frame.camera, internal.width / internal.height);
      const palette = profile.video.paletteMode === 'fixed54' ? fixedPaletteColor : (color: string) => color;
      // Textured/parallax layers are optional decorations. The untextured layer
      // remains the clear-color authority even when a backend cannot sample them.
      const visibleInGeneration = (candidate: { generations?: readonly string[] }): boolean =>
        candidate.generations === undefined || candidate.generations.includes(profile.id);
      const generationBackgrounds = frame.backgrounds.filter(visibleInGeneration);
      const background = generationBackgrounds.find((candidate) => !candidate.texture) ?? generationBackgrounds.at(0);
      if (background?.secondaryColor) {
        const gradient = context.createLinearGradient(0, 0, 0, internal.height);
        gradient.addColorStop(0, palette(background.secondaryColor));
        gradient.addColorStop(1, palette(background.color));
        context.fillStyle = gradient;
      } else {
        context.fillStyle = palette(background?.color ?? '#101018');
      }
      context.fillRect(0, 0, internal.width, internal.height);
      context.lineJoin = profile.video.affineTexture ? 'bevel' : 'round';

      for (const mesh of frame.meshes.filter(visibleInGeneration).sort((left, right) => (left.layer ?? 0) - (right.layer ?? 0))) {
        if (mesh.visible === false) continue;
        if (!pathGeometry(mesh.geometry, mesh, frame)) continue;
        context.fillStyle = palette(mesh.color);
        if (!mesh.wireframe && mesh.geometry.kind !== 'polyline') context.fill();
        if (mesh.wireframe || mesh.stroke || mesh.geometry.kind === 'polyline') {
          context.strokeStyle = palette(mesh.stroke ?? mesh.color);
          context.stroke();
        }
      }

      for (const sprite of frame.sprites.filter(visibleInGeneration).sort((left, right) => (left.layer ?? 0) - (right.layer ?? 0))) {
        if (sprite.visible === false) continue;
        const center = sprite.screenSpace ? [sprite.position[0], sprite.position[1]] as Vec2 : project(sprite.position);
        if (!center) continue;
        const scale = sprite.screenSpace ? 1 : Math.min(internal.width, internal.height) / frame.camera.zoom;
        context.save();
        context.translate(...center);
        context.rotate(sprite.rotation ?? 0);
        context.fillStyle = palette(sprite.color);
        context.fillRect(-sprite.size[0] * scale / 2, -sprite.size[1] * scale / 2, sprite.size[0] * scale, sprite.size[1] * scale);
        context.restore();
      }

      for (const overlay of frame.overlays) {
        context.fillStyle = palette(overlay.color);
        if (overlay.kind === 'rect') {
          context.fillRect(overlay.position[0], overlay.position[1], overlay.size?.[0] ?? 0, overlay.size?.[1] ?? 0);
        } else {
          context.font = overlay.font ?? '12px monospace';
          context.textAlign = overlay.align ?? 'left';
          context.textBaseline = 'top';
          context.fillText(overlay.text ?? '', overlay.position[0], overlay.position[1]);
        }
      }

      if (profile.video.paletteMode === 'rgb555') applyRgb555(context, internal.width, internal.height);
      if (generation.transition.active) {
        context.fillStyle = `rgba(255,255,255,${Math.sin(generation.transition.blend * Math.PI) * 0.16})`;
        context.fillRect(0, 0, internal.width, internal.height);
      }
      if (profile.video.signal !== 'component') {
        context.fillStyle = profile.video.signal === 'rf' ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.1)';
        for (let y = 1; y < internal.height; y += 2) context.fillRect(0, y, internal.width, 1);
      }

      const width = Math.max(canvas.clientWidth || canvas.width, 1);
      const height = Math.max(canvas.clientHeight || canvas.height, 1);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      output.imageSmoothingEnabled = profile.video.textureFilter === 'linear';
      output.clearRect(0, 0, canvas.width, canvas.height);
      const ratio = Math.min(canvas.width / internal.width, canvas.height / internal.height);
      const drawWidth = internal.width * ratio;
      const drawHeight = internal.height * ratio;
      output.drawImage(internal, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    },
    resize(): void {
      canvas.width = Math.max(canvas.clientWidth, 1);
      canvas.height = Math.max(canvas.clientHeight, 1);
    },
    dispose(): void {
      internal.width = 1;
      internal.height = 1;
    },
  };
}

export interface GenerationRendererStats {
  readonly allocatedTargets: number;
  readonly renderedGenerations: number;
}

/**
 * Preallocates one render target per hardware generation and composites exactly
 * one target normally or two while a transition is active.
 */
export function createGenerationCanvasRenderer(canvas: HTMLCanvasElement): FrameRenderer & GenerationRendererStats {
  const output = canvas.getContext('2d', { alpha: false });
  if (!output) throw new Error('Canvas 2D is unavailable');
  const targets = new Map<string, { canvas: HTMLCanvasElement; renderer: FrameRenderer }>();
  for (const [generation, profile] of Object.entries(HARDWARE_GENERATION_PROFILES)) {
    const target = document.createElement('canvas');
    target.width = profile.video.internalWidth;
    target.height = profile.video.internalHeight;
    targets.set(generation, { canvas: target, renderer: createCanvasCommandRenderer(target) });
  }
  let renderedGenerations = 0;

  return {
    get allocatedTargets() {
      return targets.size;
    },
    get renderedGenerations() {
      return renderedGenerations;
    },
    render(frame, _profile, generation): void {
      const renderIds = generation.renderGenerations();
      renderedGenerations = renderIds.length;
      const width = Math.max(canvas.clientWidth || canvas.width, 1);
      const height = Math.max(canvas.clientHeight || canvas.height, 1);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      output.clearRect(0, 0, width, height);
      renderIds.forEach((id, index) => {
        const target = targets.get(id);
        if (!target) return;
        target.renderer.render(frame, HARDWARE_GENERATION_PROFILES[id], generation);
        output.save();
        output.globalAlpha = renderIds.length === 1
          ? 1
          : index === 0 ? 1 - generation.transition.blend : generation.transition.blend;
        output.drawImage(target.canvas, 0, 0, width, height);
        output.restore();
      });
    },
    resize(): void {
      canvas.width = Math.max(canvas.clientWidth || canvas.width, 1);
      canvas.height = Math.max(canvas.clientHeight || canvas.height, 1);
    },
    dispose(): void {
      for (const target of targets.values()) target.renderer.dispose();
      targets.clear();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
