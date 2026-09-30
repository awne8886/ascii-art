import { useSyncExternalStore } from 'react';

/**
 * The playhead. Lives outside React state so the render loop can move it
 * every frame; small components (time readouts, the playhead, selection
 * handles) subscribe to it.
 */
export class Clock {
  time = 0;
  playing = false;
  private listeners = new Set<() => void>();
  private snap = { time: 0, playing: false };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): { time: number; playing: boolean } => this.snap;

  private emit(): void {
    this.snap = { time: this.time, playing: this.playing };
    this.listeners.forEach((fn) => fn());
  }

  seek(t: number): void {
    this.time = Math.max(0, t);
    this.emit();
  }

  play(): void {
    this.playing = true;
    this.emit();
  }

  pause(): void {
    this.playing = false;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
}

export function useClock(clock: Clock): { time: number; playing: boolean } {
  return useSyncExternalStore(clock.subscribe, clock.snapshot);
}

/** m:ss:ff, like a video editor. */
export function timecode(t: number, fps: number): string {
  const total = Math.max(0, Math.round(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
