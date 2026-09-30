import { type EffectDef } from './types';

const halftone: EffectDef = {
  id: 'halftone',
  name: 'Halftone',
  category: 'halftone',
  pick: true,
  description: 'Print-screen dots, lines or squares, in one ink or four-colour CMYK.',
  params: [
    { type: 'range', key: 'cells', label: 'Cells', min: 12, max: 240, step: 1, default: 90 },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 45, unit: '°' },
    {
      type: 'select',
      key: 'shape',
      label: 'Shape',
      options: [
        { value: 0, label: 'Dot' },
        { value: 1, label: 'Line' },
        { value: 2, label: 'Square' },
        { value: 3, label: 'Diamond' },
        { value: 4, label: 'Ring' },
      ],
      default: 0,
    },
    {
      type: 'select',
      key: 'mode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'CMYK' },
        { value: 2, label: 'Photo dots' },
      ],
      default: 0,
    },
    { type: 'range', key: 'gain', label: 'Dot gain', min: 0.5, max: 1.6, default: 1, unit: '×', group: 'Tone' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.1, unit: '×', group: 'Tone' },
    { type: 'range', key: 'soft', label: 'Softness', min: 0, max: 1, default: 0.15, group: 'Tone' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Newspaper', values: {} },
    { name: 'CMYK print', values: { mode: 1, cells: 110 } },
    { name: 'Pop dots', values: { mode: 2, cells: 48, paper: '#000000', gain: 1.1 } },
    { name: 'Engraved lines', values: { shape: 1, cells: 120, angle: 30 } },
    { name: 'Pixel squares', values: { shape: 2, angle: 0, cells: 70, ink: '#ff5a3c', paper: '#120d0a' } },
    { name: 'Rings', values: { shape: 4, cells: 60, ink: '#ffc53d', paper: '#000000' } },
  ],
  glsl: /* glsl */ `
float screenCover(vec2 px, float angle, float cell, float dark, int shape) {
  vec2 r = rot(angle) * px;
  vec2 f = fract(r / cell) - 0.5;
  float aa = (1.0 + u_soft * 6.0) / cell;
  dark = clamp(dark * u_gain, 0.0, 1.0);
  if (shape == 1) return fill(abs(f.y) - dark * 0.5, aa);
  if (shape == 2) return fill(sdBox(f, vec2(sqrt(dark) * 0.5)), aa);
  if (shape == 3) return fill((abs(f.x) + abs(f.y)) - dark, aa);
  if (shape == 4) {
    float rr = sqrt(dark) * 0.62;
    return fill(abs(length(f) - rr * 0.6) - rr * 0.35, aa);
  }
  return fill(length(f) - sqrt(dark) * 0.7071, aa);
}

// Tone at the centre of the screen cell px falls in (so each dot is one flat size).
vec4 cellColor(vec2 px, float angle, float cell) {
  vec2 r = rot(angle) * px;
  vec2 cr = (floor(r / cell) + 0.5) * cell;
  vec2 center = transpose(rot(angle)) * cr;
  return srcAvg(center / u_res, cell);
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float cell = u_res.x / u_cells;
  float ang = radians(u_angle);
  int shape = int(u_shape + 0.5);
  int mode = int(u_mode + 0.5);
  vec4 s = src(uv);
  if (mode == 1) {
    vec3 ink = vec3(1.0);
    float angles[4] = float[4](15.0, 75.0, 0.0, 45.0);
    vec3 inks[4] = vec3[4](vec3(0.0, 0.62, 0.9), vec3(0.9, 0.05, 0.55), vec3(1.0, 0.9, 0.0), vec3(0.08));
    for (int i = 0; i < 4; i++) {
      float a = radians(angles[i]) + ang - radians(45.0);
      vec3 c = contrast(cellColor(px, a, cell).rgb, u_contrast);
      float k = 1.0 - max(c.r, max(c.g, c.b));
      float v = i == 3 ? k : (1.0 - c[i] - k) / max(1.0 - k, 1e-3);
      float cov = screenCover(px, a, cell, clamp(v, 0.0, 1.0), shape);
      ink *= mix(vec3(1.0), inks[i], cov);
    }
    return vec4(u_paper * ink, s.a);
  }
  vec4 c = cellColor(px, ang, cell);
  float dark = 1.0 - clamp((luma(c.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  if (mode == 2) {
    float cov = screenCover(px, ang, cell, 1.0 - dark, shape);
    return vec4(mix(u_paper, saturation(c.rgb, 1.3) * 1.1, cov), s.a);
  }
  float cov = screenCover(px, ang, cell, dark, shape);
  return vec4(mix(u_paper, u_ink, cov), s.a);
}
`,
};

const dithering: EffectDef = {
  id: 'dithering',
  name: 'Dithering',
  category: 'halftone',
  pick: true,
  description: 'Ordered or noise dithering into a small palette, from 1-bit to Game Boy greens.',
  params: [
    { type: 'range', key: 'pixel', label: 'Pixel size', min: 1, max: 16, step: 1, default: 3, unit: 'px' },
    {
      type: 'select',
      key: 'method',
      label: 'Pattern',
      options: [
        { value: 0, label: 'Bayer 2×2' },
        { value: 1, label: 'Bayer 4×4' },
        { value: 2, label: 'Bayer 8×8' },
        { value: 3, label: 'Noise' },
        { value: 4, label: 'Lines' },
      ],
      default: 2,
    },
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Two inks' },
        { value: 1, label: 'Game Boy' },
        { value: 2, label: 'CGA' },
        { value: 3, label: 'Photo levels' },
        { value: 4, label: 'Pizza' },
      ],
      default: 0,
    },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 2, group: 'Tone' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.2, unit: '×', group: 'Tone' },
    { type: 'range', key: 'bright', label: 'Brightness', min: -0.5, max: 0.5, default: 0, group: 'Tone' },
    { type: 'range', key: 'spread', label: 'Spread', min: 0, max: 1.5, default: 1, group: 'Tone' },
    { type: 'toggle', key: 'animate', label: 'Crawl', default: false, group: 'Tone' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#000000', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: '1-bit', values: {} },
    { name: 'Game Boy', values: { palette: 1, pixel: 4, levels: 4 } },
    { name: 'CGA', values: { palette: 2, pixel: 3 } },
    { name: 'Photo levels', values: { palette: 3, levels: 3, pixel: 2 } },
    { name: 'Pizza', values: { palette: 4, pixel: 3 } },
    { name: 'Blue noise', values: { method: 3, pixel: 2 } },
    { name: 'Night mode', values: { ink: '#000000', paper: '#7fe08f', method: 1 } },
  ],
  glsl: /* glsl */ `
float threshold(vec2 cell) {
  int m = int(u_method + 0.5);
  vec2 c = cell + (u_animate > 0.5 ? vec2(floor(u_time * 12.0), 0.0) : vec2(0.0));
  if (m == 0) return bayer2(c);
  if (m == 1) return bayer4(c);
  if (m == 3) return hash12(c + u_seed * 97.0);
  if (m == 4) return fract(c.y * 0.25 + c.x * 0.0625);
  return bayer8(c);
}

vec3 pal(int p, int i) {
  if (p == 1) {
    vec3 gb[4] = vec3[4](vec3(0.06, 0.22, 0.06), vec3(0.19, 0.38, 0.19), vec3(0.55, 0.67, 0.06), vec3(0.61, 0.74, 0.06));
    return gb[clamp(i, 0, 3)];
  }
  if (p == 2) {
    vec3 cga[4] = vec3[4](vec3(0.0), vec3(0.33, 1.0, 1.0), vec3(1.0, 0.33, 1.0), vec3(1.0));
    return cga[clamp(i, 0, 3)];
  }
  vec3 pz[5] = vec3[5](vec3(0.05, 0.03, 0.02), vec3(0.55, 0.12, 0.08), vec3(1.0, 0.35, 0.24), vec3(1.0, 0.77, 0.24), vec3(0.96, 0.93, 0.84));
  return pz[clamp(i, 0, 4)];
}

vec4 effect(vec2 uv) {
  float size = max(1.0, u_pixel * u_unit);
  Cell c = grid(uv, vec2(size));
  vec4 s = srcAvg(c.center, size);
  vec3 col = contrast(s.rgb, u_contrast) + u_bright;
  float th = (threshold(c.id) - 0.5) * u_spread;
  int p = int(u_palette + 0.5);
  if (p == 3) {
    float n = u_levels - 1.0;
    return vec4(clamp(floor(col * n + 0.5 + th) / n, 0.0, 1.0), s.a);
  }
  float l = clamp(luma(col), 0.0, 1.0);
  if (p == 0) {
    float n = u_levels - 1.0;
    float q = clamp(floor(l * n + 0.5 + th) / n, 0.0, 1.0);
    return vec4(mix(u_ink, u_paper, q), s.a);
  }
  int count = p == 4 ? 5 : 4;
  float n = float(count - 1);
  int i = int(clamp(floor(l * n + 0.5 + th), 0.0, n));
  return vec4(pal(p, i), s.a);
}
`,
};

