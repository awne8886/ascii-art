import { effectById, effectSource } from '../effects/registry';
import { type EffectDef, type ParamValues } from '../effects/types';
import { followShift, invert3, layerQuad, squareToQuad, type Mat3 } from '../geometry';
import {
  resolveParams,
  layerActive,
  looksKeyFor,
  looksPaper,
  mediaTime,
  trackAt,
  type CanvasFinish,
  type EffectInstance,
  type Layer,
  type LayerFinish,
  type Project,
  type SubjectKey,
  type SubjectPart,
  type SubjectSettings,
} from '../model';
import { type LayerMask, type MaskFrame } from '../subject/types';
import { buildAtlas } from './atlas';
import {
  ACCUM_FS,
  BRIGHT_FS,
  CLEAR_FS,
  COPY_FS,
  DOWN_FS,
  FULLSCREEN_VS,
  GLOW_FS,
  GRADE_FS,
  LAYER_FS,
  OUTPUT_FS,
  STREAK_FS,
  SUBJECT_MASK_FS,
  SUBJECT_MATTE_FS,
  SUBJECT_PREP_FS,
  UP_FS,
} from './shaders';

/**
 * The PRO studio's WebGL2 compositor. Per frame: every visible layer's
 * picture (a still, the current video frame, rendered type…) goes through
 * its looks (one full-screen pass each, ping-ponging between mipmapped
 * targets the size the layer covers on screen) and its finish (bloom,
 * streaks, trails), then is placed onto the canvas with its projective
 * transform, opacity and blend mode. The canvas then gets its own looks,
 * finish, grade and paper, and goes to the screen.
 *
 * A layer whose subject is separated (`maskOf`) also gets its background
 * treated before the looks (prep), and its looks confined to their part of
 * the picture after them (matte); every look sees the mask, for "appears in:
 * subject / background". Canvas looks that appear on the subject read a
 * canvas-wide mask gathered from every placed layer.
 */

export interface LayerFrame {
  source: TexImageSource;
  /** Intrinsic size in canvas px (for "original" fit and the aspect ratio). */
  width: number;
  height: number;
  /** Changes whenever the pixels do; stills keep theirs so they upload once. */
  version: string | number;
}

