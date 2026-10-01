import { type SegmentMethod } from '../settings';

export interface SegmentRequest {
  id: number;
  method: SegmentMethod;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /**
   * A waiting request is dropped once a newer one arrives in the same lane
   * (newest wins); null never drops, for work that needs every result.
   */
  lane: string | null;
}

/** Requests their caller gave up on: the worker doesn't run them if they haven't started (nor download for them). */
export interface SegmentCancel {
  type: 'cancel';
  ids: number[];
}

/** What the worker is sent. */
export type SegmentMessage = SegmentRequest | SegmentCancel;

/** The error a request dropped for a newer one in its lane fails with. */
export const SUPERSEDED = 'Superseded by a newer request.';

export type SegmentPhase = 'download' | 'init' | 'infer' | 'refine';

export type SegmentResponse =
  | { type: 'progress'; id: number; phase: SegmentPhase; loaded?: number; total?: number }
  | { type: 'result'; id: number; width: number; height: number; mask: Float32Array; backend: string; ms: number }
  | { type: 'error'; id: number; message: string };