const crossStitch: EffectDef = {
  id: 'cross-stitch',
  name: 'Cross Stitch',
  category: 'halftone',
  description: 'Embroidered X stitches on aida cloth, one shaded thread colour per square.',
  params: [
    { type: 'range', key: 'cells', label: 'Stitches', min: 16, max: 200, step: 1, default: 64 },
    {
      type: 'select',
      key: 'colors',
      label: 'Threads',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Quantised' },
        { value: 2, label: 'One thread' },
      ],
      default: 1,
    },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 4 },
    { type: 'range', key: 'thick', label: 'Thread width', min: 0.08, max: 0.3, default: 0.17, group: 'Shape' },
    { type: 'range', key: 'skip', label: 'Leave bare', min: 0, max: 0.6, default: 0.04, group: 'Shape' },
    { type: 'range', key: 'shade', label: 'Thread shading', min: 0, max: 1, default: 0.85, group: 'Light' },
    { type: 'range', key: 'weave', label: 'Fabric weave', min: 0, max: 1, default: 0.7, group: 'Light' },
    { type: 'color', key: 'fabric', label: 'Fabric', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'thread', label: 'Thread', default: '#c8281c', group: 'Ink' },
  ],
  presets: [
    { name: 'Sampler', values: {} },
    { name: 'Photo floss', values: { colors: 0, cells: 80 } },
    { name: 'Redwork', values: { colors: 2, cells: 72, skip: 0.1, levels: 4 } },
    { name: 'Big stitches', values: { cells: 32, levels: 3, thick: 0.2 } },
    { name: 'Black aida', values: { fabric: '#1a1714', skip: 0.15, levels: 5, cells: 70 } },
    { name: 'Blue on linen', values: { colors: 2, thread: '#1d4f9c', fabric: '#e9e1cf', cells: 90, skip: 0.06 } },
  ],
  glsl: /* glsl */ `
// Distance to one stitch arm (a capsule from a to b, half-width w); tc = (along 0–1, across -1..1).
float csArm(vec2 p, vec2 a, vec2 b, float w, out vec2 tc) {
  vec2 ba = b - a;
  float len = length(ba);
  vec2 dir = ba / len;
  vec2 pa = p - a;
  float t = clamp(dot(pa, dir), 0.0, len);
  tc = vec2(t / len, dot(pa, vec2(-dir.y, dir.x)) / w);
  return length(pa - dir * t) - w;
}

// A round, twisted thread: darker at its sides, strands spiralling along it.
vec3 csThread(vec3 col, vec2 tc, float d, float w) {
  float x = clamp((d + w) / w, 0.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  float ply = 0.5 + 0.5 * sin(TAU * (tc.x * 5.5 + tc.y * 0.7));
  float lit = (0.42 + 0.66 * cyl) * (0.76 + 0.32 * ply);
  vec3 shaded = col * lit + vec3(pow(cyl, 6.0) * 0.14 * ply);
  return mix(col, shaded, u_shade);
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  Cell c = grid(uv, vec2(cell));
  vec4 s = srcAvg(c.center, cell);
  vec3 col = s.rgb;
  float tn = luma(col);
  int mode = int(u_colors + 0.5);
  // Squares whose tone is close to the cloth's are left bare.
  float fl = luma(u_fabric);
  float diff = abs(tn - fl);
  bool on = diff > u_skip;
  if (mode == 1) {
    // Floss colours: hue in twelve steps, saturation and value in levels.
    float n = max(u_levels - 1.0, 1.0);
    vec3 hsv = rgb2hsv(clamp(saturation(col, 1.2), 0.0, 1.0));
    hsv.x = floor(hsv.x * 12.0 + 0.5) / 12.0;
    hsv.yz = floor(hsv.yz * n + 0.5) / n;
    hsv.z = max(hsv.z, 0.5 / n);
    col = hsv2rgb(hsv);
  } else if (mode == 2) {
    // One floss in a few shades: the further from the cloth, the deeper the thread.
    float n = max(u_levels - 1.0, 1.0);
    float k = clamp(diff / max(max(fl, 1.0 - fl), 0.1) * 1.15, 0.0, 1.0);
    k = ceil(k * n - 0.001) / n;
    col = mix(mix(u_thread, u_fabric, 0.62), u_thread * 0.85, k);
  } else {
    col = saturation(col, 1.1);
  }

  vec2 p = c.p;
  float aa = 1.2 / cell;
  float detail = smoothstep(4.0, 14.0, cell);

  // Aida cloth: little blocks of woven strands with holes at the stitch corners.
  vec2 q = p * 4.0;
  vec2 fq = fract(q);
  float over = mod(floor(q.x) + floor(q.y), 2.0);
  float strand = over > 0.5 ? sin(PI * fq.x) : sin(PI * fq.y);
  float weave = mix(1.0, 0.84 + 0.2 * strand, u_weave * detail);
  float edge = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
  float groove = 1.0 - 0.16 * u_weave * (1.0 - smoothstep(0.0, 0.1, edge));
  vec2 corner = p - floor(p + 0.5);
  float hole = fill(length(corner) - 0.12, aa) * (0.4 + 0.6 * detail);
  vec3 outc = mix(u_fabric * weave * groove, u_fabric * 0.3, hole);

  if (on) {
    float w = u_thick;
    vec2 a1 = vec2(0.12, 0.88), b1 = vec2(0.88, 0.12);
    vec2 a2 = vec2(0.12, 0.12), b2 = vec2(0.88, 0.88);
    vec2 tc1, tc2, tcs;
    float d1 = csArm(p, a1, b1, w, tc1);
    float d2 = csArm(p, a2, b2, w, tc2);
    // Soft shadow of the stitch on the cloth.
    vec2 so = vec2(0.05, 0.065);
    float ds = min(csArm(p - so, a1, b1, w, tcs), csArm(p - so, a2, b2, w, tcs));
    outc *= 1.0 - 0.45 * u_shade * fill(ds, 0.16);
    outc = mix(outc, csThread(col, tc1, d1, w), fill(d1, aa));
    // The top arm shades the one beneath where they cross.
    float dsh = csArm(p - so * 0.6, a2, b2, w, tcs);
    outc *= 1.0 - 0.4 * u_shade * fill(dsh, 0.1) * fill(d1, aa);
    outc = mix(outc, csThread(col, tc2, d2, w), fill(d2, aa));
  }
  return vec4(outc, s.a);
}
`,
};

const driftLines: EffectDef = {
  id: 'drift-lines',
  name: 'Drift Lines',
  category: 'halftone',
  pick: true,
  description: 'Ridgeline art: stacked lines lifted and thickened by the picture, slowly undulating.',
  params: [
    { type: 'range', key: 'lines', label: 'Lines', min: 12, max: 200, step: 1, default: 64 },
    { type: 'range', key: 'amp', label: 'Lift', min: 0, max: 3.5, default: 1.8, unit: '×' },
    { type: 'range', key: 'drift', label: 'Drift', min: 0, max: 1, default: 0.35 },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1 },
    { type: 'range', key: 'thick', label: 'Dark width', min: 0.05, max: 1.4, default: 0.85, group: 'Shape' },
    { type: 'range', key: 'thin', label: 'Light width', min: 0.02, max: 1, default: 0.1, group: 'Shape' },
    { type: 'toggle', key: 'ridge', label: 'Hide lines behind', default: true, group: 'Shape' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Ridgeline', values: {} },
    {
      name: 'Pulsar',
      values: { paper: '#000000', ink: '#f5ecd7', amp: 3.2, thick: 0.28, thin: 0.22, lines: 48, drift: 0.5 },
    },
    { name: 'Line scan', values: { amp: 0.25, ridge: false, thick: 1.2, thin: 0.04, lines: 90, drift: 0.12 } },
    { name: 'Photo lines', values: { colorMode: 1, paper: '#000000', lines: 72, thick: 0.8, thin: 0.2 } },
    { name: 'Basil wire', values: { ink: '#7fe08f', paper: '#07140b', amp: 2.4, thick: 0.45, thin: 0.12 } },
    { name: 'Pepperoni press', values: { ink: '#ff5a3c', lines: 100, amp: 1.2, thick: 1.1, thin: 0.06 } },
    { name: 'Blue still', values: { speed: 0, drift: 0, amp: 2.4, lines: 52, thick: 0.6, thin: 0.08, ink: '#1d4f9c' } },
  ],
  glsl: /* glsl */ `
float dlDrift(float x, float j, float t) {
  float n = vnoise(vec2(x * 3.0 + t * 0.35, j * 0.23 - t * 0.12)) - 0.5;
  float w = sin(x * TAU * 1.5 + j * 0.45 + t * 0.8);
  return (n * 1.6 + w * 0.35) * u_drift;
}

float dlTone(vec3 c) { return clamp((luma(c) - 0.5) * 1.3 + 0.5, 0.0, 1.0); }

vec4 effect(vec2 uv) {
  float sp = u_res.y / u_lines;
  vec2 px = uv * u_res;
  float t = u_time * u_speed;
  float h = max(sp * 0.5, 1.0);
  float hu = h / u_res.x;
  int cm = int(u_colorMode + 0.5);
  bool ridge = u_ridge > 0.5;
  vec3 col = u_paper;
  float j0 = floor(px.y / sp) - 3.0;
  for (int k = 0; k < 8; k++) {
    float j = j0 + float(k);
    if (j < -0.5 || j > u_lines - 0.5) continue;
    float yb = (j + 0.5) * sp;
    float v = yb / u_res.y;
    vec4 c0 = srcAvg(vec2(uv.x, v), sp);
    vec4 c1 = srcAvg(vec2(uv.x + hu, v), sp);
    float t0 = dlTone(c0.rgb);
    float t1 = dlTone(c1.rgb);
    float y0 = yb - ((t0 - 0.5) * u_amp + dlDrift(uv.x, j, t)) * sp;
    float y1 = yb - ((t1 - 0.5) * u_amp + dlDrift(uv.x + hu, j, t)) * sp;
    float slope = (y1 - y0) / h;
    float d = (px.y - y0) / sqrt(1.0 + slope * slope);
    float w = mix(u_thin, u_thick, 1.0 - t0) * sp * 0.5;
    vec3 lc = cm == 1 ? clamp(saturation(c0.rgb, 1.35) * 1.15 + 0.05, 0.0, 1.0) : u_ink;
    // Lines lower down are in front: they hide what lies beneath them.
    if (ridge && d > 0.0) col = u_paper;
    col = mix(col, lc, fill(abs(d) - w, 1.0) * c0.a);
  }
  return vec4(col, src(uv).a);
}
`,
};

