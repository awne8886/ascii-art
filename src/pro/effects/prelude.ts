/**
 * GLSL shared by every effect: the inputs every pass gets and a toolbox of
 * helpers. Coordinates: `uv` is 0–1 across the layer with (0, 0) at the TOP
 * left and y growing downwards, like a canvas; `u_res` is the layer's size in
 * output pixels, which depends on zoom and export size, so sizes should be
 * relative (cells across the layer) or scaled by `u_unit`. Colours are
 * straight (not premultiplied) sRGB, 0–1.
 */
export const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_src;       // the layer (mipmapped: textureLod gives area averages)
uniform sampler2D u_prev;      // this effect's previous frame (feedback effects), else transparent
uniform sampler2D u_atlas;     // glyphs, white on transparent (see glyph())
uniform vec2 u_atlasGrid;      // atlas cells: columns, rows
uniform float u_glyphCount;    // glyphs in the atlas (0 when the effect has none)
uniform float u_atlasCellPx;   // atlas cell height in texels
uniform vec2 u_res;            // output size, px
uniform float u_time;          // seconds on the timeline
uniform float u_duration;      // timeline length, seconds (for seamless loops)
uniform float u_frame;         // frame number
uniform float u_seed;          // 0–1, fixed per effect instance
uniform float u_unit;          // output px per canvas px: multiply pixel-sized params by this

#define PI 3.14159265359
#define TAU 6.28318530718

// ── Source ─────────────────────────────────────────────────────────────────

