import { useEffect, useRef, useState } from 'react';
import { AsciiEngine, type EngineStats, type FinalMask } from '../ascii/engine';
import { type SourceImage } from '../image';
import { type Settings } from '../settings';

interface Props {
  image: SourceImage | null;
  mask: FinalMask | null;
  settings: Settings;
  /** 0 = idle, 1 = a file is being dragged over the page. */
  energy: number;
  onEngine: (engine: AsciiEngine | null) => void;
  onStats: (stats: EngineStats) => void;
}

/** The canvas. Owns the engine, keeps it sized to the element, pauses while the tab is hidden. */
export function Stage({ image, mask, settings, energy, onEngine, onStats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AsciiEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The engine is created once; later settings arrive through the effect below.
  const initialSettings = useRef(settings);
  const statsRef = useRef(onStats);
  const engineCb = useRef(onEngine);

  useEffect(() => {
    statsRef.current = onStats;
    engineCb.current = onEngine;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: AsciiEngine;
    try {
      engine = new AsciiEngine(canvas, initialSettings.current);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
      return;
    }
    engineRef.current = engine;
    engine.onStats = (s) => statsRef.current(s);
    engineCb.current(engine);

    let pending = 0;
    const resize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        engine.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onVisibility = () => (document.hidden ? engine.stop() : engine.start());
    const onLost = (e: Event) => {
      e.preventDefault();
      setError('The graphics context was lost. Reload the page to continue.');
    };
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    if (!document.hidden) engine.start();

    return () => {
      cancelAnimationFrame(pending);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      engine.dispose();
      engineRef.current = null;
      engineCb.current(null);
    };
  }, []);

  useEffect(() => engineRef.current?.setImage(image), [image]);
  useEffect(() => engineRef.current?.setMask(mask), [mask]);
  useEffect(() => engineRef.current?.setSettings(settings), [settings]);
  useEffect(() => engineRef.current?.setEnergy(energy), [energy]);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage__canvas" aria-label="ASCII art preview" role="img" />
      {error && (
        <div className="stage__error" role="alert">
          <p>{error}</p>
          <p className="stage__error-sub">This site needs WebGL 2 (any recent Chrome, Edge, Firefox or Safari).</p>
        </div>
      )}
    </div>
  );
}