const glitchGrid: EffectDef = {
  id: 'glitch-grid',
  name: 'Glitch Grid',
  category: 'halftone',
  description: 'A pixel grid whose blocks jump, swap, smear and RGB-split in stepped bursts.',
  params: [
    { type: 'range', key: 'cells', label: 'Cells', min: 16, max: 200, step: 1, default: 72 },
    { type: 'range', key: 'amount', label: 'Glitch', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1 },
    {
      type: 'select',
      key: 'mode',
      label: 'Cells',
      options: [
        { value: 0, label: 'Pixels' },
        { value: 1, label: 'Halftone' },
        { value: 2, label: 'Mixed' },
      ],
      default: 2,
    },
    { type: 'range', key: 'block', label: 'Block size', min: 2, max: 16, step: 1, default: 6, group: 'Glitch' },
    { type: 'range', key: 'shift', label: 'Shift', min: 0, max: 12, step: 1, default: 4, group: 'Glitch' },
    { type: 'range', key: 'split', label: 'RGB split', min: 0, max: 4, step: 1, default: 1, group: 'Glitch' },
    { type: 'toggle', key: 'invert', label: 'Invert some', default: true, group: 'Glitch' },
    { type: 'range', key: 'gap', label: 'Grid lines', min: 0, max: 0.4, default: 0.12, group: 'Ink' },
    { type: 'color', key: 'line', label: 'Grid colour', default: '#000000', group: 'Ink' },
  ],
  presets: [
    { name: 'Corrupted', values: {} },
    { name: 'Clean pixels', values: { mode: 0, amount: 0.25, split: 0 } },
    { name: 'Datamosh', values: { amount: 0.9, block: 10, shift: 8, split: 2, cells: 96 } },
    { name: 'Halftone tear', values: { mode: 1, cells: 90, gap: 0.05 } },
    { name: 'Chunky', values: { cells: 36, block: 4, shift: 3, split: 1, gap: 0.18 } },
    { name: 'Paper grid', values: { mode: 0, line: '#f5ecd7', gap: 0.2, invert: false, split: 2 } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  vec2 g = uv * u_res / cell;
  vec2 cid = floor(g);
  vec2 cp = fract(g);
  vec2 cells = u_res / cell;
  float st = floor(u_time * u_speed * 6.0) + floor(u_seed * 997.0);
  vec2 off = vec2(0.0);
  float glitch = 0.0;
  float split = 0.0;
  float inv = 0.0;
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    vec2 bsz = L == 0 ? vec2(2.0, 1.0) * u_block : (L == 1 ? vec2(1.0, 1.5) * max(1.0, floor(u_block * 0.5)) : vec2(cells.x, 1.0));
    bsz = max(floor(bsz + 0.5), vec2(1.0));
    vec2 bo = floor(hash22(vec2(fl * 7.3, st * 0.37 + fl)) * bsz);
    vec2 bid = floor((cid + off + bo) / bsz);
    float prob = u_amount * (L == 2 ? 0.14 : 0.3);
    float h = hash13(vec3(bid, st * 1.37 + fl * 19.0));
    if (h < prob) {
      vec3 r = hash32(bid + vec2(st * 7.1, fl * 3.3));
      glitch = 1.0;
      if (L == 2 || r.z < 0.45) {
        vec2 sh = floor((r.xy - 0.5) * 2.0 * u_shift + 0.5);
        if (L == 2) sh = vec2(floor((r.x - 0.5) * 4.0 * u_shift + 0.5), 0.0);
        off += sh;
      } else if (r.z < 0.8) {
        off += floor((r.xy - 0.5) * cells * 0.6 + 0.5);
      } else {
        // Smear: the whole block repeats its first column.
        off.x = bid.x * bsz.x - bo.x - cid.x;
      }
      split = max(split, r.y > 0.35 ? 1.0 : 0.0);
      inv = max(inv, fract(r.x * 13.7) > 0.8 ? 1.0 : 0.0);
    }
  }
  vec2 cuv = fract((cid + off + 0.5) / cells);
  float dx = split * u_split / cells.x;
  vec3 col = vec3(srcAvg(fract(cuv + vec2(dx, 0.0)), cell).r, srcAvg(cuv, cell).g, srcAvg(fract(cuv - vec2(dx, 0.0)), cell).b);
  if (u_invert > 0.5 && inv > 0.5) col = 1.0 - col;

  float aa = 1.2 / cell;
  int mode = int(u_mode + 0.5);
  bool dots = mode == 1 || (mode == 2 && glitch < 0.5);
  vec2 f = cp - 0.5;
  float cover;
  if (dots) {
    float r = sqrt(clamp(luma(col) * 1.1, 0.0, 1.0)) * (0.62 - u_gap * 0.25);
    cover = fill(length(f) - r, aa);
    col = saturation(col, 1.25) * 1.12;
  } else {
    cover = fill(sdBox(f, vec2(0.5 - u_gap * 0.5)), aa);
  }
  vec3 bg = u_line;
  if (dots) {
    float gl = fill(min(min(cp.x, 1.0 - cp.x), min(cp.y, 1.0 - cp.y)) - u_gap * 0.25, aa);
    bg = mix(u_line, mix(u_line, vec3(0.5), 0.25), gl);
  }
  return vec4(mix(bg, col, cover), src(uv).a);
}
`,
};

const glyphMatrix: EffectDef = {
  id: 'glyph-matrix',
  name: 'Glyph Matrix',
  category: 'halftone',
  description: 'An LED dot-matrix panel: round LEDs on a dark board, lit by brightness with a soft glow.',
  params: [
    { type: 'range', key: 'cols', label: 'LEDs across', min: 16, max: 200, step: 1, default: 80 },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 4 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 2, unit: '×' },
    {
      type: 'select',
      key: 'mode',
      label: 'Colour',
      options: [
        { value: 0, label: 'One colour' },
        { value: 1, label: 'Photo' },
      ],
      default: 0,
    },
    { type: 'color', key: 'color', label: 'LED colour', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'board', label: 'Board', default: '#0b0b0c', group: 'Ink' },
    { type: 'range', key: 'size', label: 'LED size', min: 0.3, max: 1, default: 0.74, group: 'Shape' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 1, group: 'Light' },
    { type: 'range', key: 'speed', label: 'Marquee', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Glyph white', values: {} },
    { name: 'Amber sign', values: { color: '#ffb13d', levels: 3, cols: 64 } },
    { name: 'Red ticker', values: { color: '#ff5a3c', levels: 2, speed: 1, cols: 72, contrast: 2.4 } },
    { name: 'Photo LEDs', values: { mode: 1, levels: 6, contrast: 1.5 } },
    { name: 'Basil board', values: { color: '#7fe08f', cols: 110, size: 0.66, glow: 1.4 } },
    { name: 'Big bulbs', values: { cols: 36, size: 0.82, levels: 5, glow: 1.6, color: '#ffc53d' } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float pitch = u_res.x / u_cols;
  vec2 g = uv * u_res / pitch;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float shift = floor(u_time * u_speed * 8.0) / u_cols;
  int mode = int(u_mode + 0.5);
  float n = max(u_levels - 1.0, 1.0);
  vec3 glow = vec3(0.0);
  vec3 me = u_color;
  float meL = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 suv = (id + o + 0.5) * pitch / u_res;
      suv.x = fract(suv.x + shift);
      vec4 s = srcAvg(suv, pitch);
      float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0) * s.a;
      float lv = floor(tn * n + 0.5) / n;
      vec3 c = u_color;
      if (mode == 1) c = saturation(s.rgb / max(max(s.r, max(s.g, s.b)), 0.08), 1.2);
      vec2 d = o - f;
      glow += c * lv * exp(-dot(d, d) * 3.0);
      if (i == 0 && j == 0) {
        me = c;
        meL = lv;
      }
    }
  }
  float r = u_size * 0.5;
  float dd = length(f);
  float aa = 1.2 / pitch;
  float disc = fill(dd - r, aa);
  float core = 1.0 - smoothstep(0.0, r, dd);
  vec3 unlit = (mode == 1 ? vec3(0.5) : u_color) * 0.06 + vec3(0.035);
  vec3 lit = me * (0.75 + 0.5 * core) + vec3(pow(core, 3.0) * 0.4);
  vec3 led = mix(unlit, lit, meL);
  // Lens highlight on each LED.
  led += fill(length(f + vec2(0.32, 0.36) * r) - r * 0.22, aa * 2.0) * (0.06 + 0.1 * meL);
  vec3 board = u_board * (0.9 + 0.1 * vnoise(uv * u_res / pitch * 0.5));
  // Dark bezel ring around each LED.
  board *= 1.0 - 0.6 * fill(abs(dd - r * 1.1) - r * 0.1, aa);
  vec3 col = mix(board, led, disc);
  col += glow * u_glow * 0.2 * (1.0 - disc * 0.6);
  return vec4(col, src(uv).a);
}
`,
};

