import { chars } from './type';
import { type EffectDef } from './types';

/**
 * Shared GLSL for the contour looks: blurred luma as a height field, its
 * gradient, and anti-aliased iso-lines. Sizes are in output px (`srcLodFor`
 * makes blurs independent of the source texture's own resolution).
 */
const HEIGHT_FIELD = /* glsl */ `
/** Luma blurred over about r output px (four bilinear mip taps). */
float softLuma(vec2 uv, float r) {
  float lod = srcLodFor(r);
  vec2 o = 0.5 * r / u_res;
  vec3 c = textureLod(u_src, uv + vec2(-o.x, -o.y), lod).rgb;
  c += textureLod(u_src, uv + vec2(o.x, -o.y), lod).rgb;
  c += textureLod(u_src, uv + vec2(-o.x, o.y), lod).rgb;
  c += textureLod(u_src, uv + vec2(o.x, o.y), lod).rgb;
  return luma(c * 0.25);
}

/** Height (luma blurred over r px) and its gradient per output px: (h, dh/dx, dh/dy). */
vec3 heightField(vec2 uv, float r) {
  float d = max(1.0, r * 0.5);
  vec2 ex = vec2(d / u_res.x, 0.0);
  vec2 ey = vec2(0.0, d / u_res.y);
  float l = softLuma(uv - ex, r), rr = softLuma(uv + ex, r);
  float t = softLuma(uv - ey, r), b = softLuma(uv + ey, r);
  return vec3(0.25 * (l + rr + t + b), (rr - l) / (2.0 * d), (b - t) / (2.0 * d));
}

/** Coverage of the iso-lines of v (at whole numbers), v changing by gv per px, lines w px wide. */
float isoLine(float v, float gv, float w) {
  float dpx = abs(v - floor(v + 0.5)) / max(gv, 1e-6);
  float ww = max(w, 1.0);
  float c = fill(dpx - ww * 0.5, 1.0) * sqrt(min(w, 1.0));
  // Where the field is flat the lines would be undefined: fade them out.
  return c * smoothstep(1.0, 4.0, gv * u_res.y);
}
`;

const contour: EffectDef = {
  id: 'contour',
  name: 'Contour',
  category: 'edges',
  description: 'Topographic iso-luminance lines traced through the picture, on paper or over the image.',
  params: [
    { type: 'range', key: 'levels', label: 'Levels', min: 3, max: 48, step: 1, default: 14 },
    { type: 'range', key: 'width', label: 'Line width', min: 0.5, max: 8, step: 0.1, default: 2, unit: 'px' },
    { type: 'range', key: 'smooth', label: 'Smoothing', min: 0, max: 1, default: 0.35 },
    { type: 'range', key: 'photo', label: 'Image behind', min: 0, max: 1, default: 0 },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Line colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Image' },
        { value: 2, label: 'Spectrum' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Flow', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Survey map', values: {} },
    { name: 'Over the image', values: { photo: 0.45, paper: '#000000', ink: '#f5ecd7', width: 1.6 } },
    { name: 'Neon lines', values: { paper: '#000000', ink: '#7fe08f', levels: 24, width: 1.4 } },
    { name: 'Spectrum', values: { paper: '#05040a', colorMode: 2, levels: 30, width: 1.5, smooth: 0.5 } },
    { name: 'Photo lines', values: { paper: '#0c0a08', colorMode: 1, levels: 22, width: 2.2 } },
    { name: 'Blueprint', values: { paper: '#0b2a5b', ink: '#cfe4ff', levels: 18, width: 1.3 } },
    { name: 'Flowing cheese', values: { paper: '#000000', ink: '#ffc53d', levels: 20, speed: 1 } },
    { name: 'Bold rings', values: { levels: 7, width: 5, smooth: 0.6, ink: '#ff5a3c' } },
  ],
  glsl: /* glsl */ `
${HEIGHT_FIELD}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float r = (0.004 + 0.03 * u_smooth) * u_res.y;
  vec3 hf = heightField(uv, r);
  float drift = u_time * u_speed * 0.3;
  float v = hf.x * u_levels + 0.5 - drift;
  float line = isoLine(v, length(hf.yz) * u_levels, u_width * k);

  vec3 ink = u_ink;
  int cm = int(u_colorMode + 0.5);
  if (cm == 1) {
    vec3 c = saturation(textureLod(u_src, uv, srcLodFor(r)).rgb, 1.5);
    ink = c / max(max(c.r, max(c.g, c.b)), 0.3);
  } else if (cm == 2) {
    float n = floor(v + 0.5);
    ink = hsv2rgb(vec3(fract(0.55 + n / u_levels * 0.85), 0.62, 1.0));
  }
  vec3 bg = mix(u_paper, s.rgb, u_photo);
  return vec4(mix(bg, ink, line), s.a);
}
`,
};

