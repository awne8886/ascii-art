import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TEMPLATES, type Template, type TemplateFormat } from '../templates';
import { useProjectThumb } from '../thumbs';
import { Icon } from './icons';

function Modal({
  label,
  onClose,
  children,
  wide,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal__scrim" onClick={onClose} />
      <div className={`modal__box${wide ? ' modal__box--wide' : ''}`}>{children}</div>
    </div>
  );
}

export function TemplatesModal({ onPick, onClose }: { onPick: (t: Template) => void; onClose: () => void }) {
  const [format, setFormat] = useState<TemplateFormat | 'all'>('all');
  const list = TEMPLATES.filter((t) => format === 'all' || t.format === format);
  return (
    <Modal label="Templates" onClose={onClose} wide>
      <div className="tpl">
        <aside className="tpl__side">
          <span className="plabel">ascii art / the template collection</span>
          <span className="dots tpl__title">Templates</span>
          <p className="muted small">
            Complete projects. Make them your own: pick one, then swap the sample for your picture or video.
          </p>
          <span className="plabel">Discover</span>
          <button type="button" className="tpl__nav tpl__nav--on">
            Templates
          </button>
        </aside>
        <div className="tpl__main">
          <div className="tpl__head">
            <div>
              <span className="plabel">Your starting point</span>
              <p className="small">Choose a design, replace the content and keep creating.</p>
            </div>
            <button type="button" className="pbtn pbtn--icon" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="pseg tpl__filter">
            {(['all', 'portrait', 'landscape', 'square'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`pseg__opt${format === f ? ' pseg__opt--on' : ''}`}
                onClick={() => setFormat(f)}
              >
                {f === 'all' ? 'All formats' : f}
              </button>
            ))}
          </div>
          <div className="tpl__grid">
            {list.map((t) => (
              <TemplateCard key={t.id} t={t} onPick={() => onPick(t)} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TemplateCard({ t, onPick }: { t: Template; onPick: () => void }) {
  const url = useProjectThumb(t.id, t.build);
  const { width, height } = useMemo(() => t.build().canvas, [t]);
  return (
    <button type="button" className="tplcard" onClick={onPick}>
      <span className="tplcard__img" style={{ aspectRatio: `${width} / ${height}` }}>
        {url ? <img src={url} alt="" /> : <span className="thumb-wait" />}
      </span>
      <span className="tplcard__name">{t.name}</span>
      <span className="tplcard__desc">{t.description}</span>
    </button>
  );
}

export function WelcomeModal({ onStart, onTemplates }: { onStart: () => void; onTemplates: () => void }) {
  const url = useProjectThumb('welcome', TEMPLATES[0]!.build);
  const items: [string, string][] = [
    [
      'Video in, video out.',
      'Drop a video and every frame goes through your looks; export it as MP4 or WebM, sound and all.',
    ],
    [
      '59 looks.',
      'ASCII, halftone, dither, riso, glitch, contour maps, thermal… each with presets and every setting to hand.',
    ],
    [
      'Layers & motion.',
      'Stack pictures, videos, type and shapes; one click sets any of them moving, in loops that never end.',
    ],
    [
      'A timeline.',
      'See every layer at a glance, trim and move clips, animate any setting or let it follow the sound.',
    ],
    ['Private by design.', 'Everything runs in your browser. Nothing you add ever leaves your device.'],
  ];
  return (
    <Modal label="Welcome to PRO" onClose={onStart} wide>
      <div className="welcome">
        <div className="ptitle">
          <div className="ptitle__box">
            <span className="dots ptitle__main">ascii art pro</span>
            <span className="ptitle__sub">the other side of the site</span>
          </div>
          <button type="button" className="pbtn pbtn--icon" onClick={onStart} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="welcome__body">
          <div className="welcome__demo">
            <div className="welcome__bar">
              <span className="led" /> Pizza wave <span className="welcome__bar-right">Look · ASCII</span>
            </div>
            <div className="welcome__img">{url ? <img src={url} alt="" /> : <span className="thumb-wait" />}</div>
          </div>
          <div className="welcome__list">
            <p>The studio side of ascii art: the same colour ASCII, now for video, with a whole library of looks.</p>
            <ol>
              {items.map(([title, body], i) => (
                <li key={title}>
                  <span className="welcome__num dots-num">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{title}</strong> {body}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="welcome__foot">
          <span className="muted small">Press ? any time for keyboard shortcuts.</span>
          <span className="btnrow">
            <button type="button" className="pbtn" onClick={onTemplates}>
              <Icon name="templates" size={15} /> Browse templates
            </button>
            <button type="button" className="pbtn pbtn--primary" onClick={onStart}>
              <Icon name="play" size={13} /> Start creating
            </button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Step one frame (Shift: one second)'],
  ['Home / End', 'Go to the start / end'],
  ['⌘/Ctrl Z', 'Undo'],
  ['⌘/Ctrl Shift Z, Ctrl Y', 'Redo'],
  ['⌘/Ctrl D', 'Duplicate the layer'],
  ['Delete', 'Delete the layer'],
  ['Arrow keys + Alt', 'Nudge the layer (Shift: more)'],
  ['L / M / C', 'Look / Move / Canvas panel'],
  ['A', 'Add'],
  ['E', 'Export'],
  ['0', 'Zoom to fit'],
  ['Esc', 'Select the canvas / close'],
  ['?', 'This list'],
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose}>
      <div className="ptitle">
        <div className="ptitle__box">
          <span className="dots ptitle__main">Shortcuts</span>
        </div>
        <button type="button" className="pbtn pbtn--icon" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <dl className="keys">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="keys__row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small pad">
        Drop pictures or videos anywhere to add them as layers. Paste an image from the clipboard, too.
      </p>
    </Modal>
  );
}