const pixelPress: EffectDef = {
  id: 'pixel-press',
  name: 'Pixel Press',
  category: 'halftone',
  description: 'Chunky pixels pressed into plastic: every block bevelled, lit from the top left.',
  params: [
    { type: 'range', key: 'cells', label: 'Blocks', min: 8, max: 160, step: 1, default: 40 },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 16, step: 1, default: 6 },
    {
      type: 'select',
      key: 'shape',
      label: 'Bevel',
      options: [
        { value: 0, label: 'Chamfer' },
        { value: 1, label: 'Pillow' },
        { value: 2, label: 'Pressed in' },
      ],
      default: 0,
    },
    { type: 'range', key: 'bevel', label: 'Bevel width', min: 0.05, max: 0.6, default: 0.3, group: 'Shape' },
    { type: 'range', key: 'round', label: 'Corners', min: 0, max: 1, default: 0.2, group: 'Shape' },
    { type: 'range', key: 'gap', label: 'Gap', min: 0, max: 0.3, default: 0.05, group: 'Shape' },
    { type: 'range', key: 'depth', label: 'Depth', min: 0, max: 2, default: 1, unit: '×', group: 'Light' },
    {
      type: 'range',
      key: 'light',
      label: 'Light angle',
      min: 0,
      max: 360,
      step: 1,
      default: 135,
      unit: '°',
      group: 'Light',
    },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'One plastic' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'tint', label: 'Plastic', default: '#ffc53d', group: 'Ink' },
  ],
  presets: [
    { name: 'Pressed plastic', values: {} },
    { name: 'Pillows', values: { shape: 1, bevel: 0.55, round: 0.6, cells: 32 } },
    { name: 'Stamped in', values: { shape: 2, bevel: 0.4, gap: 0, cells: 36 } },
    { name: 'Keycaps', values: { cells: 24, bevel: 0.36, round: 0.35, gap: 0.12, levels: 5 } },
    { name: 'Cheese mould', values: { colorMode: 1, tint: '#ffc53d', cells: 48 } },
    { name: 'Fine tiles', values: { cells: 90, bevel: 0.35, levels: 8, gap: 0.04 } },
    { name: 'Red plastic', values: { colorMode: 1, tint: '#ff5a3c', shape: 1, bevel: 0.5, round: 0.5 } },
  ],
  glsl: /* glsl */ `
float ppHeight(vec2 p, float hs, float rad, float bev, int shape) {
  float t = -sdRoundBox(p - 0.5, vec2(hs), rad);
  if (shape == 2) {
    float rim = bev * 0.3;
    return t < rim ? clamp(t / rim, 0.0, 1.0) : 1.0 - 0.7 * clamp((t - rim) / bev, 0.0, 1.0);
  }
  float h = clamp(t / bev, 0.0, 1.0);
  if (shape == 1) h = sin(h * PI * 0.5);
  return h;
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  Cell c = grid(uv, vec2(cell));
  vec4 s = srcAvg(c.center, cell);
  float n = max(u_levels - 1.0, 1.0);
  vec3 base;
  if (int(u_colorMode + 0.5) == 1) {
    float tn = floor(luma(s.rgb) * n + 0.5) / n;
    base = materialRamp(u_tint, tn);
  } else {
    // Posterise value and saturation, keep hue close, so browns stay brown.
    vec3 hsv = rgb2hsv(clamp(saturation(s.rgb, 1.15), 0.0, 1.0));
    hsv.x = floor(hsv.x * 24.0 + 0.5) / 24.0;
    hsv.yz = floor(hsv.yz * n + 0.5) / n;
    base = hsv2rgb(hsv);
  }
  int shape = int(u_shape + 0.5);
  float hs = 0.5 - u_gap * 0.5;
  float rad = u_round * 0.5 * hs;
  float bev = max(u_bevel * 0.5, 0.01);
  float e = 0.75 / cell;
  vec2 p = c.p;
  float h = ppHeight(p, hs, rad, bev, shape);
  float hx = ppHeight(p + vec2(e, 0.0), hs, rad, bev, shape);
  float hy = ppHeight(p + vec2(0.0, e), hs, rad, bev, shape);
  vec2 grad = vec2(hx - h, hy - h) / e;
  vec3 nrm = normalize(vec3(-grad * bev * u_depth, 1.0));
  float ang = radians(u_light);
  vec2 l2 = vec2(cos(ang), -sin(ang));
  vec3 L = normalize(vec3(l2, 1.0));
  float lam = max(dot(nrm, L), 0.0) / L.z;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(nrm, H), 0.0), 30.0) * 0.32;
  float d = sdRoundBox(p - 0.5, vec2(hs), rad);
  float inside = fill(d, 1.2 / cell);
  // Plastic face: a faint sheen across each block.
  vec3 face = base * (0.28 + 0.72 * lam) * (1.0 + 0.05 * (0.5 - p.y)) + spec;
  // The groove between blocks, shaded by the block's own cast shadow.
  float sh = fill(sdRoundBox(p - 0.5 + l2 * 0.07, vec2(hs), rad), 0.08);
  vec3 groove = base * 0.3 * (1.0 - 0.55 * sh);
  return vec4(mix(groove, face, inside), s.a);
}
`,
};

const patternHalftone: EffectDef = {
  id: 'pattern-halftone',
  name: 'Pattern Halftone',
  category: 'halftone',
  description: 'Each tone gets its own print pattern: dots, crosses, stripes, checks, hatching, solid.',
  params: [
    { type: 'range', key: 'cells', label: 'Pattern size', min: 16, max: 200, step: 1, default: 80 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×' },
    { type: 'range', key: 'bright', label: 'Brightness', min: -0.5, max: 0.5, default: 0 },
    {
      type: 'select',
      key: 'regions',
      label: 'Regions',
      options: [
        { value: 0, label: 'Cells' },
        { value: 1, label: 'Smooth' },
      ],
      default: 1,
      group: 'Shape',
    },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 0, unit: '°', group: 'Shape' },
    { type: 'range', key: 'weight', label: 'Line weight', min: 0.5, max: 1.6, default: 1, unit: '×', group: 'Shape' },
    {
      type: 'select',
      key: 'mode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo ink' },
        { value: 2, label: 'Pop' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Pattern book', values: {} },
    { name: 'Photo ink', values: { mode: 1, cells: 100 } },
    { name: 'Pop poster', values: { mode: 2, cells: 60 } },
    { name: 'Tiled cells', values: { regions: 0, cells: 56 } },
    { name: 'Blueprint', values: { ink: '#e8f0ff', paper: '#123a7a', angle: 45, contrast: 1.5 } },
    { name: 'Fine print', values: { cells: 150, weight: 0.8, ink: '#2a1b12' } },
  ],
  glsl: /* glsl */ `
float phStripe(float v, float cov, float aa) { return fill((abs(fract(v) - 0.5) - cov * 0.5) * 0.7071, aa); }

// Ink cover (0–1) of pattern lvl (0 = paper … 7 = solid) at g (cell units).
float phPattern(int lvl, vec2 g, float aa) {
  vec2 f = fract(g) - 0.5;
  float w = u_weight;
  if (lvl <= 0) return 0.0;
  if (lvl == 1) return fill(length(f) - 0.2 * sqrt(w), aa);
  if (lvl == 2) return fill(min(sdBox(f, vec2(0.38, 0.12 * w)), sdBox(f, vec2(0.12 * w, 0.38))), aa);
  if (lvl == 3) return phStripe(g.x + g.y, 0.42 * w, aa);
  if (lvl == 4) {
    vec2 k = floor(g * 2.0);
    vec2 q = fract(g * 2.0) - 0.5;
    float e = min(0.5 - abs(q.x), 0.5 - abs(q.y)) * 0.5;
    float par = mod(k.x + k.y, 2.0);
    return mix(0.5, par, clamp(e / aa, 0.0, 1.0));
  }
  if (lvl == 5) return max(phStripe(g.x + g.y, 0.4 * w, aa), phStripe(g.x - g.y, 0.4 * w, aa));
  if (lvl == 6) return 1.0 - fill(length(f) - 0.27 / sqrt(w), aa);
  return 1.0;
}

vec3 phPop(int lvl) {
  vec3 P[8] = vec3[8](vec3(0.96, 0.93, 0.84), vec3(0.5, 0.88, 0.56), vec3(0.5, 0.88, 0.56), vec3(1.0, 0.77, 0.24),
    vec3(1.0, 0.77, 0.24), vec3(1.0, 0.35, 0.24), vec3(1.0, 0.35, 0.24), vec3(0.08, 0.07, 0.06));
  return P[clamp(lvl, 0, 7)];
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  vec2 px = uv * u_res;
  mat2 R = rot(radians(u_angle));
  vec2 g = R * px / cell;
  vec4 s;
  if (int(u_regions + 0.5) == 0) {
    vec2 cc = transpose(R) * ((floor(g) + 0.5) * cell);
    s = srcAvg(cc / u_res, cell);
  } else {
    s = srcAvg(uv, cell * 0.5);
  }
  float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5 + u_bright, 0.0, 1.0);
  int lvl = clamp(int((1.0 - tn) * 8.0), 0, 7);
  float aa = 1.2 / cell;
  float cov = phPattern(lvl, g, aa);
  int mode = int(u_mode + 0.5);
  vec3 ink = u_ink;
  vec3 paper = u_paper;
  if (mode == 1) ink = clamp(saturation(s.rgb, 1.5) * 0.85, 0.0, 1.0);
  if (mode == 2) {
    paper = phPop(lvl);
    ink = lvl >= 5 ? vec3(0.08, 0.07, 0.06) : mix(phPop(lvl + 2), vec3(0.08, 0.07, 0.06), 0.35);
    if (lvl == 7) ink = vec3(0.08, 0.07, 0.06);
  }
  return vec4(mix(paper, ink, cov), src(uv).a);
}
`,
};

const pixelDitherGlow: EffectDef = {
  id: 'pixel-dither-glow',
  name: 'Pixel Dither Glow',
  category: 'halftone',
  description: 'Dithered chunky pixels on black, each lit pixel haloed in neon glow.',
  params: [
    { type: 'range', key: 'cells', label: 'Pixels across', min: 16, max: 200, step: 1, default: 96 },
    { type: 'range', key: 'levels', label: 'Levels', min: 1, max: 6, step: 1, default: 2 },
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Neon' },
        { value: 2, label: 'Synthwave' },
        { value: 3, label: 'Pizza' },
      ],
      default: 0,
    },
    { type: 'color', key: 'color', label: 'Neon', default: '#7fe08f', group: 'Ink' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.7, unit: '×', group: 'Tone' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 1, group: 'Light' },
    { type: 'range', key: 'radius', label: 'Glow radius', min: 0.4, max: 2, default: 1.1, group: 'Light' },
    { type: 'range', key: 'gap', label: 'Pixel gap', min: 0, max: 0.4, default: 0.14, group: 'Shape' },
    { type: 'range', key: 'speed', label: 'Twinkle', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Neon photo', values: {} },
    { name: 'Basil neon', values: { palette: 1, levels: 1, cells: 110 } },
    { name: 'Synthwave', values: { palette: 2, levels: 3, cells: 80 } },
    { name: 'Hot pizza', values: { palette: 3, levels: 3 } },
    { name: 'Big pixels', values: { cells: 48, levels: 3, radius: 1.5, gap: 0.2 } },
    { name: 'Pink haze', values: { palette: 1, color: '#ff48b0', glow: 1.8, radius: 1.8, levels: 2 } },
  ],
  glsl: /* glsl */ `
vec3 pdgColor(vec3 c, float lv) {
  int p = int(u_palette + 0.5);
  if (p == 1) return u_color * lv;
  if (p == 2) return lv < 0.01 ? vec3(0.0) : ramp3(vec3(0.42, 0.17, 1.0), vec3(1.0, 0.28, 0.69), vec3(0.3, 0.9, 1.0), lv);
  if (p == 3) return lv < 0.01 ? vec3(0.0) : ramp3(vec3(0.75, 0.12, 0.08), vec3(1.0, 0.45, 0.2), vec3(1.0, 0.85, 0.45), lv);
  vec3 hue = saturation(c / max(max(c.r, max(c.g, c.b)), 0.1), 1.4);
  return clamp(hue, 0.0, 1.0) * lv;
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  vec2 g = uv * u_res / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float n = u_levels;
  float t = u_time * u_speed;
  vec3 glow = vec3(0.0);
  vec3 me = vec3(0.0);
  float rr = u_radius * u_radius;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 nid = id + o;
      vec4 s = srcAvg((nid + 0.5) * cell / u_res, cell);
      float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.42, 0.0, 1.0) * s.a;
      float lv = clamp(floor(tn * n + bayer4(nid)) / n, 0.0, 1.0);
      vec3 pc = pdgColor(s.rgb, lv);
      float tw = 1.0 + 0.3 * sin(t * 2.5 + hash12(nid) * TAU) * step(0.001, u_speed);
      vec2 d = o - f;
      glow += pc * tw * exp(-dot(d, d) / rr);
      if (i == 0 && j == 0) me = pc;
    }
  }
  float aa = 1.2 / cell;
  float px = fill(sdRoundBox(f, vec2(0.5 - u_gap * 0.5), 0.08), aa);
  float core = 1.0 - smoothstep(0.0, 0.5, length(f));
  vec3 pix = me * (0.8 + 0.4 * core) * px;
  vec3 halo = 1.0 - exp(-glow * u_glow * 0.35);
  vec3 col = 1.0 - (1.0 - pix) * (1.0 - halo);
  return vec4(col, src(uv).a);
}
`,
};

