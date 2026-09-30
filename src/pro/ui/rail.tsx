import { useEffect, useRef, type ReactNode } from 'react';
import { effectById } from '../effects/registry';
import { type ShapeType } from '../model';
import { moveLayer, updateLayer, type Studio } from '../store';
import { Icon, type IconName } from './icons';

/** A panel that drops out of the left rail and closes on outside clicks / Esc. */
function Popover({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !(t as HTMLElement).closest?.('.rail')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="popover" ref={ref} role="dialog" aria-label={title}>
      <div className="popover__head">
        <span className="dots popover__title">{title}</span>
        <button type="button" className="pbtn pbtn--icon pbtn--small pbtn--flat" onClick={onClose} aria-label="Close">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="popover__body">{children}</div>
    </div>
  );
}

function Item({
  icon,
  swatch,
  label,
  sub,
  onClick,
}: {
  icon?: IconName;
  swatch?: ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="additem" onClick={onClick}>
      <span className="additem__icon">{swatch ?? (icon && <Icon name={icon} size={17} />)}</span>
      <span className="additem__text">
        <span>{label}</span>
        {sub && <span className="additem__sub">{sub}</span>}
      </span>
    </button>
  );
}

export interface AddActions {
  file: () => void;
  webcam: () => void;
  sample: () => void;
  text: () => void;
  shape: (s: ShapeType) => void;
  templates: () => void;
}

export function AddPanel({ onClose, add }: { onClose: () => void; add: AddActions }) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <Popover title="Add" onClose={onClose}>
      <span className="plabel">Quick add</span>
      <Item swatch={<span className="sw sw--type">Aa</span>} label="Type" onClick={run(add.text)} />
      <Item swatch={<span className="sw sw--circle" />} label="Circle" onClick={run(() => add.shape('circle'))} />
      <Item swatch={<span className="sw sw--square" />} label="Square" onClick={run(() => add.shape('square'))} />
      <Item swatch={<span className="sw sw--sphere" />} label="Sphere" onClick={run(() => add.shape('sphere'))} />
      <span className="plabel">Media</span>
      <Item
        icon="image"
        label="Pictures and videos"
        sub="Choose files, or drop them anywhere"
        onClick={run(add.file)}
      />
      <Item icon="webcam" label="Webcam" sub="Live; looks run on every frame" onClick={run(add.webcam)} />
      <Item icon="film" label="Sample clip" sub="Try a look on the turning pizza" onClick={run(add.sample)} />
      <span className="plabel">Draw</span>
      <Item icon="text" label="Type" onClick={run(add.text)} />
      <Item icon="shapes" label="Shapes" sub="Triangle, star, ring, heart" onClick={run(() => add.shape('triangle'))} />
      <Item icon="star" label="Coolshapes" sub="A gradient blob" onClick={run(() => add.shape('blob'))} />
      <span className="plabel">Reuse</span>
      <Item icon="templates" label="Templates" sub="Complete projects to start from" onClick={run(add.templates)} />
    </Popover>
  );
}

export function LayersPanel({
  studio,
  onClose,
  onRemove,
}: {
  studio: Studio;
  onClose: () => void;
  /** Deletes a layer (the studio's way, which also stops its subject analysis). */
  onRemove: (id: string) => void;
}) {
  const p = studio.project;
  const layers = [...p.layers].reverse();
  return (
    <Popover title="Layers" onClose={onClose}>
      <button
        type="button"
        className={`layeritem layeritem--canvas${studio.state.selected === null ? ' layeritem--on' : ''}`}
        onClick={() => studio.select(null)}
      >
        <span className="layeritem__icon">
          <Icon name="canvas" size={16} />
        </span>
        <span className="layeritem__text">
          <span>Canvas</span>
          <span className="additem__sub">
            {p.canvas.width} × {p.canvas.height} · {p.canvas.fps} fps · {p.canvas.duration.toFixed(1)} s
          </span>
        </span>
      </button>
      {layers.map((l) => {
        const looks = l.effects.map((e) => effectById(e.effectId)?.name).filter(Boolean);
        return (
          <div key={l.id} className={`layeritem${studio.state.selected === l.id ? ' layeritem--on' : ''}`}>
            <button type="button" className="layeritem__main" onClick={() => studio.select(l.id)}>
              <span className="layeritem__icon">
                <Icon
                  name={
                    l.kind === 'video' || l.kind === 'sample'
                      ? 'film'
                      : l.kind === 'text'
                        ? 'text'
                        : l.kind === 'shape'
                          ? 'shapes'
                          : l.kind === 'webcam'
                            ? 'webcam'
                            : 'image'
                  }
                  size={16}
                />
              </span>
              <span className="layeritem__text">
                <span>{l.name}</span>
                <span className="additem__sub">{looks.length ? looks.join(' + ') : 'No look'}</span>
              </span>
            </button>
            <span className="layeritem__tools">
              <button
                type="button"
                className="iconbtn"
                onClick={() => studio.commit(updateLayer(l.id, { visible: !l.visible }))}
                aria-label={l.visible ? 'Hide layer' : 'Show layer'}
                title={l.visible ? 'Hide' : 'Show'}
              >
                <Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={() => studio.commit(updateLayer(l.id, { locked: !l.locked }))}
                aria-label={l.locked ? 'Unlock layer' : 'Lock layer'}
                title={l.locked ? 'Locked: can’t be moved on the canvas' : 'Lock'}
              >
                <Icon name={l.locked ? 'lock' : 'unlock'} size={14} />
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={() => studio.commit(moveLayer(l.id, 1))}
                aria-label="Move up"
                title="Bring forward"
              >
                <Icon name="up" size={14} />
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={() => studio.commit(moveLayer(l.id, -1))}
                aria-label="Move down"
                title="Send backward"
              >
                <Icon name="down" size={14} />
              </button>
              <button
                type="button"
                className="iconbtn"
                onClick={() => onRemove(l.id)}
                aria-label="Delete layer"
                title="Delete"
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        );
      })}
      {layers.length === 0 && <p className="muted small">No layers yet. Add a picture, a video or some type.</p>}
    </Popover>
  );
}
