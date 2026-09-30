import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useClock, type Clock } from '../clock';
import { type DrawnCache, layerSize, previewFrame, soundLevel, syncVideos, videoClock } from '../frames';
import { apply3, hitUv, invert3, placedQuad, quadPoint, squareToQuad, type Point } from '../geometry';
import { ProRenderer } from '../gl/renderer';
import { type MediaStore } from '../media';
import { layerActive, mediaTime, trackAt, type Layer, type Project } from '../model';
import { updateLayer, type Studio } from '../store';
import { Icon } from './icons';
import { type SceneOptions } from './panels';

export type Zoom = 'fit' | number;

interface Props {
  studio: Studio;
  media: MediaStore;
  clock: Clock;
  drawn: DrawnCache;
  zoom: Zoom;
  setZoom: (z: Zoom) => void;
  soundOn: boolean;
  scene: SceneOptions;
  /** Floating controls (the dock), drawn over the stage. */
  dock: ReactNode;
  empty: ReactNode;
  onError: (msg: string) => void;
  /** Drawing the box around an object to track on the selected layer. */
  picking: boolean;
  onPicked: (box: [number, number, number, number] | null) => void;
}

const PAD = 40;
const DOCK_SPACE = 118;

/** The canvas, its live preview, and direct manipulation of the selected layer. */
export function Viewport({
  studio,
  media,
  clock,
  drawn,
  zoom,
  setZoom,
  soundOn,
  scene,
  dock,
  empty,
  onError,
  picking,
  onPicked,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<[number, number]>([800, 600]);
  const [lost, setLost] = useState<string | null>(null);
  const project = studio.project;
  const cw = project.canvas.width;
  const ch = project.canvas.height;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setBox([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.02, Math.min((box[0] - PAD * 2) / cw, (box[1] - PAD - DOCK_SPACE) / ch));
  const scale = zoom === 'fit' ? fit : zoom;
  const dispW = Math.round(cw * scale);
  const dispH = Math.round(ch * scale);
  const stageW = Math.max(box[0], dispW + PAD * 2);
  const stageH = Math.max(box[1], dispH + PAD + DOCK_SPACE);
  const left = Math.round((stageW - dispW) / 2);
  const top = Math.round(Math.max(PAD, (stageH - DOCK_SPACE - dispH) / 2 + 10));

  // Everything the render loop needs, always current.
  const live = useRef({ project, soundOn, scene, dispW, dispH, version: 0 });
  useEffect(() => {
    live.current = { project, soundOn, scene, dispW, dispH, version: live.current.version + 1 };
  }, [project, soundOn, scene, dispW, dispH]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ProRenderer;
    try {
      renderer = new ProRenderer(canvas);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setLost(msg));
      return;
    }
    let raf = 0;
    let last = 0;
    let sig = '';
    const onLost = (e: Event) => {
      e.preventDefault();
      setLost('The graphics context was lost. Reload the page to continue.');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      const s = live.current;
      const p = s.project;
      const d = Math.max(0.05, p.canvas.duration);
      if (clock.playing) {
        let t = videoClock(p, clock.time, media) ?? clock.time + dt;
        if (t >= d) {
          if (p.canvas.loop) t %= d;
          else {
            t = d - 1e-4;
            clock.pause();
          }
        }
        clock.seek(t);
      } else if (clock.time > d) clock.seek(d - 1e-4);
      const t = clock.time;
      syncVideos(p, t, clock.playing, media, s.soundOn);
      const liveCam = p.layers.some((l) => l.kind === 'webcam' && layerActive(l, t));
      const seqs = p.layers.map((l) => media.get(l.mediaId)?.seq ?? 0).join(',');
      const next = `${t}|${s.dispW}x${s.dispH}|${seqs}|${s.version}`;
      if (!clock.playing && !liveCam && next === sig) return;
      sig = next;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let k = Math.min(1, (s.dispW * dpr) / p.canvas.width);
      if (s.scene.quality === 'draft') k *= 0.5;
      else if (s.scene.quality === 'auto') k = Math.min(k, 2560 / Math.max(p.canvas.width, p.canvas.height));
      const w = Math.max(2, Math.round(p.canvas.width * k));
      const h = Math.max(2, Math.round(p.canvas.height * k));
      try {
        renderer.render({
          project: p,
          time: t,
          frame: Math.round(t * p.canvas.fps),
          width: w,
          height: h,
          frameOf: (l) => previewFrame(l, p, t, media, drawn, clock.playing),
          sound: (l) => soundLevel(p, l, t, media),
        });
      } catch (e) {
        console.error(e);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      renderer.dispose();
    };
  }, [clock, media, drawn]);

  // Ctrl/⌘ + wheel zooms.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.max(0.05, Math.min(4, scale * Math.exp(-e.deltaY * 0.0015)));
      setZoom(next);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, setZoom]);

  const transparent = project.canvas.background === 'transparent';

  return (
    <div className="viewport-frame">
      <div className="viewport" ref={wrapRef}>
        <div className="viewport__stage" style={{ width: stageW, height: stageH }}>
          <div className="viewport__chips" style={{ left, top: top - 30 }}>
            <span className="vchip">{aspectLabel(cw, ch)}</span>
            <span className="vchip">{project.canvas.fps} fps</span>
          </div>
          <canvas
            ref={canvasRef}
            className={`viewport__canvas${transparent ? ' viewport__canvas--clear' : ''}`}
            style={{ left, top, width: dispW, height: dispH }}
            aria-label="Canvas preview"
            role="img"
          />
          <Interaction
            studio={studio}
            media={media}
            clock={clock}
            drawn={drawn}
            scale={scale}
            left={left}
            top={top}
            scene={scene}
            width={dispW}
            height={dispH}
            picking={picking}
            onPicked={onPicked}
          />
          {picking && (
            <div className="pickhint" style={{ left, top: top + 8, width: dispW }}>
              Drag a box around what to follow · Esc to cancel
            </div>
          )}
          {project.layers.length === 0 && (
            <div className="viewport__empty" style={{ left, top, width: dispW, height: dispH }}>
              {empty}
            </div>
          )}
          {lost && (
            <div className="viewport__error" style={{ left, top, width: dispW, height: dispH }} role="alert">
              <p>{lost}</p>
              <button type="button" className="pbtn" onClick={() => location.reload()}>
                Save and refresh
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="viewport__dock">{dock}</div>
      <div className="zoom">
        <button
          type="button"
          className="zoom__btn"
          onClick={() => setZoom(Math.max(0.05, scale / 1.25))}
          aria-label="Zoom out"
        >
          <Icon name="minus" size={14} />
        </button>
        <button
          type="button"
          className={`zoom__value${zoom === 'fit' ? ' zoom__value--fit' : ''}`}
          onClick={() => setZoom('fit')}
          title="Fit to the window"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className="zoom__btn"
          onClick={() => setZoom(Math.min(4, scale * 1.25))}
          aria-label="Zoom in"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ErrorBridge onError={onError} message={lost} />
    </div>
  );
}

function ErrorBridge({ onError, message }: { onError: (m: string) => void; message: string | null }) {
  useEffect(() => {
    if (message) onError(message);
  }, [message, onError]);
  return null;
}

function aspectLabel(w: number, h: number): string {
  const r = w / h;
  const known: [number, string][] = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [1, '1:1'],
    [4 / 5, '4:5'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [21 / 9, '21:9'],
    [3 / 2, '3:2'],
    [2 / 3, '2:3'],
  ];
  const hit = known.find(([k]) => Math.abs(k - r) < 0.012);
  return hit ? hit[1] : `${w}×${h}`;
}

type Drag =
  | { kind: 'move'; id: string; x0: number; y0: number; lx: number; ly: number }
  | { kind: 'scale'; id: string; cx: number; cy: number; d0: number; s0: number }
  | { kind: 'rotate'; id: string; cx: number; cy: number; a0: number; r0: number };

/** Selection frame + handles, and pointer interaction on the canvas. */
function Interaction({
  studio,
  media,
  clock,
  drawn,
  scale,
  left,
  top,
  width,
  height,
  scene,
  picking,
  onPicked,
}: {
  studio: Studio;
  media: MediaStore;
  clock: Clock;
  drawn: DrawnCache;
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scene: SceneOptions;
  picking: boolean;
  onPicked: (box: [number, number, number, number] | null) => void;
}) {
  const { time } = useClock(clock);
  const project = studio.project;
  const drag = useRef<Drag | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const quadOf = useCallback(
    (l: Layer, p: Project): [Point, Point, Point, Point] | null =>
      placedQuad(p, l, clock.time, (x) => layerSize(x, p, media, drawn))?.quad ?? null,
    [media, drawn, clock],
  );

  useEffect(() => {
    if (!picking) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onPicked(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picking, onPicked]);

  const toCanvas = (e: { clientX: number; clientY: number }): Point => {
    const r = layerRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - left) / scale, (e.clientY - r.top - top) / scale];
  };

  const selected = studio.selectedLayer;
  const quad = selected && layerActive(selected, time) ? quadOf(selected, project) : null;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [x, y] = toCanvas(e);
    if (picking) {
      if (!quad) return;
      setPick({ x0: x, y0: y, x1: x, y1: y });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const handle = (e.target as HTMLElement).dataset.handle;
    if (handle && selected && quad) {
      const cx = (quad[0][0] + quad[2][0]) / 2;
      const cy = (quad[0][1] + quad[2][1]) / 2;
      drag.current =
        handle === 'rot'
          ? { kind: 'rotate', id: selected.id, cx, cy, a0: Math.atan2(y - cy, x - cx), r0: selected.rotation }
          : { kind: 'scale', id: selected.id, cx, cy, d0: Math.hypot(x - cx, y - cy) || 1, s0: selected.scale };
    } else {
      let hit: Layer | null = null;
      for (let i = project.layers.length - 1; i >= 0; i--) {
        const l = project.layers[i]!;
        if (!layerActive(l, clock.time) || l.locked) continue;
        const q = quadOf(l, project);
        if (q && hitUv(q, x, y)) {
          hit = l;
          break;
        }
      }
      if (!hit) {
        studio.select(null);
        return;
      }
      if (hit.id !== studio.state.selected) studio.select(hit.id);
      drag.current = { kind: 'move', id: hit.id, x0: x, y0: y, lx: hit.x, ly: hit.y };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (pick) {
      const [x, y] = toCanvas(e);
      setPick({ ...pick, x1: x, y1: y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const [x, y] = toCanvas(e);
    const key = `drag:${d.id}`;
    if (d.kind === 'move') {
      let nx = d.lx + (x - d.x0) / project.canvas.width;
      let ny = d.ly + (y - d.y0) / project.canvas.height;
      // Snap to the centre lines.
      if (Math.abs(nx) < 0.008) nx = 0;
      if (Math.abs(ny) < 0.008) ny = 0;
      studio.commit(updateLayer(d.id, { x: nx, y: ny }), key);
    } else if (d.kind === 'scale') {
      const s = Math.max(0.02, Math.min(20, (d.s0 * Math.hypot(x - d.cx, y - d.cy)) / d.d0));
      studio.commit(updateLayer(d.id, { scale: s }), key);
    } else {
      let r = d.r0 + ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      studio.commit(updateLayer(d.id, { rotation: r }), key);
    }
  };

  const onUp = () => {
    drag.current = null;
    if (!pick || !quad) return;
    setPick(null);
    // The dragged rectangle, in the layer's own uv.
    const inv = invert3(squareToQuad(quad));
    if (!inv) return;
    const corners = [
      [pick.x0, pick.y0],
      [pick.x1, pick.y0],
      [pick.x1, pick.y1],
      [pick.x0, pick.y1],
    ].map(([cx, cy]) => apply3(inv, cx!, cy!));
    if (corners.some((c) => !c)) return;
    const us = corners.map((c) => Math.max(0, Math.min(1, c![0])));
    const vs = corners.map((c) => Math.max(0, Math.min(1, c![1])));
    let x0 = Math.min(...us);
    let y0 = Math.min(...vs);
    let w = Math.max(...us) - x0;
    let h = Math.max(...vs) - y0;
    // A click (or a tiny drag) picks a box around that spot.
    if (w < 0.02 || h < 0.02) {
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      w = 0.16;
      h = 0.16;
      x0 = Math.max(0, Math.min(1 - w, cx - w / 2));
      y0 = Math.max(0, Math.min(1 - h, cy - h / 2));
    }
    onPicked([x0, y0, w, h]);
  };

  // Where the selected layer's tracked object is now.
  let trackPts: Point[] | null = null;
  let trackConf = 0;
  if (quad && selected?.track) {
    const tr = selected.track;
    const t = trackAt(tr, mediaTime(selected, time, tr.duration) ?? tr.at);
    trackConf = t.conf;
    trackPts = [
      [t.cx - t.w / 2, t.cy - t.h / 2],
      [t.cx + t.w / 2, t.cy - t.h / 2],
      [t.cx + t.w / 2, t.cy + t.h / 2],
      [t.cx - t.w / 2, t.cy + t.h / 2],
    ].map(([u, v]) => {
      const [px, py] = quadPoint(quad, u!, v!);
      return [left + px * scale, top + py * scale] as Point;
    });
  }

  const pts = quad?.map(([x, y]) => [left + x * scale, top + y * scale] as Point);
  let rot: Point | null = null;
  if (pts) {
    const mx = (pts[0]![0] + pts[1]![0]) / 2;
    const my = (pts[0]![1] + pts[1]![1]) / 2;
    const cx = (pts[0]![0] + pts[2]![0]) / 2;
    const cy = (pts[0]![1] + pts[2]![1]) / 2;
    const len = Math.hypot(mx - cx, my - cy) || 1;
    rot = [mx + ((mx - cx) / len) * 26, my + ((my - cy) / len) * 26];
  }

  return (
    <div
      ref={layerRef}
      className={`interaction${picking ? ' interaction--pick' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {scene.guides && (
        <svg
          className="guides"
          style={{ left, top, width, height }}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {[1 / 3, 2 / 3].map((f) => (
            <g key={f}>
              <line x1={width * f} y1={0} x2={width * f} y2={height} />
              <line x1={0} y1={height * f} x2={width} y2={height * f} />
            </g>
          ))}
          <line className="guides__mid" x1={width / 2} y1={0} x2={width / 2} y2={height} />
          <line className="guides__mid" x1={0} y1={height / 2} x2={width} y2={height / 2} />
        </svg>
      )}
      {(scene.handles || picking) && trackPts && !pick && (
        <svg className="trackbox" aria-hidden="true">
          <polygon points={trackPts.map((p) => p.join(',')).join(' ')} />
          <text x={trackPts[0]![0] + 4} y={trackPts[0]![1] - 6}>
            {selected?.track?.data.length ? `TRACK ${trackConf.toFixed(2)}` : 'OBJECT'}
          </text>
        </svg>
      )}
      {pick && (
        <svg className="trackbox trackbox--drawing" aria-hidden="true">
          <rect
            x={left + Math.min(pick.x0, pick.x1) * scale}
            y={top + Math.min(pick.y0, pick.y1) * scale}
            width={Math.abs(pick.x1 - pick.x0) * scale}
            height={Math.abs(pick.y1 - pick.y0) * scale}
          />
        </svg>
      )}
      {scene.handles && !picking && pts && rot && (
        <svg className="handles" aria-hidden="true">
          <polygon points={pts.map((p) => p.join(',')).join(' ')} className="handles__frame" />
          <line
            x1={(pts[0]![0] + pts[1]![0]) / 2}
            y1={(pts[0]![1] + pts[1]![1]) / 2}
            x2={rot[0]}
            y2={rot[1]}
            className="handles__stem"
          />
          {pts.map(([x, y], i) => (
            <rect
              key={i}
              x={x - 5}
              y={y - 5}
              width={10}
              height={10}
              className="handles__corner"
              data-handle={`c${i}`}
            />
          ))}
          <circle cx={rot[0]} cy={rot[1]} r={6} className="handles__rot" data-handle="rot" />
        </svg>
      )}
    </div>
  );
}