const pixelPoster: EffectDef = {
  id: 'pixel-poster',
  name: 'Pixel Poster',
  category: 'halftone',
  pick: true,
  description: 'Posterised pixel art in a few colours, each big pixel knitted or woven, on a tinted ground.',
  params: [
    { type: 'range', key: 'cells', label: 'Pixels across', min: 12, max: 160, step: 1, default: 48 },
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Poster levels' },
        { value: 1, label: 'Pizza' },
        { value: 2, label: '16 colours' },
      ],
      default: 0,
    },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 6, step: 1, default: 3 },
    {
      type: 'select',
      key: 'bgMode',
      label: 'Background',
      options: [
        { value: 0, label: 'None' },
        { value: 1, label: 'Darks' },
        { value: 2, label: 'Lights' },
      ],
      default: 1,
    },
    { type: 'range', key: 'cut', label: 'Background cut', min: 0, max: 0.8, default: 0.32, group: 'Tone' },
    { type: 'range', key: 'sat', label: 'Saturation', min: 0, max: 2, default: 1.3, unit: '×', group: 'Tone' },
    { type: 'color', key: 'bg', label: 'Background', default: '#2d5bd7', group: 'Ink' },
    {
      type: 'select',
      key: 'texture',
      label: 'Texture',
      options: [
        { value: 0, label: 'Knit' },
        { value: 1, label: 'Weave' },
      ],
      default: 0,
      group: 'Shape',
    },
    { type: 'range', key: 'depth', label: 'Texture depth', min: 0, max: 1, default: 0.85, group: 'Shape' },
  ],
  presets: [
    { name: 'Knitted poster', values: {} },
    { name: 'Woven blue', values: { texture: 1, cells: 56 } },
    { name: 'Pizza yarn', values: { palette: 1, bg: '#7fe08f', cells: 40 } },
    { name: '16-colour tapestry', values: { palette: 2, texture: 1, bgMode: 0, cells: 64 } },
    { name: 'Cream jumper', values: { bg: '#f5ecd7', palette: 1, cells: 36 } },
    { name: 'Night knit', values: { bg: '#15120e', levels: 4, cells: 60 } },
  ],
  glsl: /* glsl */ `
vec3 ppoNearest(vec3 c, int pal) {
  vec3 best = c;
  float bd = 1e9;
  if (pal == 1) {
    vec3 P[8] = vec3[8](vec3(0.08, 0.07, 0.06), vec3(0.96, 0.93, 0.84), vec3(1.0, 0.77, 0.24), vec3(1.0, 0.35, 0.24),
      vec3(0.5, 0.88, 0.56), vec3(0.72, 0.45, 0.23), vec3(0.55, 0.16, 0.11), vec3(0.35, 0.23, 0.13));
    for (int i = 0; i < 8; i++) {
      vec3 d = c - P[i];
      float rm = (c.r + P[i].r) * 0.5;
      float e = dot(d * d, vec3(2.0 + rm, 4.0, 3.0 - rm));
      if (e < bd) { bd = e; best = P[i]; }
    }
    return best;
  }
  vec3 Q[16] = vec3[16](vec3(0.0), vec3(0.114, 0.169, 0.325), vec3(0.494, 0.145, 0.325), vec3(0.0, 0.529, 0.318),
    vec3(0.671, 0.322, 0.212), vec3(0.373, 0.341, 0.31), vec3(0.761, 0.765, 0.78), vec3(1.0, 0.945, 0.91),
    vec3(1.0, 0.0, 0.302), vec3(1.0, 0.639, 0.0), vec3(1.0, 0.925, 0.153), vec3(0.0, 0.894, 0.212),
    vec3(0.161, 0.678, 1.0), vec3(0.514, 0.463, 0.612), vec3(1.0, 0.467, 0.659), vec3(1.0, 0.8, 0.667));
  for (int i = 0; i < 16; i++) {
    vec3 d = c - Q[i];
    float rm = (c.r + Q[i].r) * 0.5;
    float e = dot(d * d, vec3(2.0 + rm, 4.0, 3.0 - rm));
    if (e < bd) { bd = e; best = Q[i]; }
  }
  return best;
}

// One leg of a knit "V": an elongated, shaded loop of yarn.
float ppoLeg(vec2 p, vec2 c, float ang, out float shade) {
  vec2 q = rot(ang) * (p - c);
  vec2 r = vec2(0.2, 0.52);
  float e = length(q / r);
  float dome = sqrt(max(1.0 - e * e, 0.0));
  float ply = 0.5 + 0.5 * sin(q.y / r.y * 7.0 + q.x / r.x * 1.8);
  shade = (0.5 + 0.62 * dome) * (0.82 + 0.26 * ply);
  return (e - 1.0) * r.x;
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  int tex = int(u_texture + 0.5);
  Cell c = grid(uv, tex == 0 ? vec2(cell, cell * 0.8) : vec2(cell));
  vec4 s = srcAvg(c.center, cell);
  vec3 sc = clamp(saturation(s.rgb, u_sat), 0.0, 1.0);
  float tn = luma(s.rgb);
  int pal = int(u_palette + 0.5);
  vec3 col;
  if (pal == 0) {
    float n = max(u_levels - 1.0, 1.0);
    vec3 hsv = rgb2hsv(sc);
    hsv.x = floor(hsv.x * 18.0 + 0.5) / 18.0;
    hsv.yz = floor(hsv.yz * n + 0.5) / n;
    hsv.z = max(hsv.z, 0.5 / n);
    col = hsv2rgb(hsv);
  } else {
    col = ppoNearest(sc, pal);
  }
  int bm = int(u_bgMode + 0.5);
  // Background: dark (or light) cells in dark (or light) surroundings, so small dark details stay.
  float around = luma(srcAvg(c.center, cell * 6.0).rgb);
  if (bm == 1 && tn < u_cut && around < u_cut * 1.35) col = u_bg;
  if (bm == 2 && tn > 1.0 - u_cut && around > 1.0 - u_cut * 1.35) col = u_bg;

  float detail = smoothstep(3.0, 10.0, cell) * u_depth;
  vec2 p = c.p;
  float aa = 1.5 / cell;
  float shade;
  if (tex == 0) {
    float sl, sr;
    float cl = fill(ppoLeg(p, vec2(0.3, 0.47), -0.32, sl), aa);
    float cr = fill(ppoLeg(p, vec2(0.7, 0.47), 0.32, sr), aa);
    shade = mix(mix(0.3, sl, cl), sr, cr);
  } else {
    vec2 q = p * 3.0;
    vec2 fq = fract(q);
    float over = mod(floor(q.x) + floor(q.y), 2.0);
    float across = over > 0.5 ? fq.x : fq.y;
    float along = over > 0.5 ? fq.y : fq.x;
    shade = (0.42 + 0.66 * sin(PI * across)) * (0.8 + 0.22 * sin(PI * along));
  }
  shade *= 0.94 + 0.12 * hash12(floor(uv * u_res / max(cell * 0.08, 1.0)));
  return vec4(col * mix(1.0, shade * 1.1, detail), s.a);
}
`,
};

