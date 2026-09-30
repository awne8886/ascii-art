/**
 * GLSL for the renderer. The glyph vertex shader is the original per-frame
 * loop (see the pizza renderer's `draw`), moved onto the GPU so every cell of
 * a photo can ripple at full frame rate.
 */

export const GLYPH_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec4 aShadow; // rgb, tone
layout(location = 1) in vec4 aBase;   // rgb, coverage
layout(location = 2) in vec4 aHigh;   // rgb, random
layout(location = 3) in vec4 aMeta;   // relative lightness, density bias, floor, edge

uniform vec2 uViewport;   // render target size, device px
uniform float uDpr;
uniform vec2 uOrigin;     // grid top-left, CSS px
uniform vec2 uCell;       // cell size, CSS px
uniform int uCols;
uniform vec2 uRef;        // wave geometry unit, CSS px
uniform float uTime;
uniform float uAnimated;
uniform float uWaveAmp;
uniform float uBands;
uniform float uSparkle;
uniform float uEnergy;
uniform vec2 uSprite;     // sprite size, device px
uniform int uAtlasCols;
uniform vec2 uAtlasSize;
uniform int uRamp;
uniform int uEdgeBase;
uniform float uEdges;
uniform float uBlankFirst;
uniform float uGlow;
uniform float uMinCov;
uniform float uDensity;

out vec2 vUv;
out vec3 vColor;
out float vGlow;
out float vAlpha;

const float TAU = 6.28318530718;
const float LEVELS = 12.0;
const float GLOW_FROM = 7.0;