const contourMap: EffectDef = {
  id: 'contour-map',
  name: 'Contour Map',
  category: 'edges',
  pick: true,
  description: 'A topographic map of the picture: hypsometric tints, hill shading and index contours.',
  params: [
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Terrain' },
        { value: 1, label: 'Ocean' },
        { value: 2, label: 'Heat' },
        { value: 3, label: 'Mono' },
        { value: 4, label: 'Vintage' },
      ],
      default: 0,
    },
    { type: 'range', key: 'levels', label: 'Levels', min: 4, max: 48, step: 1, default: 16 },
    { type: 'range', key: 'hillshade', label: 'Hill shade', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'smooth', label: 'Smoothing', min: 0, max: 1, default: 0.45, group: 'Tone' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.1, unit: '×', group: 'Tone' },
    { type: 'toggle', key: 'stepped', label: 'Stepped tints', default: true, group: 'Tone' },
    { type: 'range', key: 'lines', label: 'Lines', min: 0, max: 1, default: 0.8, group: 'Lines' },
    {
      type: 'range',
      key: 'width',
      label: 'Line width',
      min: 0.5,
      max: 6,
      step: 0.1,
      default: 1.4,
      unit: 'px',
      group: 'Lines',
    },
    { type: 'range', key: 'index', label: 'Index every', min: 0, max: 10, step: 1, default: 5, group: 'Lines' },
    {
      type: 'range',
      key: 'light',
      label: 'Light from',
      min: 0,
      max: 360,
      step: 1,
      default: 315,
      unit: '°',
      group: 'Light',
    },
  ],
  presets: [
    { name: 'Terrain', values: {} },
    { name: 'Ocean chart', values: { palette: 1, levels: 20 } },
    { name: 'Heat map', values: { palette: 2, hillshade: 0.35, index: 0 } },
    { name: 'Survey', values: { palette: 3, hillshade: 0.25, levels: 24 } },
    { name: 'Vintage atlas', values: { palette: 4, hillshade: 0.5, width: 1.1 } },
    { name: 'Relief', values: { lines: 0, stepped: false, hillshade: 1, smooth: 0.6 } },
    { name: 'Dense survey', values: { palette: 3, levels: 40, width: 0.9, hillshade: 0, smooth: 0.7 } },
  ],
  glsl: /* glsl */ `
${HEIGHT_FIELD}

vec3 terrain(float t) {
  if (t < 0.22) return mix(vec3(0.12, 0.25, 0.46), vec3(0.42, 0.64, 0.78), t / 0.22);
  if (t < 0.28) return mix(vec3(0.88, 0.84, 0.64), vec3(0.64, 0.77, 0.47), (t - 0.22) / 0.06);
  if (t < 0.5) return mix(vec3(0.64, 0.77, 0.47), vec3(0.38, 0.6, 0.33), (t - 0.28) / 0.22);
  if (t < 0.68) return mix(vec3(0.38, 0.6, 0.33), vec3(0.86, 0.79, 0.5), (t - 0.5) / 0.18);
  if (t < 0.84) return mix(vec3(0.86, 0.79, 0.5), vec3(0.64, 0.45, 0.3), (t - 0.68) / 0.16);
  if (t < 0.94) return mix(vec3(0.64, 0.45, 0.3), vec3(0.63, 0.6, 0.58), (t - 0.84) / 0.1);
  return mix(vec3(0.63, 0.6, 0.58), vec3(0.98), (t - 0.94) / 0.06);
}

vec3 stops5(vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, float t) {
  float x = t * 4.0;
  if (x < 1.0) return mix(a, b, x);
  if (x < 2.0) return mix(b, c, x - 1.0);
  if (x < 3.0) return mix(c, d, x - 2.0);
  return mix(d, e, x - 3.0);
}

vec3 tint(int p, float t) {
  t = clamp(t, 0.0, 1.0);
  if (p == 1) return stops5(vec3(0.02, 0.06, 0.2), vec3(0.05, 0.22, 0.45), vec3(0.1, 0.45, 0.68), vec3(0.42, 0.76, 0.85), vec3(0.86, 0.96, 0.95), t);
  if (p == 2) return stops5(vec3(0.06, 0.02, 0.14), vec3(0.4, 0.05, 0.45), vec3(0.85, 0.16, 0.24), vec3(1.0, 0.55, 0.1), vec3(1.0, 0.95, 0.7), t);
  if (p == 3) return mix(vec3(0.3, 0.28, 0.26), vec3(0.96, 0.93, 0.84), t);
  if (p == 4) return stops5(vec3(0.52, 0.64, 0.64), vec3(0.8, 0.82, 0.7), vec3(0.9, 0.83, 0.64), vec3(0.78, 0.62, 0.42), vec3(0.93, 0.89, 0.8), t);
  return terrain(t);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float r = (0.004 + 0.03 * u_smooth) * u_res.y;
  vec3 hf = heightField(uv, r);
  float raw = (hf.x - 0.5) * u_contrast + 0.5;
  float h = clamp(raw, 0.0, 1.0);
  vec2 g = hf.yz * u_contrast * step(0.0, raw) * step(raw, 1.0);

  float n = u_levels;
  float v = h * n;
  float band = min(floor(v), n - 1.0);
  int pal = int(u_palette + 0.5);
  vec3 col = tint(pal, u_stepped > 0.5 ? (band + 0.5) / n : h);

  // Hill shade: the height field lit from an azimuth (0° = north, clockwise).
  float az = radians(u_light);
  vec3 L = normalize(vec3(sin(az), -cos(az), 1.0));
  vec3 N = normalize(vec3(-g * u_res.y * 0.1, 1.0));
  col *= clamp(1.0 + (dot(N, L) - L.z) * 1.6 * u_hillshade, 0.25, 1.6);

  // Contours, every Nth one bolder.
  float idx = floor(v + 0.5);
  bool major = u_index > 0.5 && mod(idx, floor(u_index + 0.5)) < 0.5;
  float w = u_width * k * (major ? 2.2 : 1.0);
  float line = isoLine(v, length(g) * n, w) * u_lines * (major ? 1.0 : 0.75);
  vec3 lc = pal == 3 ? vec3(0.12, 0.1, 0.09) : col * vec3(0.3, 0.26, 0.22);
  col = mix(col, lc, line);

  // A little paper tooth.
  col *= 0.97 + 0.03 * hash12(floor(uv * u_res / max(1.0, 1.5 * k)));
  return vec4(col, s.a);
}
`,
};

