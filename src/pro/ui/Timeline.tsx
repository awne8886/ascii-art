import { useRef, useState } from 'react';
import { timecode, useClock, type Clock } from '../clock';
import { layerMediaDuration } from '../frames';
import { type MediaStore } from '../media';
import { type Layer } from '../model';
import { updateLayer, type Studio } from '../store';
import { Icon } from './icons';

interface Props {
  studio: Studio;
  clock: Clock;
  media: MediaStore;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
}

/** Transport bar, and (expanded) one track per layer with draggable, trimmable clips. */
export function Timeline({ studio, clock, media, soundOn, setSoundOn }: Props) {
  const { time, playing } = useClock(clock);
  const [open, setOpen] = useState(false);
  const project = studio.project;
  const { duration, fps, loop } = project.canvas;
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFrom = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    clock.seek(Math.min(duration - 1e-4, Math.round(f * duration * fps) / fps));
  };
  const scrubProps = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      seekFrom(e.clientX, e.currentTarget);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons & 1) seekFrom(e.clientX, e.currentTarget);
    },
  };
  const pct = (t: number) => `${(Math.max(0, Math.min(duration, t)) / duration) * 100}%`;
  const layers = [...project.layers].reverse();

  return (
    <div className={`timeline${open ? ' timeline--open' : ''}`}>
      {open && (
        <div className="tracks">
          <div className="tracks__ruler">
            <span className="tracks__name tracks__name--head">
              Timeline
              <button type="button" className="pbtn pbtn--small" onClick={() => setOpen(false)}>
                Fit
              </button>
            </span>
            <div className="tracks__lane tracks__lane--ruler" {...scrubProps}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="tracks__tick" style={{ left: `${(i / 8) * 100}%` }}>
                  {timecode((duration * i) / 8, fps)}
                </span>
              ))}
              <span className="tracks__head" style={{ left: pct(time) }} />
            </div>
          </div>
          <div className="tracks__rows">
            {layers.map((l) => (
              <Track key={l.id} layer={l} studio={studio} media={media} duration={duration} fps={fps} time={time} />
            ))}
            {layers.length === 0 && <p className="muted small pad">Add a picture or a video to see it here.</p>}
          </div>
        </div>
      )}
      <div className="transport">
        <button
          type="button"
          className="transport__play"
          onClick={() => clock.toggle()}
          aria-label={playing ? 'Pause (space)' : 'Play (space)'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <span className="transport__time dots-num">{timecode(time, fps)}</span>
        <div className="transport__track" ref={trackRef} {...scrubProps}>
          {project.layers.map((l, i) => (
            <span
              key={l.id}
              className={`transport__clip transport__clip--${l.kind}${l.id === studio.state.selected ? ' transport__clip--sel' : ''}`}
              style={{
                left: pct(l.start),
                width: `calc(${pct(l.start + l.length)} - ${pct(l.start)})`,
                top: `${8 + (i % 4) * 5}px`,
              }}
            />
          ))}
          <span className="transport__head" style={{ left: pct(time) }} />
        </div>
        <button
          type="button"
          className={`transport__btn${soundOn ? ' transport__btn--on' : ''}`}
          onClick={() => setSoundOn(!soundOn)}
          aria-label={soundOn ? 'Mute the preview' : 'Play sound in the preview'}
          title={soundOn ? 'Preview sound on' : 'Preview sound off'}
        >
          <Icon name={soundOn ? 'sound' : 'mute'} size={16} />
        </button>
        <span className="transport__time transport__time--dur dots-num" title="Timeline length">
          {timecode(duration, fps)}
        </span>
        <button
          type="button"
          className={`transport__btn${loop ? ' transport__btn--on' : ''}`}
          onClick={() => studio.commit((p) => ({ ...p, canvas: { ...p.canvas, loop: !p.canvas.loop } }))}
          aria-label="Loop"
          title={loop ? 'Looping' : 'Plays once'}
        >
          <Icon name="loop" size={16} />
        </button>
        <button
          type="button"
          className="pbtn transport__expand"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Icon name={open ? 'chevronDown' : 'chevronUp'} size={14} /> Timeline
        </button>
      </div>
    </div>
  );
}

function Track({
  layer,
  studio,
  media,
  duration,
  fps,
  time,
}: {
  layer: Layer;
  studio: Studio;
  media: MediaStore;
  duration: number;
  fps: number;
  time: number;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'start' | 'end'; x0: number; start: number; length: number; in: number } | null>(
    null,
  );
  const mediaDur = layerMediaDuration(layer, media);
  const sel = layer.id === studio.state.selected;

  const down = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode = (e.currentTarget.dataset.mode ?? 'move') as 'move' | 'start' | 'end';
    drag.current = { mode, x0: e.clientX, start: layer.start, length: layer.length, in: layer.in };
    studio.select(layer.id);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = lane.current;
    if (!d || !el) return;
    const dt = ((e.clientX - d.x0) / el.getBoundingClientRect().width) * duration;
    const snap = (t: number) => Math.round(t * fps) / fps;
    let patch: Partial<Layer>;
    if (d.mode === 'move') patch = { start: snap(Math.max(0, Math.min(duration - 0.05, d.start + dt))) };
    else if (d.mode === 'end') patch = { length: snap(Math.max(1 / fps, d.length + dt)) };
    else {
      const start = snap(Math.max(0, Math.min(d.start + d.length - 1 / fps, d.start + dt)));
      const shift = start - d.start;
      patch = { start, length: d.length - shift };
      // Trimming a clip's head also moves where its media starts.
      if (mediaDur) patch.in = Math.max(0, Math.min(mediaDur - 0.05, d.in + shift * layer.speed));
    }
    studio.commit(updateLayer(layer.id, patch), `clip:${layer.id}`);
  };
  const up = () => (drag.current = null);

  return (
    <div className={`tracks__row${sel ? ' tracks__row--sel' : ''}`}>
      <button type="button" className="tracks__name" onClick={() => studio.select(layer.id)}>
        <span className={`tracks__dot tracks__dot--${layer.kind}`} />
        {layer.name}
      </button>
      <div className="tracks__lane" ref={lane} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div
          className={`tracks__clip tracks__clip--${layer.kind}${layer.visible ? '' : ' tracks__clip--hidden'}`}
          style={{
            left: `${(layer.start / duration) * 100}%`,
            width: `${(Math.min(layer.length, duration - layer.start) / duration) * 100}%`,
          }}
          data-mode="move"
          onPointerDown={down}
          title={`${layer.start.toFixed(2)} s → ${(layer.start + layer.length).toFixed(2)} s`}
        >
          <span className="tracks__trim tracks__trim--l" data-mode="start" onPointerDown={down} />
          <span className="tracks__label">{layer.name}</span>
          {layer.motion.length > 0 && <span className="tracks__badge">{layer.motion.length} motion</span>}
          {layer.effects.length > 0 && <span className="tracks__badge">{layer.effects.length} look</span>}
          <span className="tracks__trim tracks__trim--r" data-mode="end" onPointerDown={down} />
        </div>
        <span className="tracks__head" style={{ left: `${(Math.min(time, duration) / duration) * 100}%` }} />
      </div>
    </div>
  );
}
