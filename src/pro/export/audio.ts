import { type MediaStore } from '../media';
import { type Project } from '../model';

export const MIX_RATE = 48000;

/**
 * The project's sound for [0, duration): every unmuted video layer's audio
 * placed at its start, trimmed, looped, sped up and set to its volume, mixed
 * offline. Null when nothing makes a sound.
 */
export async function mixAudio(project: Project, media: MediaStore, duration: number): Promise<AudioBuffer | null> {
  const voices: { buffer: AudioBuffer; layer: Project['layers'][number] }[] = [];
  for (const layer of project.layers) {
    if (layer.kind !== 'video' || layer.muted || !layer.visible || layer.volume <= 0) continue;
    const m = media.get(layer.mediaId);
    if (!m) continue;
    let buffer = m.audio;
    if (!buffer && m.blob) {
      try {
        buffer = await new OfflineAudioContext(2, 1, MIX_RATE).decodeAudioData(await m.blob.arrayBuffer());
      } catch {
        buffer = null;
      }
    }
    if (buffer) voices.push({ buffer, layer });
  }
  if (!voices.length) return null;

  const length = Math.max(1, Math.round(duration * MIX_RATE));
  const ctx = new OfflineAudioContext(2, length, MIX_RATE);
  for (const { buffer, layer } of voices) {
    if (layer.start >= duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.0625, Math.min(16, layer.speed));
    const offset = Math.max(0, Math.min(buffer.duration - 0.001, layer.in));
    if (layer.loopMedia) {
      src.loop = true;
      src.loopStart = offset;
      src.loopEnd = buffer.duration;
    }
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, layer.volume);
    src.connect(gain).connect(ctx.destination);
    const when = Math.max(0, layer.start);
    src.start(when, offset);
    src.stop(Math.min(duration, layer.start + layer.length));
  }
  return ctx.startRendering();
}
