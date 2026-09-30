import { type EffectDef } from './types';

/**
 * Textile & craft: pen hatching, knitting, woven rugs, satin embroidery and
 * banknote engraving. Every size is a count across the layer, so a look keeps
 * its structure from the 800 px preview to a 4K export.
 */

const crosshatch: EffectDef = {
  id: 'crosshatch',
  name: 'Crosshatch',
  category: 'craft',
  description: 'Pen-and-ink crosshatching: up to four layers of wobbly strokes switched on as the image darkens.',
  params: [
    { type: 'range', key: 'lines', label: 'Lines', min: 30, max: 300, step: 1, default: 100 },
    { type: 'range', key: 'layers', label: 'Layers', min: 1, max: 4, step: 1, default: 4 },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 45, unit: '°' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.1, unit: '×', group: 'Tone' },
    {
      type: 'range',
      key: 'contours',
      label: 'Contours',
      hint: 'Outline strokes along strong edges',
      min: 0,
      max: 1,
      default: 0.5,
      group: 'Tone',
    },
    { type: 'range', key: 'weight', label: 'Pen weight', min: 0.1, max: 1, default: 0.34, group: 'Ink' },
    { type: 'range', key: 'wobble', label: 'Wobble', min: 0, max: 1, default: 0.5, group: 'Ink' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo ink' },
        { value: 2, label: 'Ink & wash' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#15120e', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Pen & ink', values: {} },
    { name: 'Fine etching', values: { lines: 190, weight: 0.34, wobble: 0.15, contours: 0.3, angle: 30 } },
    { name: 'Ink & wash', values: { colorMode: 2, lines: 90, layers: 3, contours: 0.7 } },
    { name: 'Sepia sketch', values: { colorMode: 1, ink: '#4a2f1c', paper: '#f1e2c2', wobble: 0.8, lines: 80 } },
    { name: 'Chalkboard', values: { ink: '#f5ecd7', paper: '#1c1f1d', lines: 85, weight: 0.5, wobble: 0.7 } },
    { name: 'Blueprint', values: { ink: '#e8f0ff', paper: '#1d3f78', wobble: 0, contours: 0.8, layers: 2, angle: 0 } },
    { name: 'Bold marker', values: { lines: 55, weight: 0.62, layers: 3, wobble: 0.9, ink: '#000000' } },
  ],
  glsl: /* glsl */ `
// Box-filtered coverage of a line w px wide at distance f px from its centre.
float lineCov(float f, float w) {
  return clamp(min(f + 0.5, w * 0.5) - max(f - 0.5, -w * 0.5), 0.0, 1.0);
}

// One layer of parallel pen strokes: slightly wandering, broken into tapered dashes.
float hatchLayer(vec2 px, float ang, float sp, float w, float seed) {
  vec2 r = rot(ang) * px;
  float wob = u_wobble;
  float y = r.y / sp;
  y += (vnoise(vec2(r.x / sp * 0.045, y * 0.13) + seed * 17.0) - 0.5) * wob * 1.3;
  float id = floor(y);
  y += (vnoise(vec2(r.x / sp * 0.32, id * 1.93 + seed * 7.0)) - 0.5) * wob * 0.2;
  id = floor(y);
  float f = abs(fract(y) - 0.5) * sp;
  float len = 10.0 + 18.0 * hash11(id * 1.37 + seed * 3.1);
  float t = fract(r.x / sp / len + hash11(id * 2.71 + seed));
  float taper = smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.93, t);
  float ww = w * mix(1.0, taper, min(1.0, wob * 1.6)) * (0.8 + 0.4 * hash11(id * 0.61 + seed * 9.0));
  return lineCov(f, ww);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 px = uv * u_res;
  float sp = u_res.x / u_lines;
  vec4 c = srcAvg(uv, sp * 0.75);
  float l = clamp((luma(c.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  // Light ink on dark paper draws the lights instead of the darks.
  bool neg = luma(u_ink) > luma(u_paper);
  float tone = neg ? l : 1.0 - l;

  int n = int(u_layers + 0.5);
  float base = radians(u_angle);
  float offs[4] = float[4](0.0, 1.5707963, 0.7853982, 2.3561945);
  float keep = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    float th = 0.1 + 0.85 * float(i) / float(n);
    float w = u_weight * sp * smoothstep(th, th + 0.3, tone);
    if (w <= 0.0) continue;
    float fi = float(i);
    float a = base + offs[i] + (hash11(fi + u_seed * 11.0) - 0.5) * 0.1 * u_wobble;
    keep *= 1.0 - hatchLayer(px, a, sp * (1.0 - 0.07 * fi), w, fi + u_seed * 5.0);
  }

  // Contour strokes where the image has strong edges.
  float contour = 0.0;
  if (u_contours > 0.0) {
    float d = sp * 0.7;
    vec2 ox = vec2(d / u_res.x, 0.0);
    vec2 oy = vec2(0.0, d / u_res.y);
    float gx = luma(srcAvg(uv + ox, d).rgb) - luma(srcAvg(uv - ox, d).rgb);
    float gy = luma(srcAvg(uv + oy, d).rgb) - luma(srcAvg(uv - oy, d).rgb);
    float e = length(vec2(gx, gy)) * (0.75 + 0.5 * vnoise(px / sp * 0.35 + u_seed * 3.0));
    contour = smoothstep(0.16, 0.3, e * u_contours * 1.4) * 0.92;
  }

  int mode = int(u_colorMode + 0.5);
  vec3 paper = u_paper * (0.955 + 0.06 * vnoise(px / (sp * 0.45)) + 0.025 * vnoise(px / (sp * 4.0)));
  vec3 inkCol = u_ink;
  if (mode == 1) inkCol = mix(u_ink, saturation(c.rgb, 1.5) * 0.72, 0.8);
  if (mode == 2) {
    vec3 w = saturation(srcAvg(uv, sp * 3.0).rgb, 1.25);
    float wet = 0.55 + 0.45 * smoothstep(0.25, 0.75, fbm(px / (sp * 7.0) + u_seed * 9.0));
    paper *= mix(vec3(1.0), clamp(w * 1.25, 0.0, 1.0), 0.7 * wet);
  }
  vec3 col = mix(inkCol, paper, keep);
  col = mix(col, inkCol, contour);
  return vec4(col, s.a);
}
`,
};

const knittedEmbroidery: EffectDef = {
  id: 'knitted-embroidery',
  name: 'Knitted Embroidery',
  category: 'craft',
  description: 'Knitted fabric: rows of plump V stitches in the image colours, with twisted, fuzzy yarn.',
  params: [
    { type: 'range', key: 'stitches', label: 'Stitches', min: 16, max: 160, step: 1, default: 58 },
    {
      type: 'select',
      key: 'palette',
      label: 'Yarn',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Posterised' },
        { value: 2, label: 'Two-tone' },
        { value: 3, label: 'Yarn box' },
      ],
      default: 1,
    },
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 5, group: 'Colour' },
    { type: 'color', key: 'yarnA', label: 'Light yarn', default: '#f5ecd7', group: 'Colour' },
    { type: 'color', key: 'yarnB', label: 'Dark yarn', default: '#c8322a', group: 'Colour' },
    { type: 'range', key: 'rowh', label: 'Row height', min: 0.5, max: 1, default: 0.72, unit: '×', group: 'Shape' },
    { type: 'range', key: 'fuzz', label: 'Fuzz', min: 0, max: 1, default: 0.5, group: 'Shape' },
    { type: 'range', key: 'twist', label: 'Ply twist', min: 0, max: 1, default: 0.6, group: 'Shape' },
    { type: 'range', key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.75, group: 'Light' },
  ],
  presets: [
    { name: 'Cosy jumper', values: {} },
    { name: 'Photo knit', values: { palette: 0, stitches: 80 } },
    { name: 'Fair isle', values: { palette: 2, stitches: 64 } },
    { name: 'Yarn box', values: { palette: 3, stitches: 50 } },
    { name: 'Chunky', values: { stitches: 28, fuzz: 0.8, levels: 4, depth: 0.9 } },
    { name: 'Fine gauge', values: { stitches: 130, palette: 0, fuzz: 0.25, twist: 0.3 } },
    { name: 'Christmas', values: { palette: 2, yarnA: '#f5ecd7', yarnB: '#1f5a36', stitches: 52 } },
  ],
  glsl: /* glsl */ `
// One knit leg: a tilted ellipse. Returns 1 - r^2 (> 0 inside); lp = ellipse-local position, nrm = its outward direction.
float knitLeg(vec2 q, vec2 c, float ang, vec2 ax, out vec2 nrm, out vec2 lp) {
  lp = (rot(ang) * (q - c)) / ax;
  nrm = transpose(rot(ang)) * (lp / ax);
  return 1.0 - dot(lp, lp);
}

vec3 yarnBox(vec3 c) {
  vec3 box[10] = vec3[10](
    vec3(0.95, 0.91, 0.82), vec3(0.78, 0.69, 0.55), vec3(0.2, 0.19, 0.19), vec3(0.14, 0.2, 0.36),
    vec3(0.76, 0.16, 0.14), vec3(0.93, 0.66, 0.16), vec3(0.2, 0.4, 0.24), vec3(0.62, 0.3, 0.16),
    vec3(0.47, 0.64, 0.8), vec3(0.9, 0.55, 0.58)
  );
  vec3 best = box[0];
  float bd = 1e9;
  for (int i = 0; i < 10; i++) {
    vec3 d = c - box[i];
    float rm = 0.5 * (c.r + box[i].r);
    float dd = dot(d * d, vec3(2.0 + rm, 4.0, 3.0 - rm));
    if (dd < bd) { bd = dd; best = box[i]; }
  }
  return best;
}

vec3 yarnColour(vec3 c) {
  int p = int(u_palette + 0.5);
  if (p == 1) {
    // Posterise in HSV so browns stay brown: 12 hues, n saturations and values.
    vec3 hsv = rgb2hsv(c);
    float n = u_levels;
    hsv.x = floor(hsv.x * 12.0 + 0.5) / 12.0;
    hsv.y = clamp(floor(hsv.y * 1.2 * n + 0.5) / n, 0.0, 1.0);
    hsv.z = clamp(floor(hsv.z * n + 0.5) / n, 0.08, 1.0);
    return hsv2rgb(hsv);
  }
  if (p == 2) return luma(c) > 0.4 ? u_yarnA : u_yarnB;
  if (p == 3) return yarnBox(saturation(c, 1.3));
  return c;
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float H = u_rowh;
  float cw = u_res.x / u_stitches;
  float ch = cw * H;
  vec2 px = uv * u_res;
  vec2 g = vec2(px.x / cw, px.y / ch);
  vec2 id = floor(g);
  vec2 f = fract(g);

  float best = -9.0;
  float second = -9.0;
  vec2 bestN = vec2(0.0);
  vec2 bestL = vec2(0.0);
  float bestRow = 0.0;
  for (int k = -1; k <= 1; k++) {
    float dy = float(k);
    vec2 q = vec2(f.x - 0.5, (f.y - dy) * H);
    for (int side = 0; side < 2; side++) {
      float sg = side == 0 ? -1.0 : 1.0;
      vec2 nrm;
      vec2 lp;
      float h = knitLeg(q, vec2(0.235 * sg, H * 0.5 + 0.02), -0.4 * sg, vec2(0.215, H * 0.5 + 0.16), nrm, lp);
      if (h > best) {
        second = best;
        best = h;
        bestN = nrm;
        bestL = lp;
        bestRow = dy;
      } else if (h > second) {
        second = h;
      }
    }
  }

  vec2 cuv = vec2((id.x + 0.5) * cw, (id.y + bestRow + 0.5) * ch) / u_res;
  vec3 yarn = yarnColour(srcAvg(cuv, cw).rgb);

  // Yarn lighting: dome normal, ply twist stripes, creases where stitches meet.
  float h = sqrt(clamp(best, 0.0, 1.0));
  vec3 n = normalize(vec3(bestN * 0.22, max(h, 0.08)));
  float diff = clamp(dot(n, normalize(vec3(-0.45, -0.65, 0.7))), 0.0, 1.0);
  float shade = mix(1.0, 0.3 + 0.9 * diff, u_depth);
  float ply = 0.5 + 0.5 * sin((bestL.y * 4.2 + bestL.x * 1.6) * PI * 2.0);
  shade *= 1.0 - u_twist * 0.3 * ply * smoothstep(0.0, 0.3, best);
  float crease = 1.0 - smoothstep(0.0, 0.3, best - max(second, 0.0));
  shade *= 1.0 - 0.35 * u_depth * crease * step(0.0, second);
  float fz = vnoise(px / (cw * 0.035) + u_seed * 13.0);
  shade *= 1.0 + (fz - 0.5) * 0.3 * u_fuzz;

  // Fuzzy edge: fibres stray past the stitch outline.
  float edge = best + (vnoise(px / (cw * 0.05) + 7.0) - 0.5) * 0.45 * u_fuzz;
  float aa = max(fwidth(best) * 1.2, 0.02 + 0.12 * u_fuzz);
  float cov = smoothstep(-aa, aa, edge);
  vec3 gap = yarn * 0.16;
  vec3 col = mix(gap, yarn * shade + vec3(0.06) * pow(diff, 6.0) * u_depth, cov);
  return vec4(col, s.a);
}
`,
};