const TYPE_RAMP = ' .·:-=+*%#@';
const TYPE_WORDS = 'PIZZA CHEESE BASIL SAUCE CRUST PEPPERONI';

const contourType: EffectDef = {
  id: 'contour-type',
  name: 'Contour Type',
  category: 'edges',
  description: 'Brightness bands filled with repeated characters or words, with contour lines between them.',
  params: [
    { type: 'range', key: 'bands', label: 'Bands', min: 3, max: 16, step: 1, default: 7 },
    { type: 'range', key: 'rows', label: 'Rows', min: 20, max: 160, step: 1, default: 56 },
    {
      type: 'select',
      key: 'mode',
      label: 'Fill',
      options: [
        { value: 0, label: 'Characters' },
        { value: 1, label: 'Words' },
      ],
      default: 0,
    },
    { type: 'range', key: 'width', label: 'Line width', min: 0, max: 6, step: 0.1, default: 1.8, unit: 'px' },
    { type: 'text', key: 'ramp', label: 'Characters', default: TYPE_RAMP, maxLength: 48, group: 'Type' },
    { type: 'text', key: 'words', label: 'Words', default: TYPE_WORDS, maxLength: 96, group: 'Type' },
    { type: 'range', key: 'smooth', label: 'Smoothing', min: 0, max: 1, default: 0.4, group: 'Tone' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo' },
        { value: 2, label: 'Pizza bands' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Type map', values: {} },
    { name: 'Word bands', values: { mode: 1, rows: 48 } },
    { name: 'Terminal', values: { ink: '#7fe08f', paper: '#000000', rows: 80 } },
    { name: 'Photo type', values: { colorMode: 1, ink: '#f5ecd7', paper: '#000000', rows: 72, width: 1 } },
    {
      name: 'Pizza bands',
      values: { mode: 1, colorMode: 2, ink: '#f5ecd7', paper: '#0d0a08', bands: 6, rows: 44 },
    },
    { name: 'Binary strata', values: { ramp: ' 01', ink: '#ffc53d', paper: '#000000', bands: 5, rows: 90 } },
    { name: 'Big letters', values: { ramp: ' ~oO@', rows: 30, bands: 5, width: 3, ink: '#ff5a3c', paper: '#000000' } },
  ],
  atlas: (p) => {
    if (Number(p.mode) === 1) {
      const list = String(p.words || TYPE_WORDS)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 24);
      const words = list.length ? list : ['PIZZA'];
      const longest = Math.max(...words.map((w) => Array.from(w).length));
      return { glyphs: words, font: 'sans', weight: 800, cellAspect: Math.min(8, Math.max(1, longest * 0.66 + 0.4)) };
    }
    const ramp = chars(String(p.ramp || TYPE_RAMP));
    return { glyphs: ramp.length > 1 ? ramp : chars(TYPE_RAMP), sortByInk: true, cellAspect: 0.62 };
  },
  glsl: /* glsl */ `
${HEIGHT_FIELD}

vec3 bandTint(float b) {
  float i = mod(b, 4.0);
  if (i < 0.5) return vec3(1.0, 0.773, 0.239);
  if (i < 1.5) return vec3(1.0, 0.353, 0.235);
  if (i < 2.5) return vec3(0.498, 0.878, 0.561);
  return vec3(0.961, 0.925, 0.843);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float r = (0.004 + 0.03 * u_smooth) * u_res.y;
  vec3 hf = heightField(uv, r);
  float n = u_bands;
  float v = clamp(hf.x, 0.0, 0.9999) * n;
  float band = floor(v);
  float t = (band + 0.5) / n;
  bool darkPaper = luma(u_paper) < luma(u_ink);
  float dens = darkPaper ? t : 1.0 - t;
  int mode = int(u_mode + 0.5);

  // Glyph cells: the atlas tells the cell aspect (words are wide).
  vec2 ts = vec2(textureSize(u_atlas, 0));
  float aspect = (ts.x / u_atlasGrid.x) / (ts.y / u_atlasGrid.y);
  float ch = u_res.y / u_rows;
  float cw = ch * aspect;
  vec2 px = uv * u_res;
  if (mode == 1) px.x += (mod(floor(px.y / ch), 2.0) * 0.5 + band * 0.37) * cw;
  vec2 cp = fract(px / vec2(cw, ch));
  float gi = mode == 1 ? mod(band, u_glyphCount) : floor(dens * (u_glyphCount - 1.0) + 0.5);
  float ink = glyph(gi, cp, ch) * (mode == 1 ? 0.3 + 0.7 * dens : 1.0);

  vec3 inkCol = u_ink;
  int cm = int(u_colorMode + 0.5);
  if (cm == 1) {
    vec3 c = saturation(textureLod(u_src, uv, srcLodFor(ch)).rgb, 1.4);
    inkCol = darkPaper ? c / max(max(c.r, max(c.g, c.b)), 0.3) : c * 0.8;
  } else if (cm == 2) inkCol = bandTint(band);
  vec3 bg = mix(u_paper, inkCol, (0.04 + 0.08 * dens) * (cm == 2 ? 1.5 : 1.0));
  vec3 col = mix(bg, inkCol, ink);

  float line = isoLine(v, length(hf.yz) * n, u_width * k) * step(0.01, u_width);
  col = mix(col, cm == 2 ? u_ink : inkCol * 0.5 + u_ink * 0.5, line);
  return vec4(col, s.a);
}
`,
};

const edgeDetection: EffectDef = {
  id: 'edge-detection',
  name: 'Edge Detection',
  category: 'edges',
  description: 'Sobel edges: glowing lines on black, edges in the picture’s colours, or ink lines on paper.',
  params: [
    {
      type: 'select',
      key: 'mode',
      label: 'Mode',
      options: [
        { value: 0, label: 'Mono' },
        { value: 1, label: 'Colour' },
        { value: 2, label: 'Neon' },
        { value: 3, label: 'Inverted' },
      ],
      default: 0,
    },
    { type: 'range', key: 'threshold', label: 'Threshold', min: 0, max: 1, default: 0.12 },
    { type: 'range', key: 'thickness', label: 'Thickness', min: 0.5, max: 8, step: 0.1, default: 2, unit: 'px' },
    { type: 'range', key: 'gain', label: 'Gain', min: 0.5, max: 4, default: 1.6, unit: '×' },
    { type: 'range', key: 'smooth', label: 'Smoothing', min: 0, max: 1, default: 0.25, group: 'Tone' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 1, default: 0.3, group: 'Tone' },
    { type: 'color', key: 'ink', label: 'Lines', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'photo', label: 'Image behind', min: 0, max: 1, default: 0, group: 'Ink' },
  ],
  presets: [
    { name: 'White on black', values: {} },
    { name: 'Colour edges', values: { mode: 1, glow: 0.5, gain: 2 } },
    { name: 'Neon', values: { mode: 2, glow: 0.9, thickness: 2.4 } },
    { name: 'Ink drawing', values: { mode: 3, glow: 0, thickness: 2.4, threshold: 0.1 } },
    { name: 'Blueprint', values: { ink: '#cfe4ff', paper: '#0b2a5b', glow: 0.2, thickness: 1.5 } },
    { name: 'Cheese outline', values: { ink: '#ffc53d', glow: 0.6, photo: 0.2 } },
    { name: 'Fine detail', values: { thickness: 0.8, threshold: 0.09, gain: 2, smooth: 0, glow: 0 } },
  ],
  glsl: /* glsl */ `
float lumaLod(vec2 uv, float lod) { return luma(textureLod(u_src, uv, lod).rgb); }

vec2 sobelLod(vec2 uv, float px, float lod) {
  vec2 o = px / u_res;
  float tl = lumaLod(uv + vec2(-o.x, -o.y), lod), tc = lumaLod(uv + vec2(0.0, -o.y), lod);
  float tr = lumaLod(uv + vec2(o.x, -o.y), lod), ml = lumaLod(uv + vec2(-o.x, 0.0), lod);
  float mr = lumaLod(uv + vec2(o.x, 0.0), lod), bl = lumaLod(uv + vec2(-o.x, o.y), lod);
  float bc = lumaLod(uv + vec2(0.0, o.y), lod), br = lumaLod(uv + vec2(o.x, o.y), lod);
  return vec2((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr));
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float w = max(0.6, u_thickness * k);
  float lod = srcLodFor(w * (0.7 + 3.0 * u_smooth));
  vec2 g = sobelLod(uv, w * 0.6, lod);
  float m = length(g) * 0.25 * u_gain;
  float e = smoothstep(u_threshold, u_threshold + 0.06 + 0.1 * u_smooth, m);
  float halo = 0.0;
  if (u_glow > 0.001) {
    vec2 g2 = sobelLod(uv, w * 2.5, srcLodFor(w * 5.0));
    halo = smoothstep(u_threshold * 0.5, u_threshold + 0.35, length(g2) * 0.25 * u_gain) * u_glow;
  }

  int mode = int(u_mode + 0.5);
  vec3 bg = mode == 3 ? u_ink : u_paper;
  vec3 lc = mode == 3 ? u_paper : u_ink;
  bg = mix(bg, s.rgb * (mode == 3 ? 1.0 : 0.7), u_photo);
  if (mode == 1) {
    // The brighter side of the edge gives its colour.
    vec2 nrm = normalize(g + 1e-6) * w * 1.5 / u_res;
    vec3 c1 = textureLod(u_src, uv + nrm, lod).rgb, c2 = textureLod(u_src, uv - nrm, lod).rgb;
    vec3 c = saturation(luma(c1) > luma(c2) ? c1 : c2, 1.6);
    lc = c / max(max(c.r, max(c.g, c.b)), 0.2);
  } else if (mode == 2) {
    lc = hsv2rgb(vec3(fract(atan(g.y, g.x) / TAU + 0.5), 0.75, 1.0));
  }
  vec3 col = mix(bg, lc, e);
  if (mode == 3) col = mix(col, lc, halo * 0.2 * (1.0 - e));
  else col += lc * halo * (mode == 2 ? 0.9 : 0.5) * (1.0 - e);
  return vec4(col, s.a);
}
`,
};

const threshold: EffectDef = {
  id: 'threshold',
  name: 'Threshold',
  category: 'edges',
  description: 'A hard two-colour cut at a brightness level, with grain in the transition.',
  params: [
    { type: 'range', key: 'level', label: 'Level', min: 0, max: 1, default: 0.45 },
    { type: 'range', key: 'soft', label: 'Softness', min: 0, max: 1, default: 0.02 },
    { type: 'range', key: 'noise', label: 'Grain', min: 0, max: 1, default: 0.25 },
    { type: 'range', key: 'adapt', label: 'Adaptive', min: 0, max: 1, default: 0, group: 'Tone' },
    { type: 'range', key: 'blur', label: 'Pre-blur', min: 0, max: 1, default: 0.1, group: 'Tone' },
    {
      type: 'range',
      key: 'grain',
      label: 'Grain size',
      min: 1,
      max: 10,
      step: 0.5,
      default: 2,
      unit: 'px',
      group: 'Grain',
    },
    {
      type: 'select',
      key: 'pattern',
      label: 'Pattern',
      options: [
        { value: 0, label: 'Noise' },
        { value: 1, label: 'Bayer' },
        { value: 2, label: 'Lines' },
      ],
      default: 0,
      group: 'Grain',
    },
    { type: 'range', key: 'speed', label: 'Crawl', min: 0, max: 2, default: 0, group: 'Grain' },
    { type: 'color', key: 'dark', label: 'Dark', default: '#0a0806', group: 'Ink' },
    { type: 'color', key: 'light', label: 'Light', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Photocopy', values: {} },
    { name: 'Pepperoni', values: { dark: '#1a0a06', light: '#ff5a3c', level: 0.5 } },
    { name: 'Cheese', values: { dark: '#000000', light: '#ffc53d', noise: 0.1, level: 0.4 } },
    { name: 'Grainy stencil', values: { noise: 0.8, grain: 3, speed: 1, dark: '#15120e' } },
    { name: 'Engraving', values: { pattern: 2, noise: 0.7, grain: 1.5, soft: 0 } },
    { name: 'Soft poster', values: { soft: 0.35, noise: 0, blur: 0.5, dark: '#2a1b3d', light: '#7fe08f' } },
    { name: 'Adaptive ink', values: { adapt: 1, level: 0.5, noise: 0.15, blur: 0 } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  vec3 c = u_blur > 0.001 ? textureLod(u_src, uv, srcLodFor(u_blur * 0.012 * u_res.y)).rgb : s.rgb;
  float l = luma(c);
  float local = luma(textureLod(u_src, uv, srcLodFor(0.08 * u_res.y)).rgb);
  float lvl = mix(u_level, local + (u_level - 0.5) * 0.6, u_adapt);

  float gs = max(1.0, u_grain * k);
  vec2 px = uv * u_res;
  vec2 cell = floor(px / gs);
  float fr = floor(u_time * 12.0 * u_speed);
  int p = int(u_pattern + 0.5);
  float th;
  if (p == 1) th = bayer8(cell + vec2(fr * 3.0, fr * 5.0));
  else if (p == 2) th = abs(fract(px.y / (gs * 3.0) + fr * 0.25) - 0.5) * 2.0;
  else th = hash13(vec3(cell, fr + u_seed * 97.0));

  float x = l - lvl + (th - 0.5) * u_noise * 0.6;
  float aa = max(u_soft * 0.25, fwidth(l) * 0.7) + 1e-4;
  float m = smoothstep(-aa, aa, x);
  return vec4(mix(u_dark, u_light, m), s.a);
}
`,
};

export const EDGES_EFFECTS: EffectDef[] = [contour, contourMap, contourType, edgeDetection, threshold];