const retroMatrix: EffectDef = {
  id: 'retro-matrix',
  name: 'Retro Matrix',
  category: 'halftone',
  pick: true,
  description: 'A green-phosphor dot-matrix screen: round sub-pixels, scanlines and a soft glow.',
  params: [
    { type: 'range', key: 'cols', label: 'Dots across', min: 32, max: 320, step: 1, default: 150 },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 4 },
    {
      type: 'select',
      key: 'palette',
      label: 'Phosphor',
      options: [
        { value: 0, label: 'Green P1' },
        { value: 1, label: 'Amber P3' },
        { value: 2, label: 'White P4' },
        { value: 3, label: 'Cyan' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.4, unit: '×', group: 'Tone' },
    { type: 'range', key: 'dot', label: 'Dot size', min: 0.5, max: 1.5, default: 1, unit: '×', group: 'Screen' },
    { type: 'range', key: 'scan', label: 'Scanlines', min: 0, max: 1, default: 0.6, group: 'Screen' },
    { type: 'range', key: 'curve', label: 'Curvature', min: 0, max: 1, default: 0.35, group: 'Screen' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 0.8, group: 'Screen' },
    { type: 'range', key: 'speed', label: 'Refresh', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Green phosphor', values: {} },
    { name: 'Amber terminal', values: { palette: 1, cols: 120 } },
    { name: 'Paper white', values: { palette: 2, levels: 6, glow: 0.5 } },
    { name: 'Coarse LCD', values: { cols: 72, levels: 3, curve: 0, scan: 0.3, glow: 0.4 } },
    { name: 'Cyan radar', values: { palette: 3, levels: 5, glow: 1.4 } },
    { name: 'Flat panel', values: { curve: 0, speed: 0, scan: 0.2, cols: 200 } },
  ],
  glsl: /* glsl */ `
vec3 rmPhos(float v) {
  int p = int(u_palette + 0.5);
  vec3 lo = vec3(0.01, 0.07, 0.02), mid = vec3(0.15, 0.95, 0.3), hi = vec3(0.78, 1.0, 0.72);
  if (p == 1) { lo = vec3(0.09, 0.03, 0.0); mid = vec3(1.0, 0.6, 0.05); hi = vec3(1.0, 0.9, 0.62); }
  else if (p == 2) { lo = vec3(0.05, 0.05, 0.06); mid = vec3(0.72, 0.76, 0.8); hi = vec3(1.0); }
  else if (p == 3) { lo = vec3(0.0, 0.05, 0.09); mid = vec3(0.1, 0.7, 1.0); hi = vec3(0.78, 0.96, 1.0); }
  return v < 0.6 ? mix(lo, mid, v / 0.6) : mix(mid, hi, (v - 0.6) / 0.4);
}

float rmTone(vec3 c) { return clamp((luma(c) - 0.5) * u_contrast + 0.5, 0.0, 1.0); }

vec4 effect(vec2 uv) {
  vec2 d = uv - 0.5;
  float k = u_curve * 0.45;
  vec2 cuv = 0.5 + d * (1.0 + k * dot(d, d)) / (1.0 + k * 0.25);
  float t = u_time * u_speed;
  float pitch = u_res.x / u_cols;
  vec2 g = cuv * u_res / pitch;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec4 s = srcAvg((id + 0.5) * pitch / u_res, pitch);
  float n = max(u_levels - 1.0, 1.0);
  float lv = floor(rmTone(s.rgb) * s.a * n + 0.5) / n;
  float r2 = dot(f, f);
  float dm = exp(-r2 / (0.075 * u_dot * u_dot));
  float beam = exp(-f.y * f.y / 0.05);
  float mask = mix(dm, beam * (0.7 + 0.3 * dm), 0.3 * u_scan);
  vec3 col = rmPhos(lv) * mask * 1.25 * (0.35 + 0.65 * smoothstep(0.0, 0.34, lv));
  col *= 1.0 - u_scan * 0.35 * smoothstep(0.3, 0.5, abs(f.y));
  // Phosphor bloom and the glass's own faint glow.
  float bt = rmTone(srcAvg(cuv, pitch * 6.0).rgb);
  col += rmPhos(bt) * bt * bt * u_glow * 0.3;
  col += rmPhos(0.0) * 0.7;
  // Rolling refresh band and a little flicker.
  float on = step(0.001, u_speed);
  float bar = exp(-pow((fract(cuv.y * 0.7 - t * 0.12) - 0.5) * 7.0, 2.0));
  col *= 1.0 + (0.14 * bar + 0.025 * sin(t * 47.0)) * on;
  col *= 1.0 - dot(d, d) * (0.4 + 1.2 * u_curve);
  // Rounded tube edges.
  vec2 hp = (cuv - 0.5) * u_res;
  float rad = u_res.y * 0.06 * u_curve;
  float edge = fill(sdRoundBox(hp, u_res * 0.5, rad), 1.5);
  return vec4(col * edge, src(uv).a);
}
`,
};

const riso: EffectDef = {
  id: 'riso',
  name: 'Riso',
  category: 'halftone',
  pick: true,
  description: 'A two-colour risograph: pink and blue ink layers, grainy and slightly out of register.',
  params: [
    { type: 'range', key: 'cells', label: 'Screen', min: 20, max: 240, step: 1, default: 100 },
    { type: 'color', key: 'inkA', label: 'Ink 1', default: '#ff48b0' },
    { type: 'color', key: 'inkB', label: 'Ink 2', default: '#0078bf' },
    { type: 'range', key: 'misreg', label: 'Misregistration', min: 0, max: 2, default: 0.45, unit: '%' },
    {
      type: 'select',
      key: 'screen',
      label: 'Screen',
      options: [
        { value: 0, label: 'Dots' },
        { value: 1, label: 'Grain' },
        { value: 2, label: 'Lines' },
      ],
      default: 0,
      group: 'Print',
    },
    { type: 'range', key: 'grain', label: 'Grain', min: 0, max: 1, default: 0.5, group: 'Print' },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 90, step: 1, default: 15, unit: '°', group: 'Print' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.2, unit: '×', group: 'Tone' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f3eee3', group: 'Ink' },
  ],
  presets: [
    { name: 'Pink + blue', values: {} },
    { name: 'Grainy', values: { screen: 1, grain: 0.7 } },
    { name: 'Sunny', values: { inkA: '#ffe800', inkB: '#ff5a3c', misreg: 0.7 } },
    { name: 'Green + orange', values: { inkA: '#ff6c2f', inkB: '#00a95c', cells: 80 } },
    { name: 'Teal lines', values: { screen: 2, inkA: '#ff48b0', inkB: '#00838a', cells: 120, angle: 30 } },
    { name: 'Coarse zine', values: { cells: 55, misreg: 1.1, grain: 0.8 } },
  ],
  glsl: /* glsl */ `
// Least-squares amounts of the two inks (multiplied on white) that best match colour c.
vec2 risoInks(vec3 c) {
  vec3 kA = 1.0 - u_inkA;
  vec3 kB = 1.0 - u_inkB;
  vec3 D = 1.0 - clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float aa = dot(kA, kA) + 0.03;
  float ab = dot(kA, kB);
  float bb = dot(kB, kB) + 0.03;
  float ra = dot(kA, D);
  float rb = dot(kB, D);
  float det = aa * bb - ab * ab;
  return clamp(vec2(bb * ra - ab * rb, aa * rb - ab * ra) / max(det, 1e-4), 0.0, 1.0);
}

float risoLayer(vec2 px, float angle, float cellPx, int layer, float gs) {
  mat2 R = rot(angle);
  vec2 r = R * px;
  vec2 cpx = transpose(R) * ((floor(r / cellPx) + 0.5) * cellPx);
  int scr = int(u_screen + 0.5);
  float fl = float(layer);
  vec2 inks = risoInks(srcAvg((scr == 1 ? px : cpx) / u_res, scr == 1 ? gs * 3.0 : cellPx).rgb);
  float a = layer == 0 ? inks.x : inks.y;
  float rough = vnoise(px / (gs * 2.2) + fl * 17.3) - 0.5;
  vec2 f = fract(r / cellPx) - 0.5;
  float cov;
  if (scr == 1) {
    float th = hash12(floor(px / gs) + fl * 31.7);
    cov = smoothstep(th - 0.1, th + 0.1, a * 1.05 + rough * 0.15);
  } else if (scr == 2) {
    cov = fill(abs(f.y) - a * 0.5 + rough * u_grain * 0.14, 1.2 / cellPx);
  } else {
    cov = fill(length(f) - sqrt(a) * 0.72 + rough * u_grain * 0.2, 1.2 / cellPx);
  }
  // Specks where the drum skipped, and uneven ink across the sheet.
  float skip = hash12(floor(px / gs) + fl * 57.1 + 3.7);
  cov *= 1.0 - step(skip, u_grain * 0.22) * 0.85;
  float dens = 0.78 + 0.22 * vnoise(px / u_res.x * 5.0 + fl * 9.0);
  return cov * dens;
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float cellPx = u_res.x / u_cells;
  float gs = max(u_res.x / 900.0, 1.0);
  vec2 mis = vec2(0.7, 0.45) * u_misreg * 0.01 * u_res.x;
  float ang = radians(u_angle);
  float a = risoLayer(px + mis * 0.35, ang, cellPx, 0, gs);
  float b = risoLayer(px - mis * 0.65, ang + radians(60.0), cellPx, 1, gs);
  vec3 paper = u_paper * (0.965 + 0.05 * vnoise(px / (gs * 4.0)));
  vec3 col = paper * mix(vec3(1.0), u_inkA, a) * mix(vec3(1.0), u_inkB, b);
  return vec4(col, src(uv).a);
}
`,
};

const risoGlow: EffectDef = {
  id: 'riso-glow',
  name: 'Riso Glow',
  category: 'halftone',
  pick: true,
  description: 'Grainy riso dots in luminous inks on dark paper, glowing as if lit from behind.',
  params: [
    { type: 'range', key: 'cells', label: 'Screen', min: 20, max: 220, step: 1, default: 90 },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 1 },
    { type: 'range', key: 'misreg', label: 'Misregistration', min: 0, max: 2, default: 0.5, unit: '%' },
    { type: 'range', key: 'speed', label: 'Shimmer', min: 0, max: 3, default: 1 },
    { type: 'color', key: 'inkA', label: 'Ink 1', default: '#ff48b0', group: 'Ink' },
    { type: 'color', key: 'inkB', label: 'Ink 2', default: '#ffc53d', group: 'Ink' },
    { type: 'color', key: 'inkC', label: 'Ink 3', default: '#3d8bff', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#120e18', group: 'Ink' },
    { type: 'range', key: 'grain', label: 'Grain', min: 0, max: 1, default: 0.55, group: 'Print' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×', group: 'Print' },
  ],
  presets: [
    { name: 'Backlit', values: {} },
    { name: 'Two inks', values: { inkC: '#000000' } },
    { name: 'Neon garden', values: { inkA: '#7fe08f', inkB: '#ffc53d', inkC: '#ff48b0', paper: '#07100b' } },
    { name: 'Ember', values: { inkA: '#ff5a3c', inkB: '#ffc53d', inkC: '#000000', glow: 1.6 } },
    { name: 'Coarse glow', values: { cells: 50, grain: 0.8, misreg: 1 } },
    { name: 'Still', values: { speed: 0, glow: 0.6 } },
  ],
  glsl: /* glsl */ `
// Luminous inks light up only the brighter parts: a contrast curve with a deep black point.
vec3 rgTone(vec3 c) { return pow(clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0), vec3(1.6)); }

float rgLayer(vec2 px, float angle, float cellPx, int layer, mat3 S, float gs, float st) {
  mat2 R = rot(angle);
  vec2 r = R * px;
  vec2 cpx = transpose(R) * ((floor(r / cellPx) + 0.5) * cellPx);
  vec3 amt = clamp(S * rgTone(srcAvg(cpx / u_res, cellPx).rgb), 0.0, 1.0);
  float a = layer == 0 ? amt.x : (layer == 1 ? amt.y : amt.z);
  a = smoothstep(0.06, 1.0, a);
  float fl = float(layer);
  float rough = vnoise(px / (gs * 2.2) + fl * 17.3 + st * 3.1) - 0.5;
  vec2 f = fract(r / cellPx) - 0.5;
  float cov = fill(length(f) - sqrt(a) * 0.7 + rough * u_grain * 0.22, 1.2 / cellPx);
  float skip = hash12(floor(px / gs) + fl * 57.1 + st * 1.3);
  cov *= 1.0 - step(skip, u_grain * 0.25) * 0.9;
  return cov * (0.75 + 0.25 * vnoise(px / u_res.x * 5.0 + fl * 9.0));
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float cellPx = u_res.x / u_cells;
  float gs = max(u_res.x / 900.0, 1.0);
  float t = u_time * u_speed;
  float st = floor(t * 8.0);
  // Additive least squares: amounts of the three light inks that sum to the picture.
  mat3 M = mat3(u_inkA, u_inkB, u_inkC);
  mat3 Mt = transpose(M);
  mat3 S = inverse(Mt * M + mat3(0.05)) * Mt;
  vec2 mis = u_misreg * 0.01 * u_res.x * vec2(1.0, 0.0);
  float a = rgLayer(px + mis * vec2(0.6, 0.3), radians(15.0), cellPx, 0, S, gs, st);
  float b = rgLayer(px + mis * vec2(-0.5, 0.5), radians(75.0), cellPx, 1, S, gs, st);
  float c = rgLayer(px + mis * vec2(-0.2, -0.6), radians(45.0), cellPx, 2, S, gs, st);
  // Backlit paper: brighter in the middle, with fibres.
  vec2 d = uv - 0.5;
  vec3 paper = u_paper * (0.8 + 0.5 * exp(-dot(d, d) * 3.0)) * (0.92 + 0.12 * vnoise(px / (gs * 5.0)));
  vec3 col = paper + (u_inkA * a + u_inkB * b + u_inkC * c) * 0.95;
  // Glow: the inks' light spread through the paper.
  vec3 t1 = rgTone(srcAvg(uv, cellPx * 3.0).rgb);
  vec3 t2 = rgTone(srcAvg(uv, cellPx * 9.0).rgb);
  vec3 g = clamp(S * t1, 0.0, 1.0) * 0.55 + clamp(S * t2, 0.0, 1.0) * 0.45;
  float pulse = 1.0 + 0.12 * sin(t * 1.7) * step(0.001, u_speed);
  col += (u_inkA * g.x + u_inkB * g.y + u_inkC * g.z) * u_glow * 0.42 * pulse;
  // Overlaps burn towards white.
  float mx = max(col.r, max(col.g, col.b));
  if (mx > 1.0) col = mix(col / mx, vec3(1.0), clamp((mx - 1.0) * 0.4, 0.0, 0.6));
  return vec4(col, src(uv).a);
}
`,
};

const scatterMosaic: EffectDef = {
  id: 'scatter-mosaic',
  name: 'Scatter Mosaic',
  category: 'halftone',
  description: 'Stippling: jittered dots, tiles or shards scattered over the picture, sized by tone.',
  params: [
    { type: 'range', key: 'cells', label: 'Density', min: 20, max: 260, step: 1, default: 130 },
    { type: 'range', key: 'jitter', label: 'Scatter', min: 0, max: 1, default: 0.85 },
    { type: 'range', key: 'size', label: 'Size', min: 0.3, max: 1.6, default: 1, unit: '×' },
    {
      type: 'select',
      key: 'shape',
      label: 'Shape',
      options: [
        { value: 0, label: 'Dots' },
        { value: 1, label: 'Tiles' },
        { value: 2, label: 'Shards' },
        { value: 3, label: 'Mixed' },
      ],
      default: 0,
    },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo on paper' },
        { value: 2, label: 'Photo on black' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'range', key: 'vary', label: 'Size variety', min: 0, max: 1, default: 0.3, group: 'Shape' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×', group: 'Tone' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Boil', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Stipple', values: {} },
    { name: 'Photo mosaic', values: { shape: 1, colorMode: 2, cells: 90, size: 1.1, jitter: 0.5 } },
    { name: 'Confetti', values: { shape: 3, colorMode: 1, cells: 80, vary: 0.6 } },
    { name: 'Shards', values: { shape: 2, colorMode: 2, cells: 70, size: 1.3 } },
    { name: 'Red stipple', values: { ink: '#ff5a3c', cells: 170, size: 0.9 } },
    { name: 'Boiling ink', values: { speed: 1, cells: 110 } },
  ],
  glsl: /* glsl */ `
float smTri(vec2 p, float r) {
  float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  vec2 g = uv * u_res / cell;
  vec2 id = floor(g);
  float st = floor(u_time * u_speed * 6.0);
  int cm = int(u_colorMode + 0.5);
  int shape = int(u_shape + 0.5);
  vec3 col = cm == 2 ? vec3(0.03) : u_paper;
  float aa = 1.2 / cell;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 nid = id + vec2(float(i), float(j));
      vec3 h = hash32(nid + st * 13.1 + u_seed * 71.0);
      vec2 pos = nid + 0.5 + (h.xy - 0.5) * u_jitter;
      vec4 s = srcAvg(pos * cell / u_res, cell);
      float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
      float amt = cm == 2 ? tn : 1.0 - tn;
      float rad = sqrt(amt) * 0.7 * u_size * mix(1.0, 0.45 + 0.9 * h.z, u_vary) * s.a;
      int sh = shape == 3 ? int(h.z * 3.0) : shape;
      vec2 q = rot(h.z * TAU * 3.0) * (g - pos);
      float d;
      if (sh == 1) d = sdBox(q, vec2(rad * 0.86));
      else if (sh == 2) d = smTri(q, rad * 1.1);
      else d = length(q) - rad;
      vec3 c = cm == 0 ? u_ink : clamp(saturation(s.rgb, 1.3) * (cm == 2 ? 1.15 : 0.95), 0.0, 1.0);
      if (cm != 0 && sh != 0) c *= 0.9 + 0.2 * h.y;
      col = mix(col, c, fill(d, aa));
    }
  }
  return vec4(col, src(uv).a);
}
`,
};

const SYMBOLS = '·+×○△□◇☆●■';

/** Unique symbols of the text, in order. */
function symbolList(text: string): string[] {
  return [...new Set(Array.from(text).filter((c) => c.trim() !== ''))];
}

const symbolMatrix: EffectDef = {
  id: 'symbol-matrix',
  name: 'Symbol Matrix',
  category: 'halftone',
  description: 'A grid of little symbols, from dots and crosses to stars and squares, picked by tone.',
  params: [
    { type: 'range', key: 'cols', label: 'Columns', min: 16, max: 200, step: 1, default: 64 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×' },
    { type: 'range', key: 'bright', label: 'Brightness', min: -0.5, max: 0.5, default: 0 },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Ink' },
        { value: 2, label: 'Palette' },
      ],
      default: 0,
    },
    { type: 'text', key: 'symbols', label: 'Symbols', default: SYMBOLS, maxLength: 32, group: 'Shape' },
    { type: 'range', key: 'scale', label: 'Symbol size', min: 0.5, max: 1.3, default: 0.95, unit: '×', group: 'Shape' },
    { type: 'toggle', key: 'invert', label: 'Dark on light', default: false, group: 'Ink' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#ffc53d', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Shuffle', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Colour symbols', values: {} },
    { name: 'Ink on cream', values: { colorMode: 1, invert: true, ink: '#15120e', paper: '#f5ecd7' } },
    { name: 'Pizza palette', values: { colorMode: 2, cols: 48 } },
    { name: 'Cheese signal', values: { colorMode: 1, cols: 90, speed: 1 } },
    { name: 'Geometry', values: { symbols: '·○◇□△●◆■▲', colorMode: 2, cols: 40, scale: 1.1 } },
    { name: 'Fine field', values: { cols: 130, contrast: 1.6 } },
  ],
  atlas: (p) => ({
    glyphs: symbolList(String(p.symbols || SYMBOLS)),
    sortByInk: true,
    font: 'sans',
    weight: 400,
    fill: 0.9,
  }),
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cols;
  Cell c = grid(uv, vec2(cell));
  vec4 s = srcAvg(c.center, cell);
  float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5 + u_bright, 0.0, 1.0);
  float t = u_invert > 0.5 ? 1.0 - tn : tn;
  float gi = rampIndex(t);
  if (u_speed > 0.0) {
    float h = hash13(vec3(c.id, floor(u_time * u_speed * 4.0 + hash12(c.id) * 7.0)));
    if (h > 0.96) gi = clamp(gi + (h > 0.98 ? 1.0 : -1.0), 0.0, u_glyphCount - 1.0);
  }
  // Symbols also grow with tone, like halftone dots.
  float sc = u_scale * mix(0.62, 1.05, t);
  vec2 p = (c.p - 0.5) / sc + 0.5;
  // Crisp strokes: thin outlines stay legible when the cells are small.
  float ink = smoothstep(0.04, 0.55, glyph(gi, p, cell * sc));
  int m = int(u_colorMode + 0.5);
  vec3 col;
  if (m == 1) col = u_ink;
  else if (m == 2) {
    vec3 P[4] = vec3[4](vec3(0.5, 0.88, 0.56), vec3(1.0, 0.77, 0.24), vec3(1.0, 0.35, 0.24), vec3(0.96, 0.93, 0.84));
    col = P[int(mod(gi, 4.0))];
    if (u_invert > 0.5) col *= 0.8;
  } else {
    vec3 hue = clamp(saturation(s.rgb / max(max(s.r, max(s.g, s.b)), 0.06), 1.3), 0.0, 1.0);
    col = u_invert > 0.5 ? hue * mix(0.7, 0.35, tn) : hue * mix(0.6, 1.0, tn);
  }
  return vec4(mix(u_paper, col, ink), s.a);
}
`,
};

const toneGeometry: EffectDef = {
  id: 'tone-geometry',
  name: 'Tone Geometry',
  category: 'halftone',
  description: 'A Bauhaus grid: circles, triangles, quarter-circles and squares sized and chosen by tone.',
  params: [
    { type: 'range', key: 'cells', label: 'Cells', min: 6, max: 90, step: 1, default: 24 },
    { type: 'range', key: 'split', label: 'Detail split', min: 0, max: 1, default: 0.5 },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Bauhaus' },
        { value: 1, label: 'Photo' },
        { value: 2, label: 'Ink' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.25, unit: '×', group: 'Tone' },
    { type: 'range', key: 'swap', label: 'Inverted cells', min: 0, max: 0.6, default: 0.18, group: 'Shape' },
    { type: 'range', key: 'margin', label: 'Margin', min: 0, max: 0.2, default: 0.05, group: 'Shape' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Bauhaus', values: {} },
    { name: 'Photo shapes', values: { colorMode: 1, cells: 32 } },
    { name: 'Ink shapes', values: { colorMode: 2, cells: 40, swap: 0 } },
    { name: 'Big blocks', values: { cells: 12, split: 0.7 } },
    { name: 'Fine grid', values: { cells: 56, split: 0.3, margin: 0.02 } },
    { name: 'Night print', values: { colorMode: 2, ink: '#ffc53d', paper: '#15120e', swap: 0.1 } },
  ],
  glsl: /* glsl */ `
vec3 tgBauhaus(vec3 c, float h) {
  vec3 RED = vec3(0.89, 0.22, 0.16), YEL = vec3(1.0, 0.77, 0.24), BLU = vec3(0.12, 0.3, 0.66), BLK = vec3(0.08, 0.07, 0.06);
  vec3 hsv = rgb2hsv(c);
  if (hsv.z < 0.38) return h < 0.3 ? BLU : BLK;
  if (hsv.y < 0.25) return hsv.z > 0.8 ? (h < 0.5 ? YEL : BLU) : BLK;
  float hue = hsv.x * 360.0;
  if (hue < 22.0 || hue > 300.0) return RED;
  if (hue < 70.0) return h < 0.2 ? RED : YEL;
  return BLU;
}

// Shape cover at p (-0.5..0.5 in the cell) for darkness band b with size sz.
float tgShape(int b, vec2 p, float sz, float aa) {
  if (b == 0) return fill(length(p) - 0.3 * sz, aa);
  if (b == 1) return fill(length(p) - 0.46 * sz, aa);
  if (b == 2) {
    float hb = 0.46 * sz;
    return fill(max(sdBox(p, vec2(hb)), (p.x - p.y) * 0.7071), aa);
  }
  if (b == 3) {
    vec2 o = vec2(-0.46);
    return fill(max(length(p - o) - 0.92 * sz, sdBox(p, vec2(0.46))), aa);
  }
  return fill(sdBox(p, vec2(0.46 * sz)), aa);
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  vec2 g = uv * u_res / cell;
  vec2 id = floor(g);
  vec2 p = fract(g);
  vec2 ctr = (id + 0.5) * cell / u_res;
  vec4 s = srcAvg(ctr, cell);
  float size = cell;
  if (u_split > 0.0) {
    // Busy cells split into four smaller ones.
    vec2 q = floor(p * 2.0);
    vec4 qc[4];
    float var = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2)) - 0.5;
      qc[k] = srcAvg(ctr + o * 0.5 * cell / u_res, cell * 0.5);
      var += length(qc[k].rgb - s.rgb);
    }
    if (var > (1.0 - u_split) * 0.8) {
      int k = int(q.x + q.y * 2.0);
      s = qc[k];
      id = id * 2.0 + q;
      p = fract(p * 2.0);
      size = cell * 0.5;
    }
  }
  float tn = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float dark = 1.0 - tn;
  float bf = clamp(dark * 5.0, 0.0, 4.999);
  int band = int(bf);
  float sz = mix(0.7, 1.0, fract(bf));
  vec3 h = hash32(id + u_seed * 37.0);
  // Random quarter turns.
  vec2 f = p - 0.5;
  int r = int(h.x * 4.0);
  if (r == 1) f = vec2(-f.y, f.x);
  else if (r == 2) f = -f;
  else if (r == 3) f = vec2(f.y, -f.x);
  f /= 1.0 - u_margin * 2.0;
  float aa = 1.2 / size;
  float cov = tgShape(band, f, sz, aa);
  int m = int(u_colorMode + 0.5);
  vec3 bg = u_paper;
  vec3 fg = u_ink;
  if (m == 0) fg = tgBauhaus(s.rgb, h.y);
  else if (m == 1) {
    fg = clamp(saturation(s.rgb, 1.3) * 1.1, 0.0, 1.0);
    bg = fg * 0.22;
  }
  if (h.z < u_swap) {
    vec3 tmp = bg;
    bg = fg;
    fg = m == 1 ? tmp * 0.5 + 0.5 * u_paper : tmp;
  }
  return vec4(mix(bg, fg, cov), s.a);
}
`,
};

export const HALFTONE_EFFECTS: EffectDef[] = [
  halftone,
  dithering,
  crossStitch,
  driftLines,
  glitchGrid,
  glyphMatrix,
  pixelPress,
  patternHalftone,
  pixelDitherGlow,
  pixelPoster,
  retroMatrix,
  riso,
  risoGlow,
  scatterMosaic,
  symbolMatrix,
  toneGeometry,
];
