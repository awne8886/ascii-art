import { type Layer, type Project } from '../model';

/**
 * The contract between subject analysis (`subject/`), the renderer and the
 * studio's panels. Masks never go into the project (they can be tens of MB):
 * a `SubjectStore` keeps them per layer, in memory and in IndexedDB.
 */

/** One mask: subject coverage (0–255) over a rectangle of a layer's picture. */
export interface MaskFrame {
  width: number;
  height: number;
  /** width × height bytes, top row first, 255 = subject. */
  data: Uint8Array;
  /** Where it sits in the layer's uv (0–1, y down): x, y, width, height. The whole frame is [0, 0, 1, 1]. */
  rect: [number, number, number, number];
  /** Changes whenever the bytes do (the renderer uploads a mask only when its version changes). */
  version: string;
}

/**
 * A layer's subject at one moment, ready to draw (threshold, softness,
 * grow / shrink, steadiness and invert already applied): two masks and how
 * far between them, since a video's analysed masks are blended in time.
 */
export interface LayerMask {
  a: MaskFrame;
  b: MaskFrame;
  /** 0 shows a, 1 shows b. */
  mix: number;
  /** Subject value outside the masks' rectangles, 0–1 (1 when subject and background are swapped). */
  outside: number;
}

/** Where the renderer gets subject masks from. */
export interface MaskSource {
  /** Bumped whenever any mask, or anything that changes how one is drawn, changes (the paused preview redraws). */
  readonly version: number;
  /**
   * The layer's subject at timeline time t, or null when it has none to show:
   * separation off, not analysed yet, or analysed for other media.
   */
  maskAt(layer: Layer, project: Project, t: number): LayerMask | null;
}

export type SubjectStatus =
  /** Separation on but nothing analysed yet. */
  | 'none'
  | 'running'
  | 'ready'
  /** Analysed, but with other analysis settings (method, area, rate, track, or a range the layer no longer covers): still drawn, analyse again. */
  | 'stale'
  /** The webcam: separated live, frame by frame. */
  | 'live'
  | 'error';

export interface SubjectJob {
  phase: 'download' | 'init' | 'analyse';
  /** 0–1 over the whole job. */
  progress: number;
  /** Model download bytes (phase 'download'). */
  loaded?: number;
  total?: number;
  /** Masks done / to do (phase 'analyse'). */
  done?: number;
  count?: number;
}

export interface SubjectInfo {
  status: SubjectStatus;
  /** Masks held for the layer. */
  frames: number;
  /** Media seconds the masks cover. */
  from: number;
  to: number;
  /** 'wasm', 'webgpu' or 'js' (classic), once analysed. */
  backend?: string;
  /** How long the last analysis took. */
  ms?: number;
  error?: string;
  job?: SubjectJob;
}