const kilimCarpet: EffectDef = {
  id: 'kilim-carpet',
  name: 'Kilim Carpet',
  category: 'craft',
  description: 'A woven kilim: the image in madder, ochre and indigo, ringed by stepped diamonds and a zigzag border.',
  params: [
    { type: 'range', key: 'weave', label: 'Weave', min: 40, max: 260, step: 1, default: 120 },
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Anatolian' },
        { value: 1, label: 'Berber' },
        { value: 2, label: 'Navajo' },
        { value: 3, label: 'Indigo' },
        { value: 4, label: 'Pizza' },
      ],
      default: 0,
    },
    {
      type: 'select',
      key: 'motif',
      label: 'Motif',
      options: [
        { value: 0, label: 'Diamonds' },
        { value: 1, label: 'Zigzag' },
        { value: 2, label: 'Crosses' },
        { value: 3, label: 'None' },
      ],
      default: 0,
    },
    { type: 'range', key: 'amount', label: 'Motif strength', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'msize', label: 'Motif size', min: 6, max: 48, step: 1, default: 20, group: 'Shape' },
    { type: 'toggle', key: 'border', label: 'Border', default: true, group: 'Shape' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.5, max: 2.5, default: 1.3, unit: '×', group: 'Tone' },
    { type: 'range', key: 'texture', label: 'Weave texture', min: 0, max: 1, default: 0.7, group: 'Tone' },
  ],
  presets: [
    { name: 'Anatolian', values: {} },
    { name: 'Berber zigzag', values: { palette: 1, motif: 1, msize: 16 } },
    { name: 'Navajo', values: { palette: 2, motif: 2, msize: 26, weave: 100 } },
    { name: 'Indigo', values: { palette: 3, amount: 0.75 } },
    { name: 'Pizza rug', values: { palette: 4, motif: 1, msize: 12 } },
    { name: 'Coarse weave', values: { weave: 60, msize: 10, texture: 1 } },
    { name: 'Plain', values: { motif: 3, border: false, weave: 160 } },
  ],
  glsl: /* glsl */ `
// Six dyes, roughly dark → light: 0 dark, 1 deep, 2 red, 3 accent, 4 ochre, 5 light.
vec3 dye(int p, int i) {
  if (p == 1) {
    vec3 c[6] = vec3[6](vec3(0.17, 0.12, 0.12), vec3(0.18, 0.24, 0.45), vec3(0.72, 0.14, 0.14), vec3(0.9, 0.48, 0.15), vec3(0.93, 0.72, 0.3), vec3(0.95, 0.9, 0.8));
    return c[i];
  }
  if (p == 2) {
    vec3 c[6] = vec3[6](vec3(0.08, 0.07, 0.07), vec3(0.42, 0.4, 0.38), vec3(0.7, 0.12, 0.1), vec3(0.5, 0.3, 0.18), vec3(0.8, 0.66, 0.46), vec3(0.93, 0.9, 0.84));
    return c[i];
  }
  if (p == 3) {
    vec3 c[6] = vec3[6](vec3(0.07, 0.09, 0.2), vec3(0.17, 0.27, 0.55), vec3(0.68, 0.15, 0.13), vec3(0.42, 0.58, 0.8), vec3(0.86, 0.68, 0.33), vec3(0.93, 0.9, 0.82));
    return c[i];
  }
  if (p == 4) {
    vec3 c[6] = vec3[6](vec3(0.03, 0.02, 0.02), vec3(0.5, 0.1, 0.07), vec3(1.0, 0.35, 0.24), vec3(0.5, 0.88, 0.56), vec3(1.0, 0.77, 0.24), vec3(0.96, 0.93, 0.84));
    return c[i];
  }
  vec3 c[6] = vec3[6](vec3(0.18, 0.09, 0.06), vec3(0.15, 0.2, 0.4), vec3(0.62, 0.1, 0.09), vec3(0.82, 0.35, 0.15), vec3(0.85, 0.63, 0.25), vec3(0.94, 0.88, 0.74));
  return c[i];
}

// Stepped motif value (0 or 1) at weave cell X (x in cells, y in cell widths).
float motifAt(vec2 X) {
  int m = int(u_motif + 0.5);
  float M = u_msize;
  float bw = max(1.0, floor(M / 6.0));
  if (m == 1) {
    float v = X.y + abs(mod(X.x, M) - M * 0.5);
    return mod(floor(v / bw), 2.0);
  }
  vec2 l = mod(X, M) - M * 0.5;
  float d = abs(l.x) + abs(l.y);
  float ring = mod(floor(d / bw), 2.0);
  if (m == 2) {
    float inner = step(d, M * 0.42) * ring;
    float crs = step(min(abs(l.x), abs(l.y)), bw * 0.5) * step(d, M * 0.5);
    return abs(inner - crs);
  }
  return ring;
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  int pal = int(u_palette + 0.5);
  vec2 px = uv * u_res;
  float cw = u_res.x / u_weave;
  float ch = cw * 0.5;
  // Weft-faced weave: every other row of bumps sits half a warp over.
  float row = floor(px.y / ch);
  float xo = mod(row, 2.0) * 0.5 * cw;
  vec2 g = vec2((px.x + xo) / cw, px.y / ch);
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 cp = vec2((id.x + 0.5) * cw - xo, (id.y + 0.5) * ch);

  vec3 c = srcAvg(cp / u_res, cw * 1.5).rgb;
  c = saturation(contrast(c, u_contrast), 1.35);
  float mv = int(u_motif + 0.5) == 3 ? 0.5 : motifAt(vec2(id.x - mod(id.y, 2.0) * 0.5, id.y * 0.5));
  c += (mv - 0.5) * u_amount * 0.5;
  int k = 0;
  float bd = 1e9;
  for (int i = 0; i < 6; i++) {
    vec3 d = c - dye(pal, i);
    float dd = dot(d * d, vec3(0.9, 1.2, 0.7));
    if (dd < bd) { bd = dd; k = i; }
  }

  if (u_border > 0.5) {
    float bwid = 0.075 * min(u_res.x, u_res.y);
    vec2 e2 = min(cp, u_res - cp);
    float e = min(e2.x, e2.y);
    if (e < bwid) {
      float b = e / bwid;
      float along = e2.x < e2.y ? cp.y : cp.x;
      float tri = abs(fract(along / (bwid * 1.2)) - 0.5) * 2.0;
      if (b < 0.14 || b > 0.88) k = 0;
      else if (b > 0.76) k = 4;
      else k = (b - 0.14) / 0.62 < tri ? 2 : 5;
    }
  }
  vec3 col = dye(pal, k);

  // Abrash: natural dye lots drift from row to row.
  col *= 1.0 + (vnoise(vec2(id.y * 0.23, float(k) * 5.0 + u_seed * 9.0)) - 0.5) * 0.16 * u_texture;
  // Each weft pass is a rounded bump; fine twist lines run across it.
  float bump = pow(sin(PI * f.y), 0.7) * (0.65 + 0.35 * sin(PI * f.x));
  float twist = 0.5 + 0.5 * sin((f.x * 2.0 - f.y * 1.3) * TAU * 1.5 + hash12(id) * 6.0);
  float shade = mix(1.0, 0.62 + 0.48 * bump - 0.07 * twist, u_texture);
  shade *= 1.0 + (vnoise(px / (cw * 0.12)) - 0.5) * 0.1 * u_texture;
  return vec4(col * shade, s.a);
}
`,
};

