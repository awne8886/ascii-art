import { useEffect, useRef, useState } from 'react';
import { type MediaStore } from '../media';
import { type Layer } from '../model';
import { setEffects, updateLayer, type Studio } from '../store';
import { type SubjectStore } from '../subject/store';
import { analyzeTrack } from '../tracking/analyze';
import { Group, Select, Switch } from './controls';
import { Icon } from './icons';
import { analysesItself, refreshSubject, withSubject } from './SubjectPanel';

interface Props {
  studio: Studio;
  layer: Layer;
  media: MediaStore;
  picking: boolean;
  onPick: () => void;
  onAddLabel: () => void;
  toast: (msg: string) => void;
  subjects: SubjectStore;
  /** Opens the Subject tab (after "Cut out the object"). */
  onOpenSubject: () => void;
}

function stats(data: number[]): { frames: number; mean: number; lost: number } {
  const n = Math.floor(data.length / 5);
  let sum = 0;
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const c = data[i * 5 + 4]!;
    sum += c;
    if (c < 0.35) lost++;
  }
  return { frames: n, mean: n ? sum / n : 0, lost };
}

/**
 * Track: follow an object through a video (or the sample clip), then let
 * other layers ride along with it, or keep looks on it.
 */
export function TrackPanel({
  studio,
  layer,
  media,
  picking,
  onPick,
  onAddLabel,
  toast,
  subjects,
  onOpenSubject,
}: Props) {
  const trackable = layer.kind === 'video' || layer.kind === 'sample';
  const track = layer.track;
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const autoRun = useRef(false);
  // The layer as it is now, for when a track finishes (its subject settings may have changed meanwhile).
  const latest = useRef(layer);
  useEffect(() => {
    latest.current = layer;
  });

  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    const tr = studio.project.layers.find((l) => l.id === layer.id)?.track;
    if (!tr) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress(0);
    try {
      const result = await analyzeTrack(layer, tr, media, setProgress, ctrl.signal);
      studio.commit(updateLayer(layer.id, { track: result }));
      const s = stats(result.data);
      toast(`Tracked ${s.frames} frames${s.lost ? ` (lost in ${s.lost})` : ''}.`);
      // A cut-out of the tracked object follows the new track.
      const now = latest.current;
      if (now.subject?.on && now.subject.area === 'tracked') refreshSubject(subjects, { ...now, track: result }, toast);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  // A freshly drawn box starts tracking by itself.
  const boxKey = track ? track.box.join(',') : '';
  useEffect(() => {
    if (!autoRun.current || !track || track.data.length) return;
    autoRun.current = false;
    void run();
    // Only when a new box arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxKey]);

  const followable = studio.project.layers.filter((l) => l.id !== layer.id && l.track);
  const s = track ? stats(track.data) : null;
  const cutOut = !!layer.subject?.on && layer.subject.area === 'tracked';

  return (
    <div className="panel-body">
      {trackable ? (
        <Group title="Object" icon="target" summary={s?.frames ? `${s.frames} frames` : track ? 'Drawn' : 'None'}>
          {!track && (
            <p className="muted small">
              Draw a box on the canvas around what to follow: a face, a ball, a car. It is followed through the whole
              clip, forwards and backwards from this frame.
            </p>
          )}
          {s && s.frames > 0 && (
            <div className="trackstats">
              <span>
                <b>{s.frames}</b> frames
              </span>
              <span>
                <b>{Math.round(s.mean * 100)}%</b> sure
              </span>
              <span>
                <b>{s.lost}</b> lost
              </span>
            </div>
          )}
          {track && s?.frames === 0 && progress === null && (
            <p className="muted small">Box drawn. Track it to follow it through the clip.</p>
          )}
          {progress !== null ? (
            <div className="trackprogress">
              <span className="bar">
                <span className="bar__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
              <button type="button" className="pbtn pbtn--small" onClick={() => abort.current?.abort()}>
                Stop {Math.round(progress * 100)}%
              </button>
            </div>
          ) : (
            <div className="btnrow btnrow--split">
              <button
                type="button"
                className={`pbtn${track ? '' : ' pbtn--primary'}${picking ? ' pbtn--on' : ''}`}
                onClick={() => {
                  autoRun.current = true;
                  onPick();
                }}
              >
                <Icon name="target" size={15} /> {track ? 'Redraw' : 'Draw a box'}
              </button>
              {track ? (
                <button type="button" className="pbtn pbtn--primary" onClick={() => void run()}>
                  <Icon name="play" size={12} /> {s?.frames ? 'Track again' : 'Track'}
                </button>
              ) : (
                <span />
              )}
            </div>
          )}
          {track && progress === null && (
            <button
              type="button"
              className="pbtn pbtn--block pbtn--ghost"
              onClick={() => {
                const wasCutOut = layer.subject?.area === 'tracked';
                if (wasCutOut) subjects.cancel(layer.id);
                studio.commit((p) => ({
                  ...p,
                  layers: p.layers.map((l) =>
                    l.id === layer.id
                      ? {
                          ...l,
                          track: undefined,
                          effects: l.effects.map((e) => (e.appears === 5 ? { ...e, appears: 0 } : e)),
                          // A cut-out of the object goes back to the whole frame (analysed again below).
                          subject: l.subject?.area === 'tracked' ? { ...l.subject, area: 'frame' } : l.subject,
                        }
                      : l.follow?.layerId === layer.id
                        ? { ...l, follow: undefined }
                        : l,
                  ),
                }));
                if (wasCutOut && layer.subject?.on) {
                  // The cut-out now separates the whole frame: analyse it, as switching the area does.
                  const next: Layer = { ...layer, track: undefined, subject: { ...layer.subject, area: 'frame' } };
                  refreshSubject(subjects, next, toast);
                  if (!analysesItself(next))
                    toast('Separation is back on the whole frame: analyse it again in the Subject tab.');
                }
              }}
            >
              <Icon name="trash" size={14} /> Clear the track
            </button>
          )}
        </Group>
      ) : (
        <p className="muted small">
          Objects can be tracked in videos and the sample clip. This layer can follow one: track it on that layer first.
        </p>
      )}

      {trackable && track && s && s.frames > 0 && (
        <Group title="Use it" icon="sparkles">
          <button type="button" className="rowbtn" onClick={onAddLabel}>
            <Icon name="text" size={16} />
            <span className="rowbtn__title">Label that follows</span>
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="rowbtn"
            onClick={() => {
              if (!layer.effects.length) {
                toast('Add a look to this layer first, then keep it on the object.');
                return;
              }
              studio.commit(setEffects(layer.id, (list) => list.map((e) => ({ ...e, appears: 5 }))));
              toast('Looks now appear only on the tracked object (change it in Look → Mask).');
            }}
          >
            <Icon name="look" size={16} />
            <span className="rowbtn__title">Looks only on the object</span>
            <Icon name="chevronRight" size={14} />
          </button>
          <button
            type="button"
            className="rowbtn"
            title="Separate the object from everything around it, in its real shape, all through the clip"
            onClick={() => {
              // Once it's on, the row only leads back to the Subject tab (an analysis under way carries on).
              if (!cutOut) {
                const next = withSubject(layer, { on: true, area: 'tracked' });
                studio.commit(updateLayer(layer.id, { subject: next.subject }));
                refreshSubject(subjects, next, toast);
              }
              onOpenSubject();
            }}
          >
            <Icon name="subject" size={16} />
            <span className="rowbtn__title">Cut out the object</span>
            {cutOut ? <span className="rowbtn__value">On</span> : <Icon name="chevronRight" size={14} />}
          </button>
          <p className="muted small">Any other layer can follow it from its own Track tab.</p>
        </Group>
      )}

      <Group
        title="Follow"
        icon="move"
        summary={layer.follow ? 'On' : 'Off'}
        defaultOpen={!trackable || !!layer.follow}
      >
        {followable.length ? (
          <>
            <Select
              label="Follows"
              value={layer.follow?.layerId ?? ''}
              options={[{ value: '', label: 'Nothing' }, ...followable.map((l) => ({ value: l.id, label: l.name }))]}
              onChange={(id) =>
                studio.commit(
                  updateLayer(layer.id, {
                    follow: id ? { layerId: id, scale: layer.follow?.scale ?? false } : undefined,
                  }),
                )
              }
            />
            {layer.follow && (
              <>
                <Switch
                  label="Grow and shrink with it"
                  checked={layer.follow.scale}
                  onChange={(v) => studio.commit(updateLayer(layer.id, { follow: { ...layer.follow!, scale: v } }))}
                />
                <p className="muted small">
                  Put this layer where you want it next to the object: it keeps that spot as the object moves.
                </p>
              </>
            )}
          </>
        ) : (
          <p className="muted small">No tracked objects yet. Track one in a video layer, then choose it here.</p>
        )}
      </Group>
    </div>
  );
}
