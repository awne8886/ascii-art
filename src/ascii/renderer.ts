import { type GlyphAtlas } from './glyphs';
import { type GridLayout } from './layout';
import { CELL_STRIDE } from './cells';
import { COMPOSITE_FS, DOWN_FS, FULLSCREEN_VS, GLYPH_FS, GLYPH_VS, PREFILTER_FS, STAR_VS, UP_FS } from './shaders';

/**
 * WebGL2 colour-ASCII renderer.
 *
 * Same idea as the pizza renderer, which blits pre-drawn glyph sprites with
 * `drawImage`: here every cell is one instanced quad sampling a glyph atlas,
 * and the per-frame maths (rippling rows, diagonal light bands, sparse
 * flicker, shadow → base → highlight colour levels, glow on the brightest
 * levels) runs in the vertex shader. Glyphs are drawn into an offscreen
 * target, then bloomed (bright-pass + dual-Kawase blur chain) and composited
 * with the photo and the subject mask.
 */

export type CompositeMode = 0 | 1 | 2 | 3;

export interface RenderParams {
  waveAmp: number;
  waveScale: number;
  bands: number;
  sparkle: boolean;
  glyphGlow: number;
  /** Shifts glyph choice sparser (−) or denser (+), in fractions of the ramp. */
  density: number;
  edges: boolean;
  bloom: boolean;
  bloomIntensity: number;
  bloomRadius: number;
  bloomThreshold: number;
  mode: CompositeMode;
  photoUnder: number;
  bgDim: number;
  bgBlur: number;
}

export interface Star {
  x: number;
  y: number;
  glyph: number;
  base: number;
  amp: number;
  period: number;
  phase: number;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

const MIN_COVERAGE = 0.12;
const BLOOM_LEVELS = 6;
const TAU = Math.PI * 2;

export class AsciiRenderer {
  private readonly gl: WebGL2RenderingContext;
  private glyphProg!: Program;
  private starProg!: Program;
  private prefilterProg!: Program;
  private downProg!: Program;
  private upProg!: Program;
  private compositeProg!: Program;
  private vao!: WebGLVertexArrayObject;
  private starVao!: WebGLVertexArrayObject;
  private cellBuf!: WebGLBuffer;
  private starBuf!: WebGLBuffer;
  private coreTex: WebGLTexture | null = null;
  private haloTex: WebGLTexture | null = null;
  private photoTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private blankTex!: WebGLTexture;
  private glyphTarget: Target | null = null;
  private bloomTargets: Target[] = [];
  private halfFloat = false;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private layout: GridLayout | null = null;
  private atlas: GlyphAtlas | null = null;
  private cellCount = 0;
  private photoSize: [number, number] = [1, 1];
  private stars: Star[] = [];
  private starData = new Float32Array(0);

  private params: RenderParams | null = null;
  private lost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.init();
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  private init(): void {
    const { gl } = this;
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.glyphProg = this.program(GLYPH_VS, GLYPH_FS);
    this.starProg = this.program(STAR_VS, GLYPH_FS);
    this.prefilterProg = this.program(FULLSCREEN_VS, PREFILTER_FS);
    this.downProg = this.program(FULLSCREEN_VS, DOWN_FS);
    this.upProg = this.program(FULLSCREEN_VS, UP_FS);
    this.compositeProg = this.program(FULLSCREEN_VS, COMPOSITE_FS);

    this.cellBuf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.UNSIGNED_BYTE, true, CELL_STRIDE, i * 4);
      gl.vertexAttribDivisor(i, 1);
    }