const stitchPoster: EffectDef = {
  id: 'stitch-poster',
  name: 'Stitch Poster',
  category: 'craft',
  description: 'Satin-stitch embroidery: blocks of glossy thread laid along the image, fabric showing between.',
  params: [
    { type: 'range', key: 'stitches', label: 'Stitches', min: 12, max: 120, step: 1, default: 40 },
    {
      type: 'select',
      key: 'direction',
      label: 'Direction',
      options: [
        { value: 0, label: 'Along edges' },
        { value: 1, label: 'Across edges' },
        { value: 2, label: 'Alternating' },
        { value: 3, label: 'Random' },
        { value: 4, label: 'Horizontal' },
        { value: 5, label: 'Cross-stitch' },
      ],
      default: 0,
    },
    { type: 'range', key: 'threads', label: 'Threads', min: 3, max: 14, step: 1, default: 8, group: 'Thread' },
    { type: 'range', key: 'gap', label: 'Gap', min: 0, max: 0.5, default: 0.03, group: 'Thread' },
    { type: 'range', key: 'sheen', label: 'Sheen', min: 0, max: 1.5, default: 0.8, group: 'Thread' },
    { type: 'range', key: 'sat', label: 'Saturation', min: 0, max: 2, default: 1.25, unit: '×', group: 'Colour' },
    {
      type: 'range',
      key: 'levels',
      label: 'Thread colours',
      hint: 'Limit to a box of threads; 0 keeps photo colours',
      min: 0,
      max: 8,
      step: 1,
      default: 0,
      group: 'Colour',
    },
    {
      type: 'range',
      key: 'skip',
      label: 'Stitch up to',
      hint: 'Cells brighter than this are left as bare fabric',
      min: 0.3,
      max: 1,
      default: 1,
      group: 'Colour',
    },
    { type: 'color', key: 'fabric', label: 'Fabric', default: '#f5ecd7', group: 'Colour' },
  ],
  presets: [
    { name: 'Satin', values: {} },
    { name: 'Checkerboard', values: { direction: 2, gap: 0.16 } },
    { name: 'Cross-stitch', values: { direction: 5, levels: 3, stitches: 56, skip: 0.72, sat: 1.5, threads: 4 } },
    { name: 'Silk sheen', values: { threads: 11, sheen: 1.4, gap: 0, stitches: 60 } },
    { name: 'Chunky wool', values: { threads: 4, stitches: 26, sheen: 0.3, gap: 0.2 } },
    { name: 'On denim', values: { fabric: '#2d4466', levels: 4, direction: 3, gap: 0.14, skip: 0.8 } },
    { name: 'Black cloth', values: { fabric: '#111111', skip: 0.85, sheen: 1.1, direction: 5, threads: 3 } },
  ],
  glsl: /* glsl */ `
vec3 threadColour(vec3 c) {
  c = saturation(c, u_sat);
  if (u_levels < 1.5) return clamp(c, 0.0, 1.0);
  // A limited box of threads: 12 hues, n saturations and values.
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float n = u_levels;
  hsv.x = floor(hsv.x * 12.0 + 0.5) / 12.0;
  hsv.y = clamp(floor(hsv.y * n + 0.5) / n, 0.0, 1.0);
  hsv.z = clamp(floor(hsv.z * n + 0.5) / n, 0.1, 1.0);
  return hsv2rgb(hsv);
}

// Parallel glossy threads at angle ang, in the region where d < 0 (cell units). rgb + coverage.
vec4 threads(vec2 q, float ang, float d, vec3 col, float seed, float cw, float dens) {
  vec2 r = rot(ang) * q;
  float ty = r.y * u_threads * dens;
  float tid = floor(ty);
  float th = hash11(tid * 1.7 + seed * 13.0);
  d += (th - 0.5) * 0.1;
  float cyl = sin(PI * fract(ty));
  float lightDir = 0.35 + 0.65 * abs(sin(ang - 0.785));
  float band = 0.5 + 0.5 * sin(r.x * 5.0 + ang * 3.0 + seed * 6.0);
  float spec = pow(cyl, 6.0) * u_sheen * lightDir * (0.18 + 0.32 * band);
  vec3 c = col * (0.6 + 0.45 * cyl) * (0.93 + 0.14 * th) * (0.9 + 0.2 * band * lightDir) + spec;
  // Thread ends dip into the cloth.
  c *= 1.0 - 0.35 * smoothstep(-0.1, 0.0, d);
  return vec4(clamp(c, 0.0, 1.0), fill(d * cw, 1.0));
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 px = uv * u_res;
  float cw = u_res.x / u_stitches;
  Cell c = grid(uv, vec2(cw));
  vec2 q = c.p - 0.5;
  vec4 sc = srcAvg(c.center, cw);
  vec3 col = threadColour(sc.rgb);
  float h = hash12(c.id + u_seed * 31.0);

  // Stitch direction for this block.
  int dm = int(u_direction + 0.5);
  float ang = (mod(c.id.x + c.id.y, 2.0) < 0.5 ? 0.25 : -0.25) * PI;
  if (dm <= 1) {
    float e = cw * 0.9;
    vec2 ox = vec2(e / u_res.x, 0.0);
    vec2 oy = vec2(0.0, e / u_res.y);
    float gx = luma(srcAvg(c.center + ox, e).rgb) - luma(srcAvg(c.center - ox, e).rgb);
    float gy = luma(srcAvg(c.center + oy, e).rgb) - luma(srcAvg(c.center - oy, e).rgb);
    float ga = atan(gy, gx) + (dm == 0 ? PI * 0.5 : 0.0);
    ang = length(vec2(gx, gy)) > 0.035 ? ga : ang + (h - 0.5) * 0.5;
  } else if (dm == 3) {
    ang = h * PI;
  } else if (dm == 4) {
    ang = (h - 0.5) * 0.12;
  }

  // Fabric: a fine linen weave, shaded under the raised stitches.
  float fp = cw / 6.0;
  float weave = sin(px.x / fp * PI) * sin(px.y / fp * PI);
  vec3 fabric = u_fabric * (0.93 + 0.05 * weave + 0.06 * vnoise(px / (fp * 3.0)));
  float hs = 0.5 - u_gap * 0.5;
  float stitched = luma(sc.rgb) <= u_skip + 1e-3 ? 1.0 : 0.0;
  float sh = sdRoundBox(q - vec2(0.03, 0.045), vec2(hs), 0.12);
  if (dm == 5) sh = min(abs(q.x - 0.03 + q.y - 0.045), abs(q.x - 0.03 - q.y + 0.045)) * 0.7071 - hs * 0.36;
  fabric *= 1.0 - 0.4 * stitched * (1.0 - smoothstep(-0.03, 0.08, sh));
  vec3 outc = fabric;

  if (dm == 5) {
    // Cross-stitch: a '/' leg under a '\\' leg, each a narrow band of threads.
    float bw = hs * 0.36;
    float len = hs * 1.3;
    for (int k = 0; k < 2; k++) {
      float a = k == 0 ? -0.785398 : 0.785398;
      vec2 r = rot(a) * q;
      float d = sdRoundBox(r, vec2(len, bw), bw * 0.9);
      vec4 t = threads(r, 0.0, d, col, h + float(k), cw, 2.0);
      t.rgb *= k == 0 ? 0.9 : 1.0;
      outc = mix(outc, t.rgb, t.a * stitched);
    }
  } else {
    float d = sdRoundBox(q, vec2(hs), 0.12);
    vec4 t = threads(q, ang, d, col, h, cw, 1.0);
    outc = mix(outc, t.rgb, t.a * stitched);
  }
  return vec4(outc, s.a);
}
`,
};

