import { type SoftMask } from './segment/refine';

/** A picture ready for the engine: a capped-size copy for drawing, and a smaller RGBA copy for segmentation. */
export interface SourceImage {
  name: string;
  /** Drawn from (sampling, photo layer); at most MAX_SIDE on its longer side. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Working copy for segmentation, at most WORK_SIDE on its longer side. */
  work: { rgba: Uint8ClampedArray; width: number; height: number };
  /** Some pixels are transparent (a cut-out PNG): that transparency is the subject mask. */
  hasAlpha: boolean;
}

const MAX_SIDE = 2048;
const WORK_SIDE = 1024;

function scaled(w: number, h: number, max: number): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function draw(source: CanvasImageSource, sw: number, sh: number, max: number): HTMLCanvasElement {
  const [w, h] = scaled(sw, sh, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

export function fromSource(source: CanvasImageSource, width: number, height: number, name: string): SourceImage {
  const canvas = draw(source, width, height, MAX_SIDE);
  const workCanvas = draw(canvas, canvas.width, canvas.height, WORK_SIDE);
  const rgba = workCanvas.getContext('2d')!.getImageData(0, 0, workCanvas.width, workCanvas.height).data;
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 250) transparent++;
  return {
    name,
    canvas,
    width: canvas.width,
    height: canvas.height,
    work: { rgba, width: workCanvas.width, height: workCanvas.height },
    hasAlpha: transparent > (rgba.length / 4) * 0.01,
  };
}

export async function loadImageFile(file: Blob, name: string): Promise<SourceImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers can't decode everything via createImageBitmap (e.g. SVG): try an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return fromSource(img, img.naturalWidth || 1024, img.naturalHeight || 1024, name);
    } catch {
      throw new Error(`Couldn't read “${name}”. Try a JPEG, PNG, WebP or GIF.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    return fromSource(bitmap, bitmap.width, bitmap.height, name);
  } finally {
    bitmap.close();
  }
}

/** The picture's own alpha channel as a subject mask. */
export function alphaMask(image: SourceImage): SoftMask {
  const { rgba, width, height } = image.work;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3]! / 255;
  return { width, height, data };
}
