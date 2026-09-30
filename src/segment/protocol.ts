import { type SegmentMethod } from '../settings';

export interface SegmentRequest {
  id: number;
  method: SegmentMethod;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export type SegmentPhase = 'download' | 'init' | 'infer' | 'refine';

export type SegmentResponse =
  | { type: 'progress'; id: number; phase: SegmentPhase; loaded?: number; total?: number }
  | { type: 'result'; id: number; width: number; height: number; mask: Float32Array; backend: string; ms: number }
  | { type: 'error'; id: number; message: string };
