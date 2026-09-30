import { PRELUDE } from '../effects/prelude';

/**
 * The studio's fixed passes. Every target stores the picture with its top
 * row at texture row 0 (so `gl_FragCoord.xy / u_res` is a y-down uv), and
 * straight alpha; only the final pass to the screen flips and premultiplies.
 */

/** One oversized triangle covering the target. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const HEAD = `${PRELUDE}
in vec2 vUv;
out vec4 fragColor;
`;

/** Solid fill (the canvas background). */
export const CLEAR_FS = /* glsl */ `${HEAD}
uniform vec4 u_color;
void main() { fragColor = u_color; }
`;

/** Copy (optionally resampling) a texture. */
export const COPY_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
void main() { fragColor = texture(u_img, gl_FragCoord.xy / u_res); }
`;

/** One layer over the canvas so far, through the inverse of its (projective) placement. */
export const LAYER_FS = /* glsl */ `${HEAD}
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform mat3 u_inv;       // output px -> layer uv (homogeneous)
uniform float u_opacity;
uniform float u_blend;
void main() {
  vec2 px = gl_FragCoord.xy;
  vec4 base = texelFetch(u_base, ivec2(px), 0);
  vec3 q = u_inv * vec3(px, 1.0);
  vec2 uv = q.xy / (abs(q.z) < 1e-6 ? 1e-6 : q.z);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 L = textureGrad(u_layer, clamp(uv, 0.0, 1.0), dx, dy);
  vec2 fw = abs(dx) + abs(dy);
  vec2 edge = min(uv, 1.0 - uv) / max(fw, vec2(1e-6));
  float cov = q.z > 0.0 ? clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0) : 0.0;
  float a = L.a * u_opacity * cov;
  vec3 blended = mix(L.rgb, blendRGB(base.rgb, L.rgb, int(u_blend + 0.5)), base.a);
  float outA = a + base.a * (1.0 - a);
  vec3 rgb = (blended * a + base.rgb * base.a * (1.0 - a)) / max(outA, 1e-5);
  fragColor = vec4(rgb, outA);
}
`;

/** Mix of two straight-alpha colours, done premultiplied so a see-through one adds no colour. */
const MIX_PREMUL = /* glsl */ `
vec4 mixPremul(vec4 a, vec4 b, float t) {
  vec4 p = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), t);
  return vec4(p.rgb / max(p.a, 1e-5), p.a);
}
/** Share of a picture in a part: 0 all, 1 the subject (m), 2 the background. */
float partOf(float part, float m) { return part < 0.5 ? 1.0 : part < 1.5 ? m : 1.0 - m; }
`;

/**
 * A layer's background before its looks: brightness, saturation and a blur
 * (a golden-angle disc of taps at the mip level matching their spacing,
 * weighted towards background taps so the subject doesn't bleed into it),
 * kept only where the subject mask says background.
 */
export const SUBJECT_PREP_FS = /* glsl */ `${HEAD}${MIX_PREMUL}
uniform sampler2D u_img;        // the layer's picture (mipmapped)
uniform float u_bgBrightness;   // 1 as is
uniform float u_bgSaturation;   // 1 as is
uniform float u_bgBlur;         // 0–1
const int TAPS = 32;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 c = texture(u_img, uv);
  vec4 t = c;
  if (u_bgBlur > 0.0) {
    // Radius: up to 3% of the layer's height, whatever the buffer's size.
    float r = u_bgBlur * 0.03;
    vec2 R = vec2(r * u_res.y / u_res.x, r);
    float lod = max(0.0, log2(r * float(textureSize(u_img, 0).y) * 0.3));
    vec4 accAll = vec4(0.0);
    vec4 accBg = vec4(0.0);
    float wAll = 0.0;
    float wBg = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float fi = float(i) + 0.5;
      float d = sqrt(fi / float(TAPS));
      float th = fi * 2.39996323;
      vec2 tap = uv + vec2(cos(th), sin(th)) * d * R;
      vec4 s = textureLod(u_img, tap, lod);
      vec4 sp = vec4(s.rgb * s.a, s.a);
      float w = 1.0 - 0.6 * d * d;
      float wb = w * (1.0 - subjectAt(tap));
      accAll += sp * w;
      wAll += w;
      accBg += sp * wb;
      wBg += wb;
    }
    // Deep inside the subject there are no background taps: fall back to all of them.
    vec4 blur = mix(accAll / wAll, accBg / max(wBg, 1e-4), clamp(wBg / (wAll * 0.15), 0.0, 1.0));
    t = vec4(blur.rgb / max(blur.a, 1e-5), blur.a);
  }
  t.rgb = clamp(saturation(t.rgb, u_bgSaturation) * u_bgBrightness, 0.0, 1.0);
  fragColor = mixPremul(t, c, subjectAt(uv));
}
`;

/**
 * A separated layer's composition: its looks only in their part (combined
 * with the untouched picture like a look with its base: blend mode, then
 * strength), and only the part of the layer that shows keeps its alpha.
 * With a key, the looks' own dark (or light) background drops away in their
 * part, so only their marks (characters, dots, lines) sit on the picture; a
 * background colour that's neither dark nor light enough for that (a
 * blueprint blue, a surprise colour) is keyed out by its colour.
 */
export const SUBJECT_MATTE_FS = /* glsl */ `${HEAD}${MIX_PREMUL}
uniform sampler2D u_img;        // the untouched picture (background treated)
uniform sampler2D u_fx;         // the layer's looks over it
uniform float u_looksPart;      // 0 all, 1 subject, 2 background
uniform float u_looksBlend;
uniform float u_looksKey;       // 0 off, 1 drop dark, 2 drop light
uniform float u_looksMix;       // 0 when the layer has no looks
uniform float u_showPart;       // 0 all, 1 subject, 2 background
uniform vec3 u_keyColor;        // the looks' own background colour…
uniform float u_keyByColor;     // …1 when it's known and the key suits it
// The key's soft edges. Dark, on the looks' brightest channel: black and near-black cells (up to about
// #181818) drop, while the ASCII look's glyphs stay solid even where the picture is dim (on the sample
// clip, 99% of glyph pixels are above 0.19). Light, on 1 - the darkest channel: white and cream paper
// (#f5ecd7 is 0.16 from white) drop, ink stays.
const vec2 KEY_DARK = vec2(0.08, 0.22);
const vec2 KEY_LIGHT = vec2(0.2, 0.45);
// How much of a colour the key keeps: 1 − its distance from black (dark) or white (light) on the soft edges.
float keyKeeps(vec3 c) {
  if (u_looksKey > 1.5) return smoothstep(KEY_LIGHT.x, KEY_LIGHT.y, 1.0 - min(c.r, min(c.g, c.b)));
  return smoothstep(KEY_DARK.x, KEY_DARK.y, max(c.r, max(c.g, c.b)));
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 base = texture(u_img, uv);
  vec4 fx = texture(u_fx, uv);
  float m = subjectAt(uv);
  vec3 blended = blendRGB(base.rgb, fx.rgb, int(u_looksBlend + 0.5));
  // Over a transparent base the looks' own colour shows as-is.
  blended = mix(fx.rgb, blended, base.a);
  float key = 1.0;
  if (u_looksKey > 0.5) {
    key = keyKeeps(fx.rgb);
    // A background the key can't drop: key on its distance from that colour instead (for black paper, the
    // same as the dark key).
    if (u_keyByColor > 0.5 && keyKeeps(u_keyColor) > 0.02) {
      vec3 d = abs(fx.rgb - u_keyColor);
      key = smoothstep(KEY_DARK.x, KEY_DARK.y, max(d.r, max(d.g, d.b)));
    }
  }
  vec4 c = mixPremul(base, vec4(blended, fx.a), partOf(u_looksPart, m) * u_looksMix * key);
  fragColor = vec4(c.rgb, c.a * partOf(u_showPart, m));
}
`;

/**
 * The canvas's subject mask, one placed layer at a time. A Normal-blended
 * layer goes over what's there (SRC_ALPHA, ONE_MINUS_SRC_ALPHA): its subject
 * where it shows, so without one (or showing only its background) it covers
 * the subjects below it. Layers in other blend modes (Screen, Add, Multiply…)
 * let what's below show through them: their subject only adds to the mask
 * (blend equation MAX), and without one they're skipped. Same placement
 * maths as LAYER_FS.
 */
export const SUBJECT_MASK_FS = /* glsl */ `${HEAD}
uniform sampler2D u_layer;
uniform mat3 u_inv;
uniform float u_opacity;
uniform float u_subject;        // 1: the layer's subject counts, 0: it only covers
uniform float u_through;        // 1: not blended Normal, so its subject only adds (under MAX)
void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 q = u_inv * vec3(px, 1.0);
  vec2 uv = q.xy / (abs(q.z) < 1e-6 ? 1e-6 : q.z);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 L = textureGrad(u_layer, clamp(uv, 0.0, 1.0), dx, dy);
  vec2 fw = abs(dx) + abs(dy);
  vec2 edge = min(uv, 1.0 - uv) / max(fw, vec2(1e-6));
  float cov = q.z > 0.0 ? clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0) : 0.0;
  float s = u_subject > 0.5 ? subjectAt(clamp(uv, 0.0, 1.0)) : 0.0;
  float a = L.a * u_opacity * cov;
  fragColor = u_through > 0.5 ? vec4(s * a, 0.0, 0.0, 1.0) : vec4(s, 0.0, 0.0, a);
}
`;

/** Bloom / streak bright pass: 4 taps, soft-knee threshold. */
export const BRIGHT_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform vec2 u_texel;
uniform float u_threshold;
void main() {
  vec4 s = texture(u_img, vUv + u_texel * vec2(-1.0, -1.0)) + texture(u_img, vUv + u_texel * vec2(1.0, -1.0))
    + texture(u_img, vUv + u_texel * vec2(-1.0, 1.0)) + texture(u_img, vUv + u_texel * vec2(1.0, 1.0));
  s *= 0.25;
  vec3 c = s.rgb * s.a;
  float br = max(c.r, max(c.g, c.b));
  float knee = max(0.05, u_threshold * 0.5);
  float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - u_threshold) / max(br, 1e-4);
  fragColor = vec4(c * w, 1.0);
}
`;

