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
