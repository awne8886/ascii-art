/**
 * Which queued segmentation requests are still worth running. The worker
 * runs one request at a time; a request in a lane is dropped once a newer
 * request in the same lane has arrived (only the newest picture matters to
 * the classic site, or to one webcam), while requests without a lane (a
 * clip analysed frame by frame) always run.
 */
export class Lanes {
  private newest = new Map<string, number>();

  /** Note a request as it arrives (ids increase). */
  arrive(lane: string | null, id: number): void {
    if (lane === null) return;
    this.newest.set(lane, Math.max(this.newest.get(lane) ?? 0, id));
  }

  /** Whether a waiting request has been overtaken by a newer one in its lane. */
  superseded(lane: string | null, id: number): boolean {
    return lane !== null && id < (this.newest.get(lane) ?? 0);
  }
}