const vectorEngraving: EffectDef = {
  id: 'vector-engraving',
  name: 'Vector Engraving',
  category: 'craft',
  description: 'Banknote engraving: crisp parallel lines, wavy or ringed, swelling with the darks.',
  params: [
    { type: 'range', key: 'lines', label: 'Lines', min: 40, max: 320, step: 1, default: 150 },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 20, unit: '°' },
    {
      type: 'select',
      key: 'style',
      label: 'Style',
      options: [
        { value: 0, label: 'Straight' },
        { value: 1, label: 'Wavy' },
        { value: 2, label: 'Rings' },
        { value: 3, label: 'Guilloche' },
      ],
      default: 1,
    },
    { type: 'range', key: 'wave', label: 'Wave', min: 0, max: 1, default: 0.35, group: 'Shape' },
    { type: 'range', key: 'freq', label: 'Wave count', min: 1, max: 20, step: 0.5, default: 5, group: 'Shape' },
    {
      type: 'range',
      key: 'relief',
      label: 'Relief',
      hint: 'Lines bend over the image like a raised surface',
      min: 0,
      max: 1,
      default: 0.45,
      group: 'Shape',
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.2, unit: '×', group: 'Tone' },
    { type: 'toggle', key: 'cross', label: 'Cross-hatch darks', default: true, group: 'Tone' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#1d3b2c', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#efe8d2', group: 'Ink' },
  ],
  presets: [
    { name: 'Banknote', values: {} },
    { name: 'Etching', values: { style: 0, ink: '#15120e', paper: '#f5ecd7', angle: 35, lines: 170, relief: 0.6 } },
    { name: 'Portrait rings', values: { style: 2, ink: '#3a1f14', paper: '#f1e3c6', lines: 120, wave: 0.15 } },
    { name: 'Guilloche', values: { style: 3, ink: '#6d1f2c', paper: '#f3ead8', wave: 0.6, freq: 8 } },
    { name: 'Blue stamp', values: { ink: '#1f3a8a', paper: '#eef0ea', lines: 110, cross: false } },
    { name: 'Gold on black', values: { ink: '#ffc53d', paper: '#000000', lines: 130 } },
    { name: 'Woodcut', values: { style: 0, lines: 60, relief: 0.9, ink: '#000000', paper: '#f5ecd7', cross: false } },
  ],
  glsl: /* glsl */ `
float engLine(float v, float sp, float w) {
  float g = max(length(vec2(dFdx(v), dFdy(v))), 1e-3);
  float f = abs(fract(v / sp) - 0.5) * sp / g;
  float wp = w / g;
  return clamp(min(f + 0.5, wp * 0.5) - max(f - 0.5, -wp * 0.5), 0.0, 1.0);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 px = uv * u_res;
  float W = u_res.x;
  float sp = W / u_lines;
  float l = clamp((luma(srcAvg(uv, sp * 0.6).rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  bool neg = luma(u_ink) > luma(u_paper);
  float dark = neg ? l : 1.0 - l;
  float body = luma(srcAvg(uv, sp * 5.0).rgb);

  int st = int(u_style + 0.5);
  vec2 cen = u_res * 0.5;
  vec2 r = rot(radians(u_angle)) * (px - cen);
  float v = r.y;
  float v2 = r.x;
  float k = u_freq * TAU / W;
  if (st == 1) {
    v += u_wave * sp * 3.0 * sin(r.x * k);
    v2 += u_wave * sp * 3.0 * sin(r.y * k);
  } else if (st == 2) {
    vec2 d = px - cen;
    v = length(d) + u_wave * sp * 3.0 * sin(atan(d.y, d.x) * floor(u_freq * 2.0 + 0.5));
    v2 = r.x;
  } else if (st == 3) {
    v += u_wave * sp * 4.0 * sin(r.x * k) * cos(r.y * k * 0.5);
    v2 += u_wave * sp * 4.0 * sin(r.y * k) * cos(r.x * k * 0.5);
  }
  v += u_relief * sp * 3.0 * body;

  float ink = engLine(v, sp, sp * clamp(0.05 + pow(dark, 1.15), 0.0, 0.92));
  if (u_cross > 0.5) {
    float w2 = sp * 0.6 * smoothstep(0.55, 0.95, dark);
    ink = max(ink, engLine(v2 + u_relief * sp * 2.0 * body, sp * 1.1, w2));
  }
  return vec4(mix(u_paper, u_ink, ink), s.a);
}
`,
};

export const CRAFT_EFFECTS: EffectDef[] = [crosshatch, knittedEmbroidery, kilimCarpet, stitchPoster, vectorEngraving];