/** Dual-Kawase down. */
export const DOWN_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform vec2 u_texel;
void main() {
  vec2 h = u_texel;
  vec3 s = texture(u_img, vUv).rgb * 4.0 + texture(u_img, vUv - h).rgb + texture(u_img, vUv + h).rgb
    + texture(u_img, vUv + vec2(h.x, -h.y)).rgb + texture(u_img, vUv - vec2(h.x, -h.y)).rgb;
  fragColor = vec4(s * 0.125, 1.0);
}
`;

/** Dual-Kawase up (added onto the level above). */
export const UP_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform vec2 u_texel;
void main() {
  vec2 h = u_texel;
  vec3 s = texture(u_img, vUv + vec2(-2.0 * h.x, 0.0)).rgb + texture(u_img, vUv + vec2(-h.x, h.y)).rgb * 2.0
    + texture(u_img, vUv + vec2(0.0, 2.0 * h.y)).rgb + texture(u_img, vUv + vec2(h.x, h.y)).rgb * 2.0
    + texture(u_img, vUv + vec2(2.0 * h.x, 0.0)).rgb + texture(u_img, vUv + vec2(h.x, -h.y)).rgb * 2.0
    + texture(u_img, vUv + vec2(0.0, -2.0 * h.y)).rgb + texture(u_img, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  fragColor = vec4(s / 12.0, 1.0);
}
`;