    this.starBuf = gl.createBuffer()!;
    this.starVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);

    this.blankTex = this.texture(gl.LINEAR, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  }

  // ─── Resources ───────────────────────────────────────────────────────────

  private program(vs: string, fs: string): Program {
    const { gl } = this;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s) ?? ''}`);
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog) ?? ''}`);
    }
    const u: Uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (info) u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }

  private texture(min: number, mag: number): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(w: number, h: number, float: boolean): Target {
    const { gl } = this;
    const tex = this.texture(gl.LINEAR, gl.LINEAR);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private freeTarget(t: Target | null): void {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  /** CSS size of the canvas and the device pixel ratio to render at. */
  resize(width: number, height: number, dpr: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.freeTarget(this.glyphTarget);
    this.bloomTargets.forEach((t) => this.freeTarget(t));
    this.glyphTarget = this.target(w, h, false);
    this.bloomTargets = [];
    let bw = Math.max(1, Math.floor(w / 2));
    let bh = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < BLOOM_LEVELS && bw >= 2 && bh >= 2; i++) {
      this.bloomTargets.push(this.target(bw, bh, this.halfFloat));
      bw = Math.floor(bw / 2);
      bh = Math.floor(bh / 2);
    }
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  setLayout(layout: GridLayout): void {
    this.layout = layout;
  }

  setAtlas(atlas: GlyphAtlas): void {
    const { gl } = this;
    this.atlas = atlas;
    for (const [key, canvas] of [
      ['core', atlas.core],
      ['halo', atlas.glow],
    ] as const) {
      const tex = key === 'core' ? this.coreTex : this.haloTex;
      if (tex) gl.deleteTexture(tex);
      const next = this.texture(gl.NEAREST, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      if (key === 'core') this.coreTex = next;
      else this.haloTex = next;
    }
  }

  /** Packed cells (see `buildCells`), row-major, `cols` per row. */
  setCells(data: Uint8Array): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.cellCount = data.length / CELL_STRIDE;
  }

  setPhoto(source: TexImageSource | null, width = 1, height = 1): void {
    const { gl } = this;
    if (this.photoTex) gl.deleteTexture(this.photoTex);
    this.photoTex = null;
    if (!source) return;
    const tex = this.texture(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.photoTex = tex;
    this.photoSize = [width, height];
  }

  /** Subject mask, 0–255, one byte per pixel. */
  setMask(data: Uint8Array | null, width: number, height: number): void {
    const { gl } = this;
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    this.maskTex = null;
    if (!data) return;
    const tex = this.texture(gl.LINEAR, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.maskTex = tex;
  }

  /** Stars in CSS px, relative to the canvas. */
  setStars(stars: Star[]): void {
    this.stars = stars;
    this.starData = new Float32Array(stars.length * 4);
  }

  setParams(params: RenderParams): void {
    this.params = params;
  }

  // ─── Frame ───────────────────────────────────────────────────────────────

  /** Draw one frame. `time` drives the waves; `animated` enables flicker and star twinkle. */
  render(time: number, clock: number, animated: boolean, energy: number): void {
    const { gl, layout, atlas, params, glyphTarget } = this;
    if (this.isLost || !layout || !atlas || !params || !glyphTarget || !this.coreTex || !this.haloTex) return;
    const W = glyphTarget.w;
    const H = glyphTarget.h;

    // 1. Glyphs → offscreen, premultiplied.
    gl.bindFramebuffer(gl.FRAMEBUFFER, glyphTarget.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.coreTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.haloTex);

    const sprite = [atlas.spriteW, atlas.spriteH];
    const atlasSize = [atlas.core.width, atlas.core.height];
    if (this.cellCount > 0) {
      const { prog, u } = this.glyphProg;
      gl.useProgram(prog);
      gl.uniform1i(u.uCore!, 0);
      gl.uniform1i(u.uHalo!, 1);
      gl.uniform2f(u.uViewport!, W, H);
      gl.uniform1f(u.uDpr!, this.dpr);
      gl.uniform2f(u.uOrigin!, layout.x, layout.y);
      gl.uniform2f(u.uCell!, layout.cellW, layout.cellH);
      gl.uniform1i(u.uCols!, layout.cols);
      // Wave geometry follows the picture's size (≈42 rows across it, like the slice), not the glyph size.
      const refH = ((layout.rows * layout.cellH) / 42) * params.waveScale;
      gl.uniform2f(u.uRef!, refH * 0.6, refH);
      gl.uniform1f(u.uTime!, time);
      gl.uniform1f(u.uAnimated!, animated ? 1 : 0);
      gl.uniform1f(u.uWaveAmp!, params.waveAmp);
      gl.uniform1f(u.uBands!, params.bands);
      gl.uniform1f(u.uSparkle!, params.sparkle ? 1 : 0);
      gl.uniform1f(u.uEnergy!, energy);
      gl.uniform2f(u.uSprite!, sprite[0]!, sprite[1]!);
      gl.uniform1i(u.uAtlasCols!, atlas.columns);
      gl.uniform2f(u.uAtlasSize!, atlasSize[0]!, atlasSize[1]!);
      gl.uniform1i(u.uRamp!, atlas.rampLength);
      gl.uniform1i(u.uEdgeBase!, atlas.edgeBase);
      gl.uniform1f(u.uEdges!, params.edges ? 1 : 0);
      gl.uniform1f(u.uBlankFirst!, atlas.blankFirst ? 1 : 0);
      gl.uniform1f(u.uGlow!, params.glyphGlow);
      gl.uniform1f(u.uMinCov!, MIN_COVERAGE);
      gl.uniform1f(u.uDensity!, params.density);
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.cellCount);
    }

    if (this.stars.length > 0) {
      this.stars.forEach((s, i) => {
        const tw = animated ? Math.sin((clock / s.period) * TAU + s.phase) : 0;
        this.starData.set(
          [s.x, s.y, atlas.starBase + s.glyph, Math.max(0.18, Math.min(0.35, s.base + s.amp * tw))],
          i * 4,
        );
      });
      const { prog, u } = this.starProg;
      gl.useProgram(prog);
      gl.uniform1i(u.uCore!, 0);
      gl.uniform1i(u.uHalo!, 1);
      gl.uniform2f(u.uViewport!, W, H);
      gl.uniform1f(u.uDpr!, this.dpr);
      gl.uniform2f(u.uSprite!, sprite[0]!, sprite[1]!);
      gl.uniform1i(u.uAtlasCols!, atlas.columns);
      gl.uniform2f(u.uAtlasSize!, atlasSize[0]!, atlasSize[1]!);
      gl.bindVertexArray(this.starVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.starData, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.stars.length);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // 2. Bloom.
    const bloomOn = params.bloom && params.bloomIntensity > 0 && this.bloomTargets.length > 0;
    if (bloomOn) this.bloom(params);

    // 3. Composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const { prog, u } = this.compositeProg;
    gl.useProgram(prog);
    const bind = (unit: number, tex: WebGLTexture | null, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex ?? this.blankTex);
      gl.uniform1i(u[name]!, unit);
    };
    bind(0, glyphTarget.tex, 'uGlyphs');
    bind(1, bloomOn ? this.bloomTargets[0]!.tex : null, 'uBloom');
    bind(2, this.photoTex, 'uPhoto');
    bind(3, this.maskTex, 'uMask');
    gl.uniform2f(u.uViewport!, W, H);
    gl.uniform1f(u.uDpr!, this.dpr);
    gl.uniform2f(u.uOrigin!, layout.x, layout.y);
    gl.uniform2f(u.uGridSize!, layout.cols * layout.cellW, layout.rows * layout.cellH);
    gl.uniform2f(u.uPhotoSize!, this.photoSize[0], this.photoSize[1]);
    gl.uniform1i(u.uMode!, params.mode);
    gl.uniform1f(u.uHasPhoto!, this.photoTex ? 1 : 0);
    gl.uniform1f(u.uHasMask!, this.maskTex ? 1 : 0);
    gl.uniform1f(u.uPhotoUnder!, params.photoUnder);
    gl.uniform1f(u.uBgDim!, params.bgDim);
    gl.uniform1f(u.uBgBlur!, params.bgBlur);
    gl.uniform1f(u.uBloomOn!, bloomOn ? 1 : 0);
    gl.uniform1f(u.uBloomIntensity!, params.bloomIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bloom(params: RenderParams): void {
    const { gl, glyphTarget } = this;
    const levels = this.bloomTargets;
    const pass = (p: Program, src: Target, dst: Target, texelScale: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.useProgram(p.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(p.u.uSrc!, 0);
      gl.uniform2f(p.u.uTexel!, texelScale / src.w, texelScale / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // Bright pass into the half-resolution level.
    const pre = this.prefilterProg;
    gl.useProgram(pre.prog);
    gl.uniform1f(pre.u.uThreshold!, params.bloomThreshold);
    gl.uniform1f(pre.u.uKnee!, Math.max(0.05, params.bloomThreshold * 0.5));
    pass(pre, glyphTarget!, levels[0]!, 1);
    // Down the chain…
    for (let i = 1; i < levels.length; i++) pass(this.downProg, levels[i - 1]!, levels[i]!, 0.5);
    // …and back up, adding each wider level onto the one above. `scatter` weights the wide levels: the radius.
    const scatter = 0.35 + 0.6 * params.bloomRadius;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE);
    gl.blendColor(scatter, scatter, scatter, 1);
    for (let i = levels.length - 1; i > 0; i--) pass(this.upProg, levels[i]!, levels[i - 1]!, 0.5);
    gl.disable(gl.BLEND);
  }

  /**
   * Free GPU resources. `loseContext` also drops the context itself: only for
   * throwaway canvases (exports), since a canvas hands back the same, now
   * dead, context forever after.
   */
  dispose(loseContext = false): void {
    const { gl } = this;
    this.lost = true;
    if (loseContext) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return;
    }
    this.freeTarget(this.glyphTarget);
    this.bloomTargets.forEach((t) => this.freeTarget(t));
    for (const tex of [this.coreTex, this.haloTex, this.photoTex, this.maskTex, this.blankTex]) gl.deleteTexture(tex);
    gl.deleteBuffer(this.cellBuf);
    gl.deleteBuffer(this.starBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.starVao);
    for (const p of [
      this.glyphProg,
      this.starProg,
      this.prefilterProg,
      this.downProg,
      this.upProg,
      this.compositeProg,
    ]) {
      gl.deleteProgram(p.prog);
    }
  }
}