export interface RenderInput {
  project: Project;
  /** Seconds on the timeline. */
  time: number;
  frame: number;
  /** Output size, px. */
  width: number;
  height: number;
  frameOf: (layer: Layer) => LayerFrame | null;
  /** Sound level 0–1 of a layer (or of the whole mix, for null), for sound-driven params. */
  sound?: (layer: Layer | null) => number;
  /** Replaces the canvas background (export options); null keeps it. */
  background?: [number, number, number, number] | null;
  /** Skip layers' and effects' feedback history (thumbnails). */
  still?: boolean;
  /** A layer's separated subject at this time (asked only of layers with separation on); null for none. */
  maskOf?: (layer: Layer) => LayerMask | null;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

/** A subject mask on the GPU (R8), and which MaskFrame it holds. */
interface MaskTex {
  tex: WebGLTexture;
  version: string;
  w: number;
  h: number;
}

/** What a pass needs to sample a subject: the u_subj* uniforms. */
interface SubjectBind {
  a: WebGLTexture;
  b: WebGLTexture;
  rectA: [number, number, number, number];
  rectB: [number, number, number, number];
  mix: number;
  outside: number;
}

interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

interface GlowChain {
  bloom: Target[];
  streak: [Target, Target];
}

interface Owner {
  ping: [Target | null, Target | null];
  fxPrev: Map<string, Target>;
  trail: Target | null;
  glowOut: Target | null;
  gradeOut: Target | null;
  srcTex: WebGLTexture | null;
  srcVersion: string | number | null;
  /** Subject masks: the pair drawn last (a, b), each uploaded once per version. */
  subj: [MaskTex | null, MaskTex | null];
  /** Background treatment and subject matte outputs, sized like the layer buffer. */
  prepOut: Target | null;
  matteOut: Target | null;
  used: boolean;
}

interface AtlasEntry {
  tex: WebGLTexture;
  cols: number;
  rows: number;
  count: number;
  cellH: number;
  used: number;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.padEnd(6, '0'), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function backgroundColor(project: Project): [number, number, number, number] {
  const c = project.canvas;
  if (c.background === 'transparent') return [0, 0, 0, 0];
  if (c.background === 'light') return [0.96, 0.925, 0.843, 1];
  if (c.background === 'color') return [...hexToRgb01(c.color), 1];
  return [0, 0, 0, 1];
}

type TrackBox = [number, number, number, number];
const NO_TRACK: TrackBox = [0, 0, 0, 0];

const PARTS: Record<SubjectPart, number> = { all: 0, subject: 1, background: 2 };
const KEYS: Record<SubjectKey, number> = { off: 0, dark: 1, light: 2 };
const WHOLE: [number, number, number, number] = [0, 0, 1, 1];

/** The layer's tracked object at time t (centre x, y, width, height in its uv), for "appears in: tracked object". */
function trackBox(layer: Layer, t: number): TrackBox {
  const tr = layer.track;
  if (!tr) return NO_TRACK;
  const s = trackAt(tr, mediaTime(layer, t, tr.duration) ?? tr.at);
  return [s.cx, s.cy, s.w, s.h];
}

const MAX_SIDE = 4096;
const MAX_AREA = 16e6;
const CANVAS_OWNER = '__canvas__';
const THUMB_OWNER = '__thumb__';

export class ProRenderer {
  readonly gl: WebGL2RenderingContext;
  /** Effects whose shader failed to compile, with the compiler's message. */
  readonly errors = new Map<string, string>();
  private programs = new Map<string, Program | null>();
  private owners = new Map<string, Owner>();
  private chains = new Map<string, GlowChain>();
  private atlases = new Map<string, AtlasEntry>();
  private comp: [Target | null, Target | null] = [null, null];
  /** Separate targets for thumbnails, so they don't resize the preview's. */
  private thumbComp: [Target | null, Target | null] = [null, null];
  private acc: [Target | null, Target | null] = [null, null];
  private blank!: WebGLTexture;
  private vao!: WebGLVertexArrayObject;
  private atlasClock = 0;
  /** Last known picture size of each layer (for followers of a layer that's off screen). */
  private sizes = new Map<string, [number, number]>();
  private lost = false;
  /** The last frame rendered (before it went to the screen). */
  private last: Target | null = null;
  /** The canvas's subject mask (R8), while a canvas look appears on the subject or background. */
  private canvasMask: Target | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.blank = this.texture(false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  // ─── Resources ───────────────────────────────────────────────────────────

  private compile(key: string, fs: string, label = key): Program | null {
    if (this.programs.has(key)) return this.programs.get(key)!;
    const { gl } = this;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s) ?? 'unknown error';
        gl.deleteShader(s);
        throw new Error(log);
      }
      return s;
    };
    let program: Program | null = null;
    try {
      const vs = shader(gl.VERTEX_SHADER, FULLSCREEN_VS);
      const f = shader(gl.FRAGMENT_SHADER, fs);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, f);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
      }
      const u: Uniforms = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        if (info) u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name);
      }
      program = { prog, u };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errors.set(label, msg);
      console.error(`[pro] shader "${label}" failed:\n${msg}`);
    }
    this.programs.set(key, program);
    return program;
  }

  private fixed(name: string, fs: string): Program {
    const p = this.compile(`fixed:${name}`, fs);
    if (!p) throw new Error(`Internal shader ${name} failed to compile.`);
    return p;
  }

  /** Compile an effect now (the library warms these up while idle). */
  effectProgram(def: EffectDef): Program | null {
    return this.compile(`fx:${def.id}`, effectSource(def), def.id);
  }

  private texture(mips: boolean): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(w: number, h: number): Target {
    const { gl } = this;
    // Plain linear until `mip()` builds levels: a mip filter without levels makes the texture incomplete.
    const tex = this.texture(false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private free(t: Target | null | undefined): void {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  /** `t` if it's already w×h, else a fresh one (the old one is freed). */
  private sized(t: Target | null, w: number, h: number): Target {
    if (t && t.w === w && t.h === h) return t;
    this.free(t);
    const next = this.target(w, h);
    this.clearTarget(next);
    return next;
  }

  private clearTarget(t: Target): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private owner(id: string): Owner {
    let o = this.owners.get(id);
    if (!o) {
      o = {
        ping: [null, null],
        fxPrev: new Map(),
        trail: null,
        glowOut: null,
        gradeOut: null,
        srcTex: null,
        srcVersion: null,
        subj: [null, null],
        prepOut: null,
        matteOut: null,
        used: true,
      };
      this.owners.set(id, o);
    }
    o.used = true;
    return o;
  }

  private dropOwner(id: string): void {
    const o = this.owners.get(id);
    if (!o) return;
    this.free(o.ping[0]);
    this.free(o.ping[1]);
    o.fxPrev.forEach((t) => this.free(t));
    this.free(o.trail);
    this.free(o.glowOut);
    this.free(o.gradeOut);
    if (o.srcTex) this.gl.deleteTexture(o.srcTex);
    this.dropSubject(o);
    this.owners.delete(id);
  }

  /** Free an owner's subject resources (separation switched off, or the owner gone). */
  private dropSubject(o: Owner): void {
    o.subj.forEach((m) => m && this.gl.deleteTexture(m.tex));
    o.subj = [null, null];
    this.free(o.prepOut);
    this.free(o.matteOut);
    o.prepOut = null;
    o.matteOut = null;
  }

  private atlasFor(def: EffectDef, params: ParamValues): AtlasEntry | null {
    const spec = def.atlas?.(params);
    if (!spec) return null;
    const key = JSON.stringify(spec);
    let entry = this.atlases.get(key);
    if (!entry) {
      const { gl } = this;
      const a = buildAtlas(spec);
      const tex = this.texture(true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      entry = { tex, cols: a.cols, rows: a.rows, count: a.count, cellH: a.cellH, used: 0 };
      this.atlases.set(key, entry);
      if (this.atlases.size > 48) {
        const oldest = [...this.atlases.entries()].sort((x, y) => x[1].used - y[1].used)[0]!;
        gl.deleteTexture(oldest[1].tex);
        this.atlases.delete(oldest[0]);
      }
    }
    entry.used = ++this.atlasClock;
    return entry;
  }

  private upload(tex: WebGLTexture, source: TexImageSource): boolean {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      return true;
    } catch {
      // A video without a decoded frame yet, a tainted image…: skip this frame.
      return false;
    }
  }

  /** `slot` holding mask frame f, uploading its bytes only when it holds another version. Null for a malformed frame. */
  private maskSlot(slot: MaskTex | null, f: MaskFrame): MaskTex | null {
    if (slot && slot.version === f.version) return slot;
    const w = Math.round(f.width);
    const h = Math.round(f.height);
    if (w < 1 || h < 1 || f.data.length < w * h) return null;
    const { gl } = this;
    const tex = slot?.tex ?? this.texture(false);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // One byte per texel: rows are as long as the mask is wide, not padded to 4.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (slot && slot.w === w && slot.h === h)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, f.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, f.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return { tex, version: f.version, w, h };
  }

  /**
   * The layer's subject on the GPU, ready to bind. Uploads happen here, before
   * any pass binds its textures (creating or binding one clobbers the active unit).
   */
  private subjectFor(o: Owner, m: LayerMask): SubjectBind | null {
    // A video stepping forward: the frame it blended towards is the one it now blends from.
    if (o.subj[0]?.version !== m.a.version && o.subj[1]?.version === m.a.version) o.subj = [o.subj[1], o.subj[0]];
    const a = (o.subj[0] = this.maskSlot(o.subj[0], m.a) ?? o.subj[0]);
    if (!a || a.version !== m.a.version) return null;
    let b = a;
    if (m.b.version !== m.a.version) {
      const nb = (o.subj[1] = this.maskSlot(o.subj[1], m.b) ?? o.subj[1]);
      if (!nb || nb.version !== m.b.version) return null;
      b = nb;
    }
    const mix = m.b.version === m.a.version ? 0 : Math.max(0, Math.min(1, m.mix));
    return {
      a: a.tex,
      b: b.tex,
      rectA: m.a.rect,
      rectB: b === a ? m.a.rect : m.b.rect,
      mix,
      outside: Math.max(0, Math.min(1, m.outside)),
    };
  }

  private chain(w: number, h: number): GlowChain {
    const key = `${w}x${h}`;
    let c = this.chains.get(key);
    if (!c) {
      const bloom: Target[] = [];
      let bw = Math.max(1, w >> 1);
      let bh = Math.max(1, h >> 1);
      for (let i = 0; i < 6 && bw >= 4 && bh >= 4; i++) {
        bloom.push(this.target(bw, bh));
        bw >>= 1;
        bh >>= 1;
      }
      if (!bloom.length) bloom.push(this.target(1, 1));
      const sw = Math.max(1, w >> 2);
      const sh = Math.max(1, h >> 2);
      c = { bloom, streak: [this.target(sw, sh), this.target(sw, sh)] };
      this.chains.set(key, c);
      if (this.chains.size > 12) {
        const [k0, c0] = this.chains.entries().next().value!;
        c0.bloom.forEach((t) => this.free(t));
        c0.streak.forEach((t) => this.free(t));
        this.chains.delete(k0);
      }
    }
    return c;
  }

  // ─── Passes ──────────────────────────────────────────────────────────────

  private bindTarget(t: Target | null, w: number, h: number): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, w, h);
  }

  private use(p: Program, w: number, h: number): void {
    const { gl } = this;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    const u = p.u.u_res;
    if (u) gl.uniform2f(u, w, h);
  }

  private tex(p: Program, name: string, unit: number, tex: WebGLTexture | null): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this.blank);
    const loc = p.u[name];
    if (loc) gl.uniform1i(loc, unit);
  }

  private f(p: Program, name: string, ...v: number[]): void {
    const loc = p.u[name];
    if (!loc) return;
    const { gl } = this;
    if (v.length === 1) gl.uniform1f(loc, v[0]!);
    else if (v.length === 2) gl.uniform2f(loc, v[0]!, v[1]!);
    else if (v.length === 3) gl.uniform3f(loc, v[0]!, v[1]!, v[2]!);
    else gl.uniform4f(loc, v[0]!, v[1]!, v[2]!, v[3]!);
  }

  private draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** The u_subj* uniforms (units 3 and 4), or u_subjOn = 0 with blanks bound so no stale texture is sampled. */
  private bindSubject(p: Program, s: SubjectBind | null | undefined): void {
    this.tex(p, 'u_subjA', 3, s?.a ?? null);
    this.tex(p, 'u_subjB', 4, s?.b ?? null);
    this.f(p, 'u_subjOn', s ? 1 : 0);
    if (!s) return;
    this.f(p, 'u_subjRectA', ...s.rectA);
    this.f(p, 'u_subjRectB', ...s.rectB);
    this.f(p, 'u_subjMix', s.mix);
    this.f(p, 'u_subjOutside', s.outside);
  }

  /** Build the target's mip chain (and sample it with mipmaps from now on). */
  private mip(t: Target): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private copy(src: Target, dst: Target): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /** One effect pass: input → out. */
  private effectPass(
    def: EffectDef,
    fx: EffectInstance,
    params: ParamValues,
    input: WebGLTexture,
    out: Target,
    prev: Target | null,
    ctx: { time: number; duration: number; frame: number; unit: number; track?: TrackBox; subj?: SubjectBind | null },
  ): boolean {
    const p = this.effectProgram(def);
    if (!p) return false;
    const { gl } = this;
    // Build the atlas first: creating a texture binds it on the active unit, which would clobber a binding below.
    const atlas = this.atlasFor(def, params);
    this.bindTarget(out, out.w, out.h);
    this.use(p, out.w, out.h);
    this.tex(p, 'u_src', 0, input);
    this.tex(p, 'u_prev', 1, prev?.tex ?? null);
    this.tex(p, 'u_atlas', 2, atlas?.tex ?? null);
    this.bindSubject(p, ctx.subj);
    this.f(p, 'u_atlasGrid', atlas?.cols ?? 1, atlas?.rows ?? 1);
    this.f(p, 'u_glyphCount', atlas?.count ?? 0);
    this.f(p, 'u_atlasCellPx', atlas?.cellH ?? 64);
    this.f(p, 'u_time', ctx.time);
    this.f(p, 'u_duration', ctx.duration);
    this.f(p, 'u_frame', ctx.frame);
    this.f(p, 'u_seed', fx.seed);
    this.f(p, 'u_unit', ctx.unit);
    this.f(p, 'u_strength', fx.strength);
    this.f(p, 'u_blend', fx.blend);
    this.f(p, 'u_appears', fx.appears);
    this.f(p, 'u_appearsSoft', fx.appearsSoft);
    this.f(p, 'u_appearsInvert', fx.appearsInvert ? 1 : 0);
    this.f(p, 'u_track', ...(ctx.track ?? NO_TRACK));
    for (const def2 of def.params) {
      if (def2.type === 'text') continue;
      const loc = p.u[`u_${def2.key}`];
      if (!loc) continue;
      const v = params[def2.key] ?? def2.default;
      if (def2.type === 'color') {
        const [r, g, b] = hexToRgb01(String(v));
        gl.uniform3f(loc, r, g, b);
      } else if (def2.type === 'toggle') gl.uniform1f(loc, v ? 1 : 0);
      else gl.uniform1f(loc, Number(v) || 0);
    }
    this.draw();
    this.mip(out);
    return true;
  }

  /** Run a stack of looks over `input` (w×h), returning the result's texture. */
  private runEffects(
    owner: Owner,
    input: WebGLTexture,
    w: number,
    h: number,
    effects: readonly EffectInstance[],
    ctx: {
      time: number;
      duration: number;
      frame: number;
      unit: number;
      sound: number;
      still: boolean;
      track?: TrackBox;
      subj?: SubjectBind | null;
    },
  ): { tex: WebGLTexture; target: Target | null } {
    let cur = input;
    let curTarget: Target | null = null;
    let flip = 0;
    const live = new Set<string>();
    for (const fx of effects) {
      if (!fx.enabled || fx.strength <= 0) continue;
      const def = effectById(fx.effectId);
      if (!def) continue;
      const out = (owner.ping[flip] = this.sized(owner.ping[flip] ?? null, w, h));
      let prev: Target | null = null;
      if (def.feedback && !ctx.still) {
        live.add(fx.uid);
        prev = this.sized(owner.fxPrev.get(fx.uid) ?? null, w, h);
        owner.fxPrev.set(fx.uid, prev);
      }
      const params = resolveParams(fx, ctx.time, ctx.duration, ctx.sound);
      if (!this.effectPass(def, fx, params, cur, out, prev, ctx)) continue;
      if (prev) this.copy(out, prev);
      cur = out.tex;
      curTarget = out;
      flip ^= 1;
    }
    for (const [id, t] of owner.fxPrev) {
      if (!live.has(id) && !ctx.still) {
        this.free(t);
        owner.fxPrev.delete(id);
      }
    }
    return { tex: cur, target: curTarget };
  }

  /** Bloom, streaks and trails over `input` (w×h). Returns the input when all are off. */
  private glow(
    owner: Owner,
    input: WebGLTexture,
    w: number,
    h: number,
    fin: LayerFinish,
    still: boolean,
  ): Target | null {
    const bloomOn = fin.bloom.on && fin.bloom.intensity > 0;
    const streakOn = fin.streaks.on && fin.streaks.intensity > 0;
    const trailOn = fin.trails.on && !still;
    if (!bloomOn && !streakOn && !trailOn) {
      if (owner.trail) {
        this.free(owner.trail);
        owner.trail = null;
      }
      return null;
    }
    const { gl } = this;
    const chain = bloomOn || streakOn ? this.chain(w, h) : null;
    if (chain && bloomOn) {
      const levels = chain.bloom;
      const bright = this.fixed('bright', BRIGHT_FS);
      this.bindTarget(levels[0]!, levels[0]!.w, levels[0]!.h);
      this.use(bright, levels[0]!.w, levels[0]!.h);
      this.tex(bright, 'u_img', 0, input);
      this.f(bright, 'u_texel', 1 / w, 1 / h);
      this.f(bright, 'u_threshold', fin.bloom.threshold);
      this.draw();
      const down = this.fixed('down', DOWN_FS);
      for (let i = 1; i < levels.length; i++) {
        const s = levels[i - 1]!;
        const d = levels[i]!;
        this.bindTarget(d, d.w, d.h);
        this.use(down, d.w, d.h);
        this.tex(down, 'u_img', 0, s.tex);
        this.f(down, 'u_texel', 0.5 / s.w, 0.5 / s.h);
        this.draw();
      }
      const up = this.fixed('up', UP_FS);
      const scatter = 0.35 + 0.6 * fin.bloom.radius;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE);
      gl.blendColor(scatter, scatter, scatter, 1);
      for (let i = levels.length - 1; i > 0; i--) {
        const s = levels[i]!;
        const d = levels[i - 1]!;
        this.bindTarget(d, d.w, d.h);
        this.use(up, d.w, d.h);
        this.tex(up, 'u_img', 0, s.tex);
        this.f(up, 'u_texel', 0.5 / s.w, 0.5 / s.h);
        this.draw();
      }
      gl.disable(gl.BLEND);
    }
    if (chain && streakOn) {
      const [a, b] = chain.streak;
      const bright = this.fixed('bright', BRIGHT_FS);
      this.bindTarget(a, a.w, a.h);
      this.use(bright, a.w, a.h);
      this.tex(bright, 'u_img', 0, input);
      this.f(bright, 'u_texel', 1 / w, 1 / h);
      this.f(bright, 'u_threshold', fin.streaks.threshold);
      this.draw();
      const streak = this.fixed('streak', STREAK_FS);
      let src = a;
      let dst = b;
      const len = 0.5 + fin.streaks.length * 2.5;
      for (const spread of [1, 3, 9, 27]) {
        this.bindTarget(dst, dst.w, dst.h);
        this.use(streak, dst.w, dst.h);
        this.tex(streak, 'u_img', 0, src.tex);
        this.f(streak, 'u_texel', 1 / src.w, 1 / src.h);
        this.f(streak, 'u_spread', spread * len);
        this.draw();
        [src, dst] = [dst, src];
      }
      chain.streak = [src, dst];
    }
    const out = (owner.glowOut = this.sized(owner.glowOut, w, h));
    if (trailOn) owner.trail = this.sized(owner.trail, w, h);
    const p = this.fixed('glow', GLOW_FS);
    this.bindTarget(out, w, h);
    this.use(p, w, h);
    this.tex(p, 'u_img', 0, input);
    this.tex(p, 'u_bloom', 1, chain?.bloom[0]!.tex ?? null);
    this.tex(p, 'u_streak', 2, chain?.streak[0].tex ?? null);
    this.tex(p, 'u_trail', 3, trailOn ? owner.trail!.tex : null);
    this.f(p, 'u_bloomOn', bloomOn ? 1 : 0);
    this.f(p, 'u_bloomIntensity', fin.bloom.intensity);
    this.f(p, 'u_streakOn', streakOn ? 1 : 0);
    this.f(p, 'u_streakIntensity', fin.streaks.intensity);
    this.f(p, 'u_streakTint', ...hexToRgb01(fin.streaks.tint));
    this.f(p, 'u_trailOn', trailOn ? 1 : 0);
    this.f(p, 'u_trailAmount', Math.min(0.985, fin.trails.amount));
    this.draw();
    if (trailOn) this.copy(out, owner.trail!);
    this.mip(out);
    return out;
  }

  private grade(
    owner: Owner,
    input: WebGLTexture,
    w: number,
    h: number,
    fin: CanvasFinish,
    frame: number,
  ): Target | null {
    if (!fin.grade.on && !fin.paper.on) return null;
    const out = (owner.gradeOut = this.sized(owner.gradeOut, w, h));
    const p = this.fixed('grade', GRADE_FS);
    this.bindTarget(out, w, h);
    this.use(p, w, h);
    this.tex(p, 'u_img', 0, input);
    const g = fin.grade;
    this.f(p, 'u_gradeOn', g.on ? 1 : 0);
    this.f(p, 'u_exposure', g.exposure);
    this.f(p, 'u_contrast', g.contrast);
    this.f(p, 'u_saturation', g.saturation);
    this.f(p, 'u_temperature', g.temperature);
    this.f(p, 'u_tint', g.tint);
    this.f(p, 'u_fade', g.fade);
    this.f(p, 'u_vignette', g.vignette);
    this.f(p, 'u_hue', g.hue);
    const pa = fin.paper;
    this.f(p, 'u_paperOn', pa.on ? 1 : 0);
    this.f(p, 'u_grain', pa.grain);
    this.f(p, 'u_fibres', pa.fibres);
    this.f(p, 'u_paperTint', ...hexToRgb01(pa.tint));
    this.f(p, 'u_paperTintAmount', pa.tintAmount);
    this.f(p, 'u_frame', frame);
    this.draw();
    return out;
  }

  /** The layer's background treated (brightness, blur, saturation) before its looks; null when it's left as is. */
  private subjectPrep(
    owner: Owner,
    input: WebGLTexture,
    w: number,
    h: number,
    set: SubjectSettings,
    subj: SubjectBind,
  ): Target | null {
    if (set.bgBrightness === 1 && set.bgBlur <= 0 && set.bgSaturation === 1) {
      this.free(owner.prepOut);
      owner.prepOut = null;
      return null;
    }
    const out = (owner.prepOut = this.sized(owner.prepOut, w, h));
    const p = this.fixed('subject-prep', SUBJECT_PREP_FS);
    this.bindTarget(out, w, h);
    this.use(p, w, h);
    this.tex(p, 'u_img', 0, input);
    this.bindSubject(p, subj);
    this.f(p, 'u_bgBrightness', set.bgBrightness);
    this.f(p, 'u_bgSaturation', set.bgSaturation);
    this.f(p, 'u_bgBlur', Math.max(0, Math.min(1, set.bgBlur)));
    this.draw();
    // Looks sample their input's mips.
    this.mip(out);
    return out;
  }

  /** The looks only in their part of the picture, and only the part that shows. */
  private subjectMatte(
    owner: Owner,
    picture: WebGLTexture,
    looks: WebGLTexture,
    hasLooks: boolean,
    w: number,
    h: number,
    set: SubjectSettings,
    subj: SubjectBind,
    effects: readonly EffectInstance[],
  ): Target {
    const out = (owner.matteOut = this.sized(owner.matteOut, w, h));
    const p = this.fixed('subject-matte', SUBJECT_MATTE_FS);
    this.bindTarget(out, w, h);
    this.use(p, w, h);
    this.tex(p, 'u_img', 0, picture);
    this.tex(p, 'u_fx', 1, looks);
    this.bindSubject(p, subj);
    this.f(p, 'u_looksPart', PARTS[set.looks] ?? 0);
    this.f(p, 'u_looksBlend', set.looksBlend);
    this.f(p, 'u_looksKey', KEYS[set.looksKey] ?? 0);
    // The looks' own background colour, for a key that suits it (one set against the looks keys as it says).
    const paper =
      set.looksKey !== 'off' && set.looksKey === looksKeyFor(effects, set) ? looksPaper(effects, set) : null;
    this.f(p, 'u_keyByColor', paper ? 1 : 0);
    this.f(p, 'u_keyColor', ...(paper ?? [0, 0, 0]));
    // No looks: nothing to lay over the picture (a Screen of the picture over itself would brighten it).
    this.f(p, 'u_looksMix', hasLooks ? Math.max(0, Math.min(1, set.looksMix)) : 0);
    this.f(p, 'u_showPart', PARTS[set.show] ?? 0);
    this.draw();
    // Placement samples it with textureGrad.
    this.mip(out);
    return out;
  }

  /** A single-channel W×H target for the canvas's subject mask. */
  private maskTarget(t: Target | null, w: number, h: number): Target {
    if (t && t.w === w && t.h === h) return t;
    this.free(t);
    const { gl } = this;
    const tex = this.texture(false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  /**
   * Fold one placed layer into the canvas's subject mask: its subject where it shows; elsewhere a Normal
   * layer covers, while one in another blend mode (`through`) lets the subjects below show.
   */
  private canvasMaskPass(
    mask: Target,
    layerTex: WebGLTexture,
    inv: Mat3,
    opacity: number,
    subj: SubjectBind | null,
    counts: boolean,
    through: boolean,
  ): void {
    const { gl } = this;
    const p = this.fixed('subject-mask', SUBJECT_MASK_FS);
    this.bindTarget(mask, mask.w, mask.h);
    this.use(p, mask.w, mask.h);
    this.tex(p, 'u_layer', 0, layerTex);
    this.bindSubject(p, subj);
    gl.uniformMatrix3fv(p.u.u_inv!, true, inv);
    this.f(p, 'u_opacity', opacity);
    this.f(p, 'u_subject', subj && counts ? 1 : 0);
    this.f(p, 'u_through', through ? 1 : 0);
    gl.enable(gl.BLEND);
    if (through) gl.blendEquation(gl.MAX);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.draw();
    gl.disable(gl.BLEND);
    if (through) gl.blendEquation(gl.FUNC_ADD);
  }

  // ─── Frame ───────────────────────────────────────────────────────────────

  /** Size of the buffer a layer's looks run at: what it covers on screen, capped. */
  private bufferSize(fw: number, fh: number, k: number, scale: number): [number, number] {
    let w = fw * k * Math.max(0.25, Math.min(2, scale));
    let h = fh * k * Math.max(0.25, Math.min(2, scale));
    const m = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
    w = Math.max(1, Math.round(w * m));
    h = Math.max(1, Math.round(h * m));
    return [w, h];
  }

  /** Render one frame into an internal target (see `present`). */
  renderFrame(input: RenderInput): void {
    if (this.isLost) return;
    const { gl } = this;
    const { project, width: W, height: H } = input;
    const canvas = project.canvas;
    const k = W / canvas.width;
    const still = !!input.still;
    if (!still) this.owners.forEach((o) => (o.used = false));

    const comp = still ? this.thumbComp : this.comp;
    comp[0] = this.sized(comp[0], W, H);
    comp[1] = this.sized(comp[1], W, H);
    let base = comp[0];
    let next = comp[1];

    const bg = input.background ?? backgroundColor(project);
    const clear = this.fixed('clear', CLEAR_FS);
    this.bindTarget(base, W, H);
    this.use(clear, W, H);
    this.f(clear, 'u_color', ...bg);
    this.draw();

    const layerProg = this.fixed('layer', LAYER_FS);
    // Every active layer's picture first: a layer that follows another needs the other's size.
    const frames = new Map<string, LayerFrame>();
    for (const layer of project.layers) {
      if (!layerActive(layer, input.time)) continue;
      const frame = input.frameOf(layer);
      if (frame) {
        frames.set(layer.id, frame);
        this.sizes.set(layer.id, [frame.width, frame.height]);
      }
    }
    const sizeOf = (l: Layer) => this.sizes.get(l.id) ?? null;
    // Canvas looks on the subject or background need a canvas-wide subject mask, started at the first
    // layer that has one (layers below it have nothing to cover).
    const wantMask =
      !still && project.effects.some((e) => e.enabled && e.strength > 0 && (e.appears === 6 || e.appears === 7));
    if (!wantMask && this.canvasMask) {
      this.free(this.canvasMask);
      this.canvasMask = null;
    }
    let mask: Target | null = null;
    /** A separated layer is drawn whose masks aren't there yet (being analysed, or loading). */
    let pending = false;
    for (const layer of project.layers) {
      const frame = frames.get(layer.id);
      if (!frame) continue;
      const owner = this.owner(still ? `${THUMB_OWNER}:${layer.id}` : layer.id);
      if (!owner.srcTex) owner.srcTex = this.texture(true);
      if (owner.srcVersion !== frame.version) {
        if (this.upload(owner.srcTex, frame.source)) owner.srcVersion = frame.version;
        else if (owner.srcVersion === null) continue;
      }
      const shift = followShift(project, layer, input.time, sizeOf);
      const { quad, opacity, size } = layerQuad(layer, frame.width, frame.height, canvas, input.time, shift);
      if (opacity <= 0) continue;
      const [bw, bh] = this.bufferSize(size[0], size[1], k, layer.scale);
      const sound = input.sound?.(layer) ?? 0;
      const set = layer.subject?.on ? layer.subject : null;
      if (!set && (owner.subj[0] || owner.prepOut || owner.matteOut)) this.dropSubject(owner);
      const lm = set ? (input.maskOf?.(layer) ?? null) : null;
      const subj = lm ? this.subjectFor(owner, lm) : null;
      if (set && !subj) pending = true;
      const fxCtx = {
        time: input.time,
        duration: canvas.duration,
        frame: input.frame,
        unit: bw / Math.max(1, size[0]),
        sound,
        still,
        track: trackBox(layer, input.time),
        subj,
      };
      let tex: WebGLTexture;
      if (set && subj) {
        // Background treatment → looks (which see the mask) → only the parts that show, looks where they go.
        const picture = this.subjectPrep(owner, owner.srcTex, bw, bh, set, subj)?.tex ?? owner.srcTex;
        const looks = this.runEffects(owner, picture, bw, bh, layer.effects, fxCtx);
        tex = this.subjectMatte(owner, picture, looks.tex, !!looks.target, bw, bh, set, subj, layer.effects).tex;
      } else tex = this.runEffects(owner, owner.srcTex, bw, bh, layer.effects, fxCtx).tex;
      const glowed = this.glow(owner, tex, bw, bh, layer.finish, still);
      if (glowed) tex = glowed.tex;

      const outQuad = quad.map(([x, y]) => [x * k, y * k] as [number, number]);
      const inv = invert3(squareToQuad(outQuad));
      if (!inv) continue;
      this.bindTarget(next, W, H);
      this.use(layerProg, W, H);
      this.tex(layerProg, 'u_base', 0, base.tex);
      this.tex(layerProg, 'u_layer', 1, tex);
      gl.uniformMatrix3fv(layerProg.u.u_inv!, true, inv as Mat3);
      this.f(layerProg, 'u_opacity', opacity);
      this.f(layerProg, 'u_blend', layer.blend);
      this.draw();
      [base, next] = [next, base];

      // A layer's subject counts where it shows; otherwise only a Normal layer hides what's below
      // (Screen, Add, Multiply… let the subjects below show through, and only add their own).
      const counts = !!subj && set?.show !== 'background';
      if (wantMask && (mask || subj) && (counts || layer.blend === 0)) {
        if (!mask) {
          mask = this.canvasMask = this.maskTarget(this.canvasMask, W, H);
          this.clearTarget(mask);
        }
        this.canvasMaskPass(mask, tex, inv, opacity, subj, counts, layer.blend !== 0);
      }
    }
    // No separated layer shows a subject this frame (before or after its clip, hidden, faded out): there are
    // no subjects, so looks on the subject show nowhere and looks on the background everywhere. Only with
    // nothing separated at all, or masks still on their way, do they fall back to the whole canvas, as a
    // layer's own looks do.
    if (wantMask && !mask && !pending && project.layers.some((l) => l.subject?.on)) {
      mask = this.canvasMask = this.maskTarget(this.canvasMask, W, H);
      this.clearTarget(mask);
    }

    // The whole canvas: looks, finish, grade & paper.
    const owner = this.owner(still ? THUMB_OWNER : CANVAS_OWNER);
    let out: Target = base;
    const liveFx = project.effects.some((e) => e.enabled && e.strength > 0);
    if (liveFx) {
      this.mip(base);
      const sound = input.sound?.(null) ?? 0;
      const r = this.runEffects(owner, base.tex, W, H, project.effects, {
        time: input.time,
        duration: canvas.duration,
        frame: input.frame,
        unit: k,
        sound,
        still,
        subj: mask && { a: mask.tex, b: mask.tex, rectA: WHOLE, rectB: WHOLE, mix: 0, outside: 0 },
      });
      if (r.target) out = r.target;
    }
    const glowed = this.glow(owner, out.tex, W, H, project.finish, still);
    if (glowed) out = glowed;
    const graded = this.grade(owner, out.tex, W, H, project.finish, input.frame);
    if (graded) out = graded;
    this.last = out;

    if (!still) {
      for (const [id, o] of this.owners) if (!o.used && !id.startsWith(THUMB_OWNER)) this.dropOwner(id);
    }
  }

  /** Put the last frame on the canvas (resizing it to the frame). */
  present(matte: [number, number, number, number] = [0, 0, 0, 0]): void {
    const src = this.last;
    if (!src || this.isLost) return;
    const { canvas } = this;
    if (canvas.width !== src.w || canvas.height !== src.h) {
      canvas.width = src.w;
      canvas.height = src.h;
    }
    const p = this.fixed('output', OUTPUT_FS);
    this.bindTarget(null, src.w, src.h);
    this.use(p, src.w, src.h);
    this.tex(p, 'u_img', 0, src.tex);
    this.f(p, 'u_flip', 1);
    this.f(p, 'u_matte', ...matte);
    this.draw();
  }

  render(input: RenderInput): void {
    this.renderFrame(input);
    this.present();
  }

  /** Motion blur: fold the last frame into a running average (`index` 0 starts a new one). */
  accumulate(index: number): void {
    const src = this.last;
    if (!src) return;
    this.acc[0] = this.sized(this.acc[0], src.w, src.h);
    this.acc[1] = this.sized(this.acc[1], src.w, src.h);
    const [a, b] = this.acc;
    if (index === 0) {
      this.copy(src, a!);
      this.last = a;
      return;
    }
    const p = this.fixed('accum', ACCUM_FS);
    this.bindTarget(b!, src.w, src.h);
    this.use(p, src.w, src.h);
    this.tex(p, 'u_img', 0, src.tex);
    this.tex(p, 'u_acc', 1, a!.tex);
    this.f(p, 'u_weight', 1 / (index + 1));
    this.draw();
    this.acc = [b, a];
    this.last = b;
  }

  /** The last frame's pixels, top row first. */
  readPixels(): ImageData | null {
    const src = this.last;
    if (!src) return null;
    const { gl } = this;
    const data = new Uint8ClampedArray(src.w * src.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
    gl.readPixels(0, 0, src.w, src.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(data, src.w, src.h);
  }

  /** Copy a texture into a fresh target at another size (used for thumbnails of big sources). */
  resample(source: TexImageSource, w: number, h: number): ImageData | null {
    const { gl } = this;
    const tex = this.texture(true);
    this.upload(tex, source);
    const t = this.target(w, h);
    const p = this.fixed('copy', COPY_FS);
    this.bindTarget(t, w, h);
    this.use(p, w, h);
    this.tex(p, 'u_img', 0, tex);
    this.draw();
    const data = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.free(t);
    gl.deleteTexture(tex);
    return new ImageData(data, w, h);
  }

  dispose(loseContext = false): void {
    const { gl } = this;
    this.lost = true;
    if (loseContext) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return;
    }
    for (const id of [...this.owners.keys()]) this.dropOwner(id);
    this.comp.forEach((t) => this.free(t));
    this.thumbComp.forEach((t) => this.free(t));
    this.acc.forEach((t) => this.free(t));
    this.free(this.canvasMask);
    this.chains.forEach((c) => {
      c.bloom.forEach((t) => this.free(t));
      c.streak.forEach((t) => this.free(t));
    });
    this.atlases.forEach((a) => gl.deleteTexture(a.tex));
    this.programs.forEach((p) => p && gl.deleteProgram(p.prog));
    gl.deleteTexture(this.blank);
    gl.deleteVertexArray(this.vao);
  }
}