/** Horizontal streak blur, 9 taps spread `u_spread` texels apart. */
export const STREAK_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform vec2 u_texel;
uniform float u_spread;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) / 8.0);
    acc += texture(u_img, vUv + vec2(float(i) * u_spread * u_texel.x, 0.0)).rgb * w;
    wsum += w;
  }
  fragColor = vec4(acc / wsum * 1.15, 1.0);
}
`;

/** Adds bloom and streaks, keeps trails. */
export const GLOW_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform sampler2D u_bloom;
uniform sampler2D u_streak;
uniform sampler2D u_trail;
uniform float u_bloomOn;
uniform float u_bloomIntensity;
uniform float u_streakOn;
uniform float u_streakIntensity;
uniform vec3 u_streakTint;
uniform float u_trailOn;
uniform float u_trailAmount;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 c = texture(u_img, uv);
  vec3 add = vec3(0.0);
  if (u_bloomOn > 0.5) add += texture(u_bloom, uv).rgb * u_bloomIntensity;
  if (u_streakOn > 0.5) add += texture(u_streak, uv).rgb * u_streakTint * u_streakIntensity * 1.6;
  vec3 rgb = c.rgb * c.a + add;
  float a = clamp(max(c.a, max(add.r, max(add.g, add.b))), 0.0, 1.0);
  vec4 outc = vec4(rgb / max(a, 1e-4), a);
  if (u_trailOn > 0.5) {
    vec4 p = texture(u_trail, uv) * u_trailAmount;
    outc = vec4(max(outc.rgb * outc.a, p.rgb * p.a), max(outc.a, p.a));
    outc.rgb /= max(outc.a, 1e-4);
  }
  fragColor = vec4(clamp(outc.rgb, 0.0, 1.0), outc.a);
}
`;