// The original's hash2 (Math.imul wraps exactly like uint multiplication).
float hash2(uint a, uint b) {
  uint h = ((a ^ 0x9e3779b9u) * 0x85ebca6bu) ^ ((b + 0x7f4a7c15u) * 0xc2b2ae35u);
  h = (h ^ (h >> 16u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}

void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = vec2(0.0);
  vColor = vec3(0.0);
  vGlow = 0.0;
  vAlpha = 0.0;
}

void main() {
  float cov = aBase.a;
  if (cov < uMinCov) { cull(); return; }

  int id = gl_InstanceID;
  vec2 cr = vec2(float(id % uCols), float(id / uCols));
  // Waves are pinned to the picture, not the screen.
  vec2 local = (cr + 0.5) * uCell;
  float x = local.x;
  float y = local.y;
  float t = uTime;

  float lambdaX = uRef.x * 34.0;
  float lambdaY = uRef.y * 60.0;
  float bandScale = uRef.x * 26.0;
  float rowWave = uRef.y * 22.0;

  // Rippling rows ("fabric" motion).
  float w1 = sin(TAU * (x / lambdaX + y / lambdaY) - 0.55 * t);
  float w2 = sin(TAU * (x / (lambdaX * 0.6) - y / (lambdaY * 0.8)) + 0.8 * t + 1.7);
  float dy = uCell.y * 0.55 * uWaveAmp * (0.7 * w1 + 0.3 * w2);
  float dx = uCell.x * 0.25 * uWaveAmp * sin(TAU * y / (uRef.y * 18.0) + 0.4 * t);

  // Diagonal light bands with wavy edges.
  float u = (x * 0.85 + y * 0.55) / bandScale;
  float warp = 0.9 * sin(TAU * y / rowWave + 0.35 * t) + 0.5 * w1;
  float b = 0.5 + 0.5 * sin(TAU * u - 0.9 * t + warp);
  b = b * b * (3.0 - 2.0 * b);
  float band = (b - 0.5) * uBands;
  float drift = 0.05 * min(uBands, 1.0) * sin(0.3 * t + x / uRef.x * 0.036 - y / uRef.y * 0.0375);

  float spark = 0.0;
  float jitter = 0.0;
  if (uAnimated > 0.5 && uSparkle > 0.5) {
    float h = hash2(uint(id), uint(floor(t * 1.7 + aHigh.a * 13.0)));
    if (h > 0.965) spark = 0.28;
    else if (h > 0.93) jitter = h > 0.9475 ? 1.0 : -1.0;
  }

  float tone = aShadow.a;
  float rel = (aMeta.r * 2.0 - 1.0) * 0.5;
  float dens = floor(aMeta.g * 255.0 + 0.5) - 8.0;
  float flo = aMeta.b;
  float edge = floor(aMeta.a * 255.0 + 0.5);

  // Position on the material's shadow → base → highlight ramp; like the original, glyphs sit a little
  // above the base colour on average (its v averages 0.4 + 0.54 · ½).
  float p = 0.62 + rel * 1.6 + band * 0.9 + drift + uEnergy * 0.1 + spark;
  p = max(p, flo);
  p *= 0.5 + 0.5 * min(1.0, cov * 1.3);
  p = clamp(p, 0.0, 1.0);
  float level = floor(p * (LEVELS - 1.0) + 0.5);
  float lt = level / (LEVELS - 1.0);
  vec3 glint = mix(aHigh.rgb, vec3(1.0, 0.98, 0.94), 0.3);
  vec3 col = lt < 0.5 ? mix(aShadow.rgb, aBase.rgb, lt / 0.5)
    : lt < 0.92 ? mix(aBase.rgb, aHigh.rgb, (lt - 0.5) / 0.42)
    : glint;

  // Glyph: lightness picks the density, the bands and sparkle push it around.
  float gt = tone + uDensity + band * 0.35 + spark * 0.5 + uEnergy * 0.05;
  float gf = floor(gt * float(uRamp - 1) + 0.5) + dens + jitter;
  if (cov < 0.35) gf = min(gf, 1.0);
  int g = int(clamp(gf, 0.0, float(uRamp - 1)));
  if (uEdges > 0.5 && edge > 0.5 && cov >= 0.35) {
    g = uEdgeBase + int(edge) - 1;
  } else if (g == 0 && uBlankFirst > 0.5) {
    cull();
    return;
  }

  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 c = (uOrigin + local + vec2(dx, dy)) * uDpr;
  vec2 px = floor(c - uSprite * 0.5 + 0.5) + corner * uSprite; // whole device pixels: crisp, unfiltered glyphs
  vec2 clip = px / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 cell = vec2(float(g % uAtlasCols), float(g / uAtlasCols));
  vUv = (cell + corner) * uSprite / uAtlasSize;
  vColor = col;
  vGlow = level >= GLOW_FROM ? (level - GLOW_FROM + 1.0) / (LEVELS - GLOW_FROM) * uGlow : 0.0;
  vAlpha = 1.0;
}
`;

/** Background stars: position, glyph and brightness per instance. */
export const STAR_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec4 aStar; // x, y (CSS px), glyph index, alpha

uniform vec2 uViewport;
uniform float uDpr;
uniform vec2 uSprite;
uniform int uAtlasCols;
uniform vec2 uAtlasSize;

out vec2 vUv;
out vec3 vColor;
out float vGlow;
out float vAlpha;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  int g = int(aStar.z);
  vec2 px = floor(aStar.xy * uDpr - uSprite * 0.5 + 0.5) + corner * uSprite;
  vec2 clip = px / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 cell = vec2(float(g % uAtlasCols), float(g / uAtlasCols));
  vUv = (cell + corner) * uSprite / uAtlasSize;
  vColor = vec3(236.0, 229.0, 214.0) / 255.0;
  vGlow = 0.0;
  vAlpha = aStar.w;
}
`;

export const GLYPH_FS = /* glsl */ `#version 300 es
precision mediump float;

uniform sampler2D uCore;
uniform sampler2D uHalo;

in vec2 vUv;
in vec3 vColor;
in float vGlow;
in float vAlpha;
out vec4 outColor;

void main() {
  float core = texture(uCore, vUv).a;
  float halo = texture(uHalo, vUv).a * vGlow * 0.55;
  float a = (core + halo * (1.0 - core)) * vAlpha;
  if (a < 0.002) discard;
  outColor = vec4(vColor * a, a); // premultiplied
}
`;

/** One oversized triangle covering the viewport. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Bloom bright-pass: 4×4 box down to half resolution, soft-knee threshold. */
export const PREFILTER_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 s = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
    + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb
    + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  s *= 0.25;
  float br = max(s.r, max(s.g, s.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  outColor = vec4(s * w, 1.0);
}
`;

/** Dual-Kawase downsample. */
export const DOWN_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uSrc, vUv).rgb * 4.0
    + texture(uSrc, vUv - h).rgb
    + texture(uSrc, vUv + h).rgb
    + texture(uSrc, vUv + vec2(h.x, -h.y)).rgb
    + texture(uSrc, vUv - vec2(h.x, -h.y)).rgb;
  outColor = vec4(s * 0.125, 1.0);
}
`;

/** Dual-Kawase upsample (blended additively onto the next level up). */
export const UP_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb
    + texture(uSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb
    + texture(uSrc, vUv + vec2(h.x, h.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb
    + texture(uSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0
    + texture(uSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb
    + texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  outColor = vec4(s / 12.0, 1.0);
}
`;

/**
 * Final picture: photo layer (where the composition wants it), glyphs over
 * it, bloom added on top.
 *
 * uMode: 0 whole picture in ASCII, 1 subject only, 2 ASCII subject on the
 * photo, 3 photo subject on ASCII.
 */
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uGlyphs;
uniform sampler2D uBloom;
uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform vec2 uViewport;
uniform float uDpr;
uniform vec2 uOrigin;
uniform vec2 uGridSize;
uniform vec2 uPhotoSize;
uniform int uMode;
uniform float uHasPhoto;
uniform float uHasMask;
uniform float uPhotoUnder;
uniform float uBgDim;
uniform float uBgBlur;
uniform float uBloomOn;
uniform float uBloomIntensity;
out vec4 outColor;

vec3 blurred(vec2 uv, float lod) {
  vec2 r = exp2(lod) / uPhotoSize;
  vec3 acc = textureLod(uPhoto, uv, lod).rgb * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    acc += textureLod(uPhoto, uv + vec2(cos(a), sin(a)) * r * 1.3, lod).rgb * 0.1;
  }
  return acc;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec4 g = texture(uGlyphs, frag / uViewport);
  vec2 css = vec2(frag.x, uViewport.y - frag.y) / uDpr;
  vec2 iuv = (css - uOrigin) / uGridSize;
  bool inside = iuv.x >= 0.0 && iuv.y >= 0.0 && iuv.x < 1.0 && iuv.y < 1.0;

  vec3 photo = vec3(0.0);
  float m = 1.0;
  float amount = 0.0;
  if (inside && uHasPhoto > 0.5) {
    m = uHasMask > 0.5 ? texture(uMask, iuv).r : 1.0;
    photo = texture(uPhoto, iuv).rgb;
    if (uMode == 0) {
      amount = uPhotoUnder;
    } else if (uMode == 1) {
      amount = uPhotoUnder * m;
    } else if (uMode == 2) {
      if (uBgBlur > 0.001) photo = mix(blurred(iuv, uBgBlur * 6.0), photo, m);
      amount = mix(uBgDim, uPhotoUnder, m);
      g *= m; // glyphs stay inside the subject's outline
    } else {
      amount = mix(uPhotoUnder, 1.0, m);
      g *= 1.0 - m;
    }
  }

  vec3 col = photo * amount * (1.0 - g.a) + g.rgb;
  if (uBloomOn > 0.5) col += texture(uBloom, frag / uViewport).rgb * uBloomIntensity;
  outColor = vec4(col, 1.0);
}
`;