vec4 src(vec2 uv) { return texture(u_src, uv); }
vec4 srcLod(vec2 uv, float lod) { return textureLod(u_src, uv, lod); }
/** Mip level covering about px output pixels (the source can be bigger or smaller than the output). */
float srcLodFor(float px) { return max(0.0, log2(max(px, 1e-3) * float(textureSize(u_src, 0).x) / u_res.x)); }
/** Average colour of roughly a px × px area (output pixels) around uv. */
vec4 srcAvg(vec2 uv, float px) { return textureLod(u_src, uv, srcLodFor(px)); }

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lumaAt(vec2 uv) { return luma(texture(u_src, uv).rgb); }
vec3 saturation(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
vec3 contrast(vec3 c, float k) { return (c - 0.5) * k + 0.5; }

// ── Grids ──────────────────────────────────────────────────────────────────

struct Cell {
  vec2 id;      // integer cell coordinates
  vec2 p;       // 0–1 inside the cell, y down
  vec2 center;  // cell centre in uv
};

/** Split the layer into cells of cellPx (width, height) output pixels. */
Cell grid(vec2 uv, vec2 cellPx) {
  vec2 px = uv * u_res / cellPx;
  Cell c;
  c.id = floor(px);
  c.p = fract(px);
  c.center = (c.id + 0.5) * cellPx / u_res;
  return c;
}

/** Glyph ink (0–1) of atlas glyph index at p (0–1 in the cell, y down), for a cell cellPx tall on screen. */
float glyph(float index, vec2 p, float cellPx) {
  if (u_glyphCount < 0.5 || p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 0.0;
  float i = clamp(floor(index + 0.5), 0.0, u_glyphCount - 1.0);
  vec2 cell = vec2(mod(i, u_atlasGrid.x), floor(i / u_atlasGrid.x));
  vec2 auv = (cell + p) / u_atlasGrid;
  // A little sharper than trilinear would pick: small glyphs stay legible instead of turning grey.
  float lod = max(0.0, log2(u_atlasCellPx / max(cellPx, 1.0)) - 0.5);
  return textureLod(u_atlas, auv, lod).a;
}

/** Index into an ink-sorted ramp for tone t (0–1). */
float rampIndex(float t) { return floor(clamp(t, 0.0, 1.0) * (u_glyphCount - 1.0) + 0.5); }

// ── Noise ──────────────────────────────────────────────────────────────────

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

/** Ordered-dither thresholds, 0–1. */
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// ── Colour ─────────────────────────────────────────────────────────────────

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

/** Shadow → base → highlight ramp of a colour, like the pizza's hand-made materials. */
vec3 materialRamp(vec3 base, float t) {
  vec3 shadow = mix(base * 0.42, vec3(luma(base) * 0.42), 0.25) * vec3(1.08, 0.94, 0.86);
  vec3 high = mix(base, vec3(1.0, 0.96, 0.82), 0.45) * 1.08;
  return t < 0.5 ? mix(shadow, base, t * 2.0) : mix(base, high, (t - 0.5) * 2.0);
}

/** Three-stop gradient. */
vec3 ramp3(vec3 a, vec3 b, vec3 c, float t) { return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0); }

// ── Shapes ─────────────────────────────────────────────────────────────────

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
/** Coverage of a signed distance d (negative inside) with an edge w wide. */
float fill(float d, float w) { return clamp(0.5 - d / max(w, 1e-5), 0.0, 1.0); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRoundBox(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdSegment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

// ── Edges ──────────────────────────────────────────────────────────────────

/** Luma gradient (Sobel) at uv, with taps px output pixels apart. */
vec2 sobel(vec2 uv, float px) {
  vec2 o = px / u_res;
  float tl = lumaAt(uv + vec2(-o.x, -o.y)), t = lumaAt(uv + vec2(0.0, -o.y)), tr = lumaAt(uv + vec2(o.x, -o.y));
  float l = lumaAt(uv + vec2(-o.x, 0.0)), r = lumaAt(uv + vec2(o.x, 0.0));
  float bl = lumaAt(uv + vec2(-o.x, o.y)), b = lumaAt(uv + vec2(0.0, o.y)), br = lumaAt(uv + vec2(o.x, o.y));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  return vec2(gx, gy);
}

// ── Blend modes (shared with the compositor) ───────────────────────────────

vec3 blendRGB(vec3 b, vec3 s, int mode) {
  if (mode == 1) return b * s;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (mode == 4) return min(b + s, 1.0);
  if (mode == 5) return abs(b - s);
  if (mode == 6) return (1.0 - 2.0 * s) * b * b + 2.0 * s * b;
  if (mode == 7) return max(b, s);
  if (mode == 8) return min(b, s);
  if (mode == 9) return clamp(s + (luma(b) - luma(s)), 0.0, 1.0);
  if (mode == 10) return clamp(b + (luma(s) - luma(b)), 0.0, 1.0);
  if (mode == 11) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  return s;
}
`;

/** The wrapper around an effect's `effect(uv)`: strength, blend and where it appears. */
export const EFFECT_MAIN = /* glsl */ `
uniform float u_strength;
uniform float u_blend;
uniform float u_appears;       // 0 everywhere, 1 brights, 2 darks, 3 centre, 4 edges
uniform float u_appearsSoft;
uniform float u_appearsInvert;
out vec4 fragColor;

float appearsIn(vec2 uv, vec4 base) {
  int a = int(u_appears + 0.5);
  if (a == 0) return 1.0;
  float s = max(u_appearsSoft, 0.02);
  float m;
  if (a == 1) m = smoothstep(0.5 - s, 0.5 + s, luma(base.rgb));
  else if (a == 2) m = 1.0 - smoothstep(0.5 - s, 0.5 + s, luma(base.rgb));
  else if (a == 3) {
    vec2 d = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    m = 1.0 - smoothstep(0.32 - s * 0.5, 0.32 + s * 0.5, length(d));
  } else {
    m = smoothstep(0.1, 0.1 + s, length(sobel(uv, 1.5)));
  }
  return u_appearsInvert > 0.5 ? 1.0 - m : m;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 base = texture(u_src, uv);
  vec4 fx = clamp(effect(uv), 0.0, 1.0);
  float m = u_strength * appearsIn(uv, base);
  vec3 blended = blendRGB(base.rgb, fx.rgb, int(u_blend + 0.5));
  // Over a transparent base the effect's own colour shows as-is.
  blended = mix(fx.rgb, blended, base.a);
  fragColor = vec4(mix(base.rgb, blended, m), mix(base.a, fx.a, m));
}
`;

export const BLEND_MODES = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Multiply' },
  { value: 2, label: 'Screen' },
  { value: 3, label: 'Overlay' },
  { value: 4, label: 'Add' },
  { value: 5, label: 'Difference' },
  { value: 6, label: 'Soft light' },
  { value: 7, label: 'Lighten' },
  { value: 8, label: 'Darken' },
  { value: 9, label: 'Colour' },
  { value: 10, label: 'Luminosity' },
  { value: 11, label: 'Hard light' },
] as const;