/** Colour grade, then paper grain and fibres. */
export const GRADE_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform float u_gradeOn;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;
uniform float u_fade;
uniform float u_vignette;
uniform float u_hue;
uniform float u_paperOn;
uniform float u_grain;
uniform float u_fibres;
uniform vec3 u_paperTint;
uniform float u_paperTintAmount;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 c = texture(u_img, uv);
  vec3 rgb = c.rgb;
  if (u_gradeOn > 0.5) {
    rgb *= exp2(u_exposure);
    rgb += vec3(u_temperature, 0.0, -u_temperature) * 0.12 + vec3(0.0, u_tint, 0.0) * 0.1;
    rgb = (rgb - 0.5) * u_contrast + 0.5;
    if (abs(u_hue) > 0.001) { vec3 h = rgb2hsv(clamp(rgb, 0.0, 1.0)); h.x = fract(h.x + u_hue / 360.0); rgb = hsv2rgb(h); }
    rgb = saturation(rgb, u_saturation);
    rgb = mix(rgb, vec3(0.08) + rgb * 0.84, u_fade);
    vec2 d = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    rgb *= 1.0 - u_vignette * smoothstep(0.35, 1.05, length(d));
  }
  if (u_paperOn > 0.5) {
    vec2 px = gl_FragCoord.xy;
    float scale = u_res.y / 1080.0;
    float fib = fbm(px / (3.0 * scale) * vec2(0.08, 0.9)) * 0.6 + fbm(px / (40.0 * scale)) * 0.4;
    rgb *= 1.0 - u_fibres * 0.18 * (fib - 0.5) * 2.0;
    rgb = mix(rgb, rgb * u_paperTint, u_paperTintAmount);
    float g = hash13(vec3(floor(px / max(scale, 1.0)), u_frame)) - 0.5;
    rgb += g * u_grain * 0.16;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

/** Running average (motion blur): mix the new sub-frame in with weight u_weight. */
export const ACCUM_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform sampler2D u_acc;
uniform float u_weight;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  fragColor = mix(texture(u_acc, uv), texture(u_img, uv), u_weight);
}
`;

/** To the screen: flip to GL's bottom-up rows, premultiply, optional solid matte behind. */
export const OUTPUT_FS = /* glsl */ `${HEAD}
uniform sampler2D u_img;
uniform float u_flip;
uniform vec4 u_matte;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  if (u_flip > 0.5) uv.y = 1.0 - uv.y;
  vec4 c = texture(u_img, uv);
  vec3 rgb = c.rgb * c.a + u_matte.rgb * u_matte.a * (1.0 - c.a);
  float a = c.a + u_matte.a * (1.0 - c.a);
  fragColor = vec4(rgb, a);
}
`;
