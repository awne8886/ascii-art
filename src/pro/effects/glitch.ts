import { type EffectDef } from './types';

/** Mirrored wrap, so offset samples fold back into the picture instead of smearing its edge. */
const MIRROR = /* glsl */ `
vec2 mirrorUV(vec2 p) { return 1.0 - abs(1.0 - mod(p, 2.0)); }
`;

// ── CRT Screen ─────────────────────────────────────────────────────────────

const crtScreen: EffectDef = {
  id: 'crt-screen',
  name: 'CRT Screen',
  category: 'glitch',
  description: 'An old tube set: curved glass in a dark bezel, phosphor mask, scanlines, glow and a rolling bar.',
  params: [
    { type: 'range', key: 'curve', label: 'Curvature', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'lines', label: 'Scanlines', min: 60, max: 600, step: 1, default: 160 },
    {
      type: 'select',
      key: 'mask',
      label: 'Mask',
      options: [
        { value: 0, label: 'Aperture grille' },
        { value: 1, label: 'Shadow mask' },
        { value: 2, label: 'Slot mask' },
        { value: 3, label: 'None' },
      ],
      default: 0,
    },
    {
      type: 'select',
      key: 'phosphor',
      label: 'Phosphor',
      options: [
        { value: 0, label: 'Colour' },
        { value: 1, label: 'Green' },
        { value: 2, label: 'Amber' },
        { value: 3, label: 'Paper white' },
      ],
      default: 0,
    },
    { type: 'range', key: 'scan', label: 'Line depth', min: 0, max: 1, default: 0.65, group: 'Tube' },
    { type: 'range', key: 'bezel', label: 'Bezel', min: 0, max: 0.25, default: 0.08, group: 'Tube' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 1.5, default: 0.55, group: 'Light' },
    { type: 'range', key: 'flicker', label: 'Flicker', min: 0, max: 1, default: 0.3, group: 'Motion' },
    { type: 'range', key: 'roll', label: 'Rolling bar', min: 0, max: 1, default: 0.4, group: 'Motion' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Living-room TV', values: {} },
    { name: 'Arcade cabinet', values: { mask: 1, curve: 0.75, lines: 224, glow: 1, bezel: 0.05 } },
    { name: 'Green terminal', values: { phosphor: 1, mask: 3, lines: 320, glow: 1, curve: 0.35, roll: 0.2 } },
    { name: 'Amber monitor', values: { phosphor: 2, mask: 3, lines: 260, glow: 0.9, curve: 0.3, flicker: 0.5 } },
    { name: 'Trinitron', values: { curve: 0.15, lines: 420, bezel: 0.04, roll: 0, flicker: 0.1 } },
    { name: 'Studio monitor', values: { mask: 2, curve: 0, bezel: 0.12, lines: 480, roll: 0, glow: 0.35 } },
    { name: 'Broken set', values: { curve: 0.9, flicker: 1, roll: 1, lines: 120, glow: 1.2, scan: 0.9 } },
  ],
  glsl: /* glsl */ `
vec3 crtPhosphor(vec3 c, int ph) {
  if (ph == 0) return c;
  float l = luma(c);
  vec3 tint = ph == 1 ? vec3(0.22, 1.0, 0.42) : ph == 2 ? vec3(1.0, 0.64, 0.16) : vec3(0.93, 0.95, 1.0);
  return tint * l + pow(l, 3.0) * 0.3;
}

// RGB phosphor mask; px on the glass, pitch = one triad, output mean ≈ 0.5 per channel.
vec3 crtMaskRGB(vec2 px, float pitch, int type) {
  vec2 q = px / pitch;
  if (type == 1) q.x += mod(floor(q.y * 1.5), 2.0) * 0.5;
  vec3 m = 0.5 + 0.5 * cos(TAU * (q.x - vec3(0.0, 1.0, 2.0) / 3.0));
  if (type == 1) {
    float fy = abs(fract(q.y * 1.5) - 0.5);
    m *= 1.0 - 0.75 * smoothstep(0.28, 0.5, fy);
    m *= 1.25;
  } else if (type == 2) {
    float colId = floor(q.x + 1.0 / 6.0);
    float fy = abs(fract(q.y * 0.75 + mod(colId, 2.0) * 0.5) - 0.5);
    m *= 1.0 - 0.8 * smoothstep(0.38, 0.47, fy);
    m *= 1.1;
  }
  return m;
}

vec4 effect(vec2 uv) {
  float aspect = u_res.x / u_res.y;
  float t = u_time * u_speed;
  int ph = int(u_phosphor + 0.5);
  int maskType = int(u_mask + 0.5);

  // Screen space inside the bezel (same bezel width in px on every side), then barrel curvature.
  vec2 p = uv * 2.0 - 1.0;
  vec2 s = p / vec2(1.0 - u_bezel / aspect, 1.0 - u_bezel);
  float k = u_curve;
  vec2 tt = s * (1.0 + k * vec2(0.13 * s.y * s.y, 0.13 * aspect * s.x * s.x));
  tt *= 1.0 + k * 0.035 * dot(s, s);

  // Rounded screen edge, anti-aliased.
  float dEdge = sdRoundBox(tt * vec2(aspect, 1.0), vec2(aspect, 1.0), 0.06 + 0.1 * k);
  float screen = fill(dEdge, fwidth(dEdge) * 1.2);

  vec2 iuv = tt * 0.5 + 0.5;
  float scrH = u_res.y * (1.0 - u_bezel);
  float linePx = scrH / u_lines;
  float vis = smoothstep(1.3, 2.8, linePx);
  float ly = iuv.y * u_lines;
  vec2 suv = vec2(iuv.x, mix(iuv.y, (floor(ly) + 0.5) / u_lines, vis));

  // Slight misconvergence towards the sides.
  float conv = (0.0008 + 0.0022 * abs(s.x) * k) * (u_res.y / u_res.x);
  float blurPx = max(linePx * 0.55, 1.0);
  vec4 cg = srcAvg(suv, blurPx);
  vec3 col = vec3(srcAvg(suv + vec2(conv, 0.0), blurPx).r, cg.g, srcAvg(suv - vec2(conv, 0.0), blurPx).b);
  col = crtPhosphor(col, ph);

  // Scanline beam: bright lines swell.
  float f = fract(ly) - 0.5;
  float lum = luma(col);
  float w = mix(0.2, 0.42, sqrt(clamp(lum, 0.0, 1.0)));
  float beam = exp(-0.5 * f * f / (w * w)) / min(w * 2.5066, 1.0);
  col *= mix(1.0, beam, u_scan * vis);

  // Phosphor mask, curved with the glass.
  if (maskType != 3) {
    vec3 m = crtMaskRGB(iuv * vec2(u_res.x, scrH), max(linePx, 1.0), maskType);
    if (ph != 0) m = vec3((m.r + m.g + m.b) / 3.0);
    col *= mix(vec3(1.0), m * 2.0, 0.6 * vis);
  }

  // Glow bleeding through the glass.
  vec3 halo = crtPhosphor(srcAvg(iuv, linePx * 6.0 + u_res.y * 0.02).rgb, ph);
  col += halo * halo * u_glow * 0.55;
  col *= 1.0 + u_glow * 0.12;

  // Flicker and a slow rolling bar.
  col *= 1.0 - u_flicker * 0.09 * hash11(floor(t * 30.0) + u_seed * 71.0);
  col *= 1.0 + u_flicker * 0.02 * sin(t * 50.0);
  float rb = fract(iuv.y * 0.8 - t * 0.11 + u_seed);
  float band = smoothstep(0.0, 0.2, rb) * smoothstep(0.5, 0.2, rb);
  col *= 1.0 + u_roll * (0.24 * band - 0.07);

  // Vignette and a faint glare on the glass.
  vec2 ic = clamp(iuv, 0.0, 1.0);
  float vig = pow(clamp(16.0 * ic.x * ic.y * (1.0 - ic.x) * (1.0 - ic.y), 0.0, 1.0), 0.22 + 0.18 * k);
  col *= vig;
  vec2 gd = (s - vec2(-0.45, -0.55)) * vec2(1.1, 1.8);
  col += vec3(0.05) * exp(-dot(gd, gd) * 3.0) * (0.4 + k);

  // Bezel: dark plastic, lit from above, with the screen reflected on its inner lip.
  float dPx = max(dEdge, 0.0) * u_res.y * 0.5;
  vec3 bez = vec3(0.058, 0.053, 0.05) * (0.75 + 0.5 * (1.0 - uv.y));
  float lip = exp(-dPx / (u_res.y * 0.012));
  vec2 refl = clamp(tt, -1.0, 1.0) * 2.0 - tt;
  vec3 rc = crtPhosphor(srcAvg(refl * 0.5 + 0.5, u_res.y * 0.04).rgb, ph);
  bez += rc * 0.22 * lip + vec3(0.03) * lip;
  bez *= 1.0 - 0.6 * exp(-dPx / max(u_res.y * 0.003, 1.0));

  vec3 rgb = mix(bez, col, screen);
  float a = mix(src(uv).a, cg.a, screen);
  return vec4(rgb, a);
}
`,
};

// ── Crystal Glass ──────────────────────────────────────────────────────────

const crystalGlass: EffectDef = {
  id: 'crystal-glass',
  name: 'Crystal Glass',
  category: 'glitch',
  description: 'The picture seen through cut crystal or glass blocks, refracted facet by facet with bright edges.',
  params: [
    { type: 'range', key: 'facets', label: 'Facets', min: 3, max: 60, step: 1, default: 11 },
    {
      type: 'select',
      key: 'shape',
      label: 'Cut',
      options: [
        { value: 0, label: 'Crystal' },
        { value: 1, label: 'Glass blocks' },
        { value: 2, label: 'Diamonds' },
      ],
      default: 0,
    },
    { type: 'range', key: 'refract', label: 'Refraction', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'zoom', label: 'Facet zoom', min: 0.5, max: 2.5, default: 1.35, unit: '×' },
    { type: 'range', key: 'bevel', label: 'Bevel', min: 0, max: 1, default: 0.45, group: 'Shape' },
    { type: 'range', key: 'pixels', label: 'Glass pixels', min: 0, max: 1, default: 0, group: 'Shape' },
    { type: 'range', key: 'dispersion', label: 'Dispersion', min: 0, max: 1, default: 0.35, group: 'Light' },
    { type: 'range', key: 'highlight', label: 'Highlights', min: 0, max: 1.5, default: 0.75, group: 'Light' },
    { type: 'color', key: 'tint', label: 'Tint', default: '#f2f7ff', group: 'Light' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 0.5, group: 'Motion' },
  ],
  presets: [
    { name: 'Cut crystal', values: {} },
    { name: 'Glass blocks', values: { shape: 1, facets: 9, zoom: 0.9, pixels: 0.8, bevel: 0.6, dispersion: 0.2 } },
    { name: 'Diamond cut', values: { shape: 2, facets: 14, dispersion: 0.7, highlight: 1.1 } },
    { name: 'Shattered', values: { facets: 34, refract: 0.9, zoom: 1, bevel: 0.25, highlight: 1 } },
    { name: 'Big lens', values: { facets: 4, zoom: 2.1, bevel: 0.8, dispersion: 0.6 } },
    { name: 'Pixel glass', values: { shape: 1, facets: 28, pixels: 1, zoom: 1, refract: 0.3, bevel: 0.3 } },
    { name: 'Rose quartz', values: { tint: '#ffc4b8', facets: 16, dispersion: 0.5 } },
    { name: 'Honey glass', values: { tint: '#ffc53d', shape: 1, facets: 7, pixels: 0.5 } },
  ],
  glsl: /* glsl */ `
${MIRROR}
struct Facet { vec2 id; vec2 center; float edge; vec2 n; };

vec2 cgPoint(vec2 id) { return 0.12 + 0.76 * hash22(id + u_seed * 17.0); }

// Voronoi facet: centre, distance to the nearest border and that border's outward normal (facet units).
Facet cgVoronoi(vec2 x) {
  vec2 ip = floor(x);
  vec2 fp = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + cgPoint(ip + g) - fp;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  Facet f;
  f.id = ip + mg;
  f.center = x + mr;
  f.edge = 8.0;
  f.n = vec2(0.0, -1.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + cgPoint(ip + g) - fp;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) {
        vec2 nn = normalize(dr);
        float d = dot(0.5 * (mr + r), nn);
        if (d < f.edge) { f.edge = d; f.n = nn; }
      }
    }
  }
  return f;
}

Facet cgSquare(vec2 x) {
  Facet f;
  f.id = floor(x);
  vec2 fp = fract(x);
  f.center = f.id + 0.5;
  vec2 dd = min(fp, 1.0 - fp);
  if (dd.x < dd.y) { f.edge = dd.x; f.n = vec2(fp.x < 0.5 ? -1.0 : 1.0, 0.0); }
  else { f.edge = dd.y; f.n = vec2(0.0, fp.y < 0.5 ? -1.0 : 1.0); }
  return f;
}

vec4 effect(vec2 uv) {
  float cell = u_res.x / u_facets;
  vec2 px = uv * u_res;
  vec2 x = px / cell;
  int shape = int(u_shape + 0.5);
  Facet f;
  if (shape == 0) f = cgVoronoi(x);
  else if (shape == 1) f = cgSquare(x);
  else {
    mat2 R = rot(0.78539816);
    f = cgSquare(R * x * 1.2);
    f.center = transpose(R) * f.center / 1.2;
    f.n = transpose(R) * f.n;
    f.edge /= 1.2;
  }
  float t = u_time * u_speed;
  vec3 h = hash32(f.id + u_seed * 31.0);
  vec2 tilt = (h.xy - 0.5) * 2.0 + 0.3 * vec2(sin(t * 0.7 + h.z * TAU), cos(t * 0.6 + h.x * TAU));

  // Each facet is a small lens: magnified around its centre and shifted by its tilt.
  vec2 cpx = f.center * cell;
  float zoom = u_zoom * (0.85 + 0.3 * h.z);
  vec2 sp = cpx + (px - cpx) / zoom + tilt * u_refract * cell * 0.45;

  // Bevel: light bends near the border.
  float bw = max(u_bevel * 0.32, 1e-3);
  float b = 1.0 - clamp(f.edge / bw, 0.0, 1.0);
  b *= b;
  sp -= f.n * b * u_refract * cell * 0.4;

  // Checkered glass pixels: alternating tiny lenses, one flips, one magnifies.
  float tile = cell / 4.0;
  vec2 tq = px / tile;
  vec2 tf = fract(tq) - 0.5;
  float par = mod(floor(tq.x) + floor(tq.y), 2.0);
  sp += tf * tile * mix(-1.4, 0.7, par) * u_pixels;

  // Dispersion: R and B refract a little more / less than G.
  vec2 dv = (sp - px) / u_res;
  float disp = u_dispersion * 0.18;
  vec2 kick = f.n * b * u_dispersion * cell * 0.04 / u_res;
  vec2 suv = sp / u_res;
  vec4 cg = src(mirrorUV(suv));
  vec3 col = vec3(src(mirrorUV(suv + dv * disp + kick)).r, cg.g, src(mirrorUV(suv - dv * disp - kick)).b);

  // Light: a tilted facet normal, rounded by the bevel.
  vec3 n3 = normalize(vec3(tilt * 0.22 * (0.3 + u_refract) + f.n * b * 1.3, 1.0));
  float la = -2.2 + t * 0.35;
  vec3 L = normalize(vec3(cos(la), sin(la), 1.0));
  float shade = dot(n3, L) - L.z;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n3, H), 0.0), 70.0);

  col *= u_tint;
  col *= 1.0 + shade * 0.9;
  col += spec * u_highlight * 0.9;

  // Crisp edge lines: bright where the border faces the light.
  float edgePx = f.edge * cell;
  float lw = cell * 0.012 + 0.35;
  float line = fill(edgePx - lw, 1.0);
  float facing = 0.5 + 0.5 * dot(f.n, normalize(L.xy));
  col = mix(col, col * 0.55, fill(edgePx - lw * 3.0, 1.5) * 0.5);
  col += line * u_highlight * (0.25 + 0.6 * facing);

  // Glass pixel shading.
  float tileEdge = max(abs(tf.x), abs(tf.y));
  col *= 1.0 - u_pixels * (0.1 * par + 0.3 * smoothstep(0.42, 0.5, tileEdge));
  col += u_pixels * u_highlight * 0.12 * smoothstep(0.1, -0.4, tf.x + tf.y);

  return vec4(col, cg.a);
}
`,
};

// ── Glass Pixel Dispersion ─────────────────────────────────────────────────

const glassPixelDispersion: EffectDef = {
  id: 'glass-pixel-dispersion',
  name: 'Glass Pixel Dispersion',
  category: 'glitch',
  description: 'The picture breaks into glassy pixel blocks that drift apart, splitting into red, green and blue.',
  params: [
    { type: 'range', key: 'blocks', label: 'Blocks', min: 12, max: 200, step: 1, default: 48 },
    { type: 'range', key: 'disperse', label: 'Dispersion', min: 0, max: 1, default: 0.55 },
    { type: 'range', key: 'chroma', label: 'RGB split', min: 0, max: 1, default: 0.6 },
    {
      type: 'select',
      key: 'flow',
      label: 'Flow',
      options: [
        { value: 0, label: 'Burst' },
        { value: 1, label: 'Directional' },
      ],
      default: 1,
    },
    { type: 'range', key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, default: 0, unit: '°' },
    { type: 'range', key: 'sweep', label: 'Sweep', min: 0, max: 1, default: 0.9, group: 'Shape' },
    { type: 'range', key: 'gap', label: 'Gap', min: 0, max: 0.5, default: 0.08, group: 'Shape' },
    { type: 'range', key: 'gloss', label: 'Gloss', min: 0, max: 1, default: 0.5, group: 'Shape' },
    { type: 'color', key: 'bg', label: 'Background', default: '#000000', group: 'Shape' },
    { type: 'range', key: 'speed', label: 'Drift', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Drift away', values: {} },
    { name: 'Burst', values: { flow: 0, sweep: 0.85, disperse: 0.7 } },
    { name: 'Evaporate', values: { angle: 270, blocks: 64, disperse: 0.75 } },
    { name: 'Rain down', values: { angle: 90, blocks: 72, chroma: 0.3, gap: 0.15 } },
    { name: 'Chunky glass', values: { blocks: 26, gloss: 1, gap: 0.12, disperse: 0.45 } },
    { name: 'Prism storm', values: { chroma: 1, disperse: 0.65, sweep: 0.85, blocks: 36, angle: 330, gloss: 0.8 } },
    { name: 'On cream', values: { bg: '#f5ecd7', angle: 180, gloss: 0.3 } },
  ],
  glsl: /* glsl */ `
const float GPD_MAX = 9.0; // furthest drift, in blocks

// How far block id has drifted, in blocks. With sweep, a front crosses the picture: blocks behind
// it stay home, blocks past it come loose, the further past the further they go.
float gpdAmount(vec2 id, vec2 c, vec2 gridN, vec2 dirA, int flow, float t) {
  float h = hash12(id + u_seed * 43.0);
  float r = hash12(id + u_seed * 43.0 + 7.13);
  float along;
  if (flow == 0) along = length((c - gridN * 0.5) / gridN.y) / (0.5 * length(gridN / gridN.y));
  else along = dot(c / gridN - 0.5, dirA) / (abs(dirA.x) + abs(dirA.y)) + 0.5;
  float front = 1.0 - 1.25 * u_disperse;
  float past = smoothstep(front, front + 0.55, along);
  float w = mix(u_disperse, past, u_sweep);
  float go = step(r, w * 1.6);
  float drift = 0.75 + 0.25 * sin(t * 1.4 + h * 40.0);
  return GPD_MAX * w * (0.25 + 0.75 * h) * go * drift;
}

vec4 effect(vec2 uv) {
  float bpx = u_res.x / u_blocks;
  vec2 q = uv * u_res / bpx;
  vec2 gridN = u_res / bpx;
  float t = u_time * u_speed;
  int flow = int(u_flow + 0.5);
  float ang = radians(u_angle);
  vec2 dirA = vec2(cos(ang), sin(ang));
  vec2 ctr = gridN * 0.5;
  vec2 dirP = flow == 0 ? normalize(q - ctr + vec2(1e-3, 0.0)) : dirA;
  float aa = 1.0 / bpx;

  vec3 col = u_bg;
  float alpha = src(uv).a;
  for (int ch = 0; ch < 3; ch++) {
    // Red lags, blue leads: the split grows with the drift but stays within about a block.
    float chk = u_chroma * 0.45 * float(ch - 1);
    float best = -1.0;
    vec2 bestId = vec2(0.0);
    vec2 bestLocal = vec2(0.0);
    vec2 bestDir = vec2(0.0);
    float bestCov = 0.0;
    float bestAmt = 0.0;
    float bestSz = 0.5;
    // Blocks that could have drifted onto this pixel lie back along the flow.
    for (int k = 0; k < 16; k++) {
      vec2 id = floor(q - dirP * float(k) * 0.85);
      vec2 c = id + 0.5;
      vec2 d = flow == 0 ? normalize(c - ctr + vec2(1e-3, 0.0)) : dirA;
      float amt = gpdAmount(id, c, gridN, dirA, flow, t);
      float chOff = chk * amt / (1.0 + amt * 0.3);
      vec2 pos = c + d * (amt + chOff);
      float sz = 0.5 * (1.0 - u_gap) * (1.0 - 0.5 * clamp(amt / GPD_MAX, 0.0, 1.0));
      vec2 lq = q - pos;
      float cov = fill(sdRoundBox(lq, vec2(sz), sz * 0.2), aa);
      if (cov > 0.0 && amt > best) {
        best = amt;
        bestId = id;
        bestLocal = lq / sz;
        bestDir = d;
        bestCov = cov;
        bestAmt = amt;
        bestSz = sz;
      }
    }
    if (best >= 0.0) {
      vec2 home = (bestId + 0.5) * bpx / u_res;
      vec2 shift = bestDir * chk * bestAmt * 0.35 * bpx / u_res;
      vec4 s = srcAvg(clamp(home + shift, 0.0, 1.0), bpx);
      float v = s[ch];
      // A glass tile: lit top-left edge, darker bottom-right, a soft specular.
      float lit = smoothstep(0.55, 1.0, max(-bestLocal.x, -bestLocal.y));
      float dark = smoothstep(0.6, 1.0, max(bestLocal.x, bestLocal.y));
      vec2 sd = bestLocal - vec2(-0.35, -0.4);
      float spec = exp(-dot(sd, sd) * 6.0);
      v = v * (1.0 - 0.35 * u_gloss * dark) + u_gloss * (0.28 * lit + 0.22 * spec);
      col[ch] = mix(col[ch], v, bestCov);
      alpha = max(alpha, bestCov * s.a);
    }
  }
  return vec4(col, alpha);
}
`,
};

// ── Glitch ─────────────────────────────────────────────────────────────────

const glitch: EffectDef = {
  id: 'glitch',
  name: 'Glitch',
  category: 'glitch',
  description: 'Digital corruption: jumping blocks, RGB split, torn scanlines and flashes of inverted colour.',
  params: [
    { type: 'range', key: 'intensity', label: 'Intensity', min: 0, max: 1, default: 0.55 },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1 },
    { type: 'range', key: 'split', label: 'RGB split', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'blocks', label: 'Block size', min: 3, max: 40, step: 1, default: 12, hint: 'Blocks across' },
    { type: 'range', key: 'tear', label: 'Tear lines', min: 0, max: 1, default: 0.5, group: 'Damage' },
    { type: 'range', key: 'invert', label: 'Inversions', min: 0, max: 1, default: 0.35, group: 'Damage' },
    { type: 'range', key: 'crush', label: 'Bit crush', min: 0, max: 1, default: 0.4, group: 'Damage' },
    { type: 'range', key: 'noise', label: 'Static', min: 0, max: 1, default: 0.3, group: 'Damage' },
  ],
  presets: [
    { name: 'Corrupted', values: {} },
    { name: 'Subtle', values: { intensity: 0.3, split: 0.3, tear: 0.25, invert: 0, crush: 0.1, noise: 0.15 } },
    { name: 'RGB storm', values: { split: 1, intensity: 0.7, invert: 0.1 } },
    { name: 'Datamosh', values: { blocks: 6, intensity: 0.9, crush: 1, split: 0.3, invert: 0.15 } },
    { name: 'Signal loss', values: { tear: 1, noise: 1, intensity: 0.7, blocks: 24 } },
    { name: 'Negative flash', values: { invert: 1, intensity: 0.75, speed: 1.6 } },
    { name: 'Frozen error', values: { speed: 0, intensity: 0.8 } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float t = u_time * u_speed;
  float st = floor(t * 9.0);
  float sd = u_seed * 173.0;
  float I = u_intensity;
  // Most steps are mild; some burst.
  float burst = step(0.6, hash11(st * 0.713 + sd));
  float g = I * mix(0.4, 1.0, burst);
  vec2 p = uv;

  // Horizontal slices that jump sideways.
  float sliceN = floor(mix(5.0, 26.0, hash11(st + 1.3 + sd)));
  float sid = floor(uv.y * sliceN + hash11(st + 4.1 + sd));
  float sOn = step(1.0 - 0.45 * g, hash12(vec2(sid, st + sd)));
  p.x += sOn * (hash12(vec2(sid + 17.0, st + sd)) - 0.5) * 0.3 * g;

  // Blocks (wider than tall) that jump.
  vec2 bn = vec2(u_blocks, u_blocks * 2.0 * u_res.y / u_res.x);
  vec2 bid = floor(uv * bn);
  float bOn = step(1.0 - 0.28 * g, hash12(bid + st * 3.17 + sd));
  p += bOn * (hash22(bid + st + sd + 5.0) - 0.5) * vec2(0.3, 0.06) * g;
  // A finer layer of thin strips.
  vec2 bn2 = bn * vec2(2.5, 4.0);
  vec2 bid2 = floor(uv * bn2);
  float b2On = step(1.0 - 0.2 * g, hash12(bid2 * 1.3 + st * 2.1 + sd + 9.0));
  p.x += b2On * (hash12(bid2 + st + 3.0) - 0.5) * 0.12 * g;

  // RGB split, stronger where things jumped.
  float spl = u_split * (0.003 + 0.02 * g + 0.025 * max(bOn, sOn) + 0.015 * b2On);
  vec2 ofs = vec2(spl, spl * 0.2 * (hash11(st + 8.0) - 0.5));
  p = clamp(p, 0.0, 1.0);
  vec4 cg = src(p);
  vec3 col = vec3(src(p + ofs).r, cg.g, src(p - ofs).b);

  // Bit crush inside some blocks: posterise and pixelate.
  float crushOn = bOn * step(1.0 - u_crush, hash12(bid + 31.0 + st));
  if (crushOn > 0.5) {
    vec2 cp = (floor(p * bn * 6.0) + 0.5) / (bn * 6.0);
    col = floor(srcAvg(cp, u_res.x / (u_blocks * 6.0)).rgb * 4.0 + 0.5) / 4.0;
  }

  // Tear lines: thin rows smeared from a single point.
  float tid = floor(uv.y * 180.0);
  float tearOn = step(1.0 - u_tear * 0.07 * (0.3 + g), hash12(vec2(tid, st + sd + 9.0)));
  if (tearOn > 0.5) {
    float x0 = hash12(vec2(tid, st + 2.0));
    vec3 smear = src(vec2(x0, uv.y)).rgb;
    float bright = hash12(vec2(tid, st + 5.0));
    col = mix(col, smear * 1.3 + 0.15 * bright, 0.85);
  }

  // Inverted / channel-swapped blocks.
  vec2 ibn = bn * vec2(0.7, 0.5);
  vec2 iid = floor(uv * ibn);
  float hi = hash12(iid * 1.7 + st * 1.31 + sd + 2.0);
  float invOn = step(1.0 - u_invert * 0.22 * g * (0.4 + burst), hi);
  if (invOn > 0.5) col = hi > 0.5 + 0.5 * (1.0 - u_invert * 0.22 * g) ? 1.0 - col : col.brg;

  // Static.
  vec2 npx = floor(uv * u_res / max(u_unit * 2.0, 1.0));
  float n = hash13(vec3(npx, st * 7.0 + u_frame * step(0.001, u_speed)));
  col += (n - 0.5) * u_noise * (0.12 + 0.6 * max(max(bOn, tearOn), crushOn) * g);

  return vec4(clamp(col, 0.0, 1.0), cg.a);
}
`,
};

// ── Pixel Sort ─────────────────────────────────────────────────────────────

const pixelSort: EffectDef = {
  id: 'pixel-sort',
  name: 'Pixel Sort',
  category: 'glitch',
  description: 'Runs of pixels inside a brightness band sorted into long streaks along one direction.',
  params: [
    { type: 'range', key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, default: 90, unit: '°' },
    { type: 'range', key: 'lo', label: 'Threshold low', min: 0, max: 1, default: 0.28 },
    { type: 'range', key: 'hi', label: 'Threshold high', min: 0, max: 1, default: 1 },
    { type: 'range', key: 'length', label: 'Streak length', min: 0.05, max: 1, default: 0.6 },
    {
      type: 'select',
      key: 'key',
      label: 'Sort by',
      options: [
        { value: 0, label: 'Brightness' },
        { value: 1, label: 'Hue' },
        { value: 2, label: 'Saturation' },
      ],
      default: 0,
      group: 'Sort',
    },
    { type: 'toggle', key: 'reverse', label: 'Reverse order', default: false, group: 'Sort' },
    { type: 'range', key: 'jitter', label: 'Ragged ends', min: 0, max: 1, default: 0.6, group: 'Sort' },
    { type: 'range', key: 'speed', label: 'Breathing', min: 0, max: 3, default: 0.6, group: 'Motion' },
  ],
  presets: [
    { name: 'Melting', values: {} },
    { name: 'Rising darks', values: { angle: 270, lo: 0.05, hi: 0.62, reverse: true, length: 0.8 } },
    { name: 'Horizontal drag', values: { angle: 0, length: 0.7, jitter: 0.3 } },
    { name: 'Diagonal', values: { angle: 45, lo: 0.3, length: 0.6 } },
    { name: 'Hue rainbow', values: { key: 1, lo: 0.25, length: 0.8 } },
    { name: 'Short rain', values: { length: 0.18, jitter: 1, lo: 0.3 } },
    { name: 'Everything', values: { lo: 0, hi: 1, length: 0.35, jitter: 0.9 } },
  ],
  glsl: /* glsl */ `
float psKey(vec3 c, int key) {
  if (key == 1) return rgb2hsv(c).x;
  if (key == 2) return rgb2hsv(c).y;
  return luma(c);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float t = u_time * u_speed;
  float breathe = 0.06 * sin(t * 1.1) + 0.03 * sin(t * 2.7 + 1.0);
  float lo = min(u_lo, u_hi) + (u_lo > 0.001 ? breathe : 0.0);
  float hi = max(u_lo, u_hi);
  float l0 = luma(s.rgb);
  if (l0 < lo || l0 > hi) return s;

  float ang = radians(u_angle);
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 px = uv * u_res;
  float along = dot(px, dir);
  float across = dot(px, nrm);

  // Ragged ends: each thin column gets its own reach.
  float colW = max(u_res.y / 360.0, 1.0);
  float jit = hash11(floor(across / colW) * 0.618 + u_seed * 29.0);
  float reach = mix(1.0, 0.1 + 0.9 * jit * jit, u_jitter);
  float stp = max(u_length * reach * length(u_res) / 32.0, 1.0);
  float base = floor(along / stp) * stp;

  int key = int(u_key + 0.5);
  float k0 = psKey(s.rgb, key);
  vec3 cMin = s.rgb, cMax = s.rgb, cSum = s.rgb;
  float kMin = k0, kMax = k0, n = 1.0;
  float nBack = 0.0, nFwd = 0.0;

  // Walk back and forward along the direction on a grid shared by the whole streak.
  bool open = true;
  for (int i = 0; i < 16; i++) {
    vec2 q = (dir * (base - float(i) * stp) + nrm * across) / u_res;
    if (!open || q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { open = false; continue; }
    vec3 c = texture(u_src, q).rgb;
    float l = luma(c);
    if (l < lo || l > hi) { open = false; continue; }
    nBack += 1.0;
    float kk = psKey(c, key);
    if (kk < kMin) { kMin = kk; cMin = c; }
    if (kk > kMax) { kMax = kk; cMax = c; }
    cSum += c; n += 1.0;
  }
  open = true;
  for (int i = 1; i <= 16; i++) {
    vec2 q = (dir * (base + float(i) * stp) + nrm * across) / u_res;
    if (!open || q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { open = false; continue; }
    vec3 c = texture(u_src, q).rgb;
    float l = luma(c);
    if (l < lo || l > hi) { open = false; continue; }
    nFwd += 1.0;
    float kk = psKey(c, key);
    if (kk < kMin) { kMin = kk; cMin = c; }
    if (kk > kMax) { kMax = kk; cMax = c; }
    cSum += c; n += 1.0;
  }
  float start = base - max(nBack - 1.0, 0.0) * stp;
  float end = base + (nFwd + 1.0) * stp;
  float f = clamp((along - start) / max(end - start, 1.0), 0.0, 1.0);
  if (u_reverse > 0.5) f = 1.0 - f;
  vec3 sorted = ramp3(cMin, cSum / n, cMax, f);
  // Very short runs stay close to the original pixel.
  float run = clamp((nBack + nFwd) / 3.0, 0.0, 1.0);
  return vec4(mix(s.rgb, sorted, run), s.a);
}
`,
};

// ── Ribbon Scan ────────────────────────────────────────────────────────────

const ribbonScan: EffectDef = {
  id: 'ribbon-scan',
  name: 'Ribbon Scan',
  category: 'glitch',
  description: 'Slit-scan ribbons: thin vertical lines that swell with the picture, each slipped up or down in time.',
  params: [
    { type: 'range', key: 'ribbons', label: 'Ribbons', min: 20, max: 320, step: 1, default: 110 },
    { type: 'range', key: 'width', label: 'Width', min: 0.1, max: 1, default: 0.75 },
    {
      type: 'range',
      key: 'offset',
      label: 'Slip',
      min: 0,
      max: 0.5,
      default: 0.12,
      hint: 'Vertical offset per ribbon',
    },
    { type: 'range', key: 'twist', label: 'Twist', min: 0, max: 1, default: 0.25 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.4, unit: '×', group: 'Tone' },
    {
      type: 'select',
      key: 'mode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#5dff8c', group: 'Ink' },
    { type: 'color', key: 'bg', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 0.7, group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Scan speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Green scan', values: {} },
    { name: 'Photo ribbons', values: { mode: 1, glow: 0.4, offset: 0.08 } },
    { name: 'Cheese', values: { ink: '#ffc53d', twist: 0.6, ribbons: 80 } },
    { name: 'Ink on cream', values: { ink: '#15120e', bg: '#f5ecd7', glow: 0, contrast: 1.1 } },
    { name: 'Dense scan', values: { ribbons: 240, twist: 0, width: 0.9, offset: 0.05 } },
    { name: 'Twisted', values: { ribbons: 48, twist: 1, width: 0.95, offset: 0.2, ink: '#ff5a3c' } },
    { name: 'Time smear', values: { offset: 0.4, ribbons: 150, speed: 1.6 } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float pitch = u_res.x / u_ribbons;
  vec2 px = uv * u_res;
  float t = u_time * u_speed;
  float rid = floor(px.x / pitch);
  float h = hash11(rid * 1.618 + u_seed * 37.0);

  // Slit-scan: each ribbon reads the picture a little higher or lower, drifting over time.
  float wave = 0.6 * sin(rid * 0.09 + t * 0.8) + 0.4 * sin(rid * 0.031 - t * 0.45 + 2.0);
  float off = u_offset * mix(wave, h * 2.0 - 1.0, 0.35);
  float sy = uv.y + off;
  sy = 1.0 - abs(1.0 - mod(sy, 2.0));
  vec2 suv = vec2((rid + 0.5) * pitch / u_res.x, sy);
  vec4 s = srcAvg(suv, pitch);
  float b = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  // Twist: the ribbon turns, narrowing to an edge and showing its darker back.
  float tw = cos(uv.y * u_res.y / (pitch * 9.0) * (0.7 + 0.6 * h) + h * TAU + t * 1.3);
  float wid = mix(1.0, abs(tw), u_twist);
  float side = mix(1.0, tw > 0.0 ? 1.0 : 0.55, u_twist);

  // A bright scan head travels down each ribbon.
  float head = fract(uv.y * 0.7 - t * 0.22 + h);
  float scan = smoothstep(0.85, 1.0, head);

  float halfW = 0.5 * pitch * u_width * (0.08 + 0.92 * b) * wid * (1.0 + 0.3 * scan);
  float lx = abs(px.x - (rid + 0.5) * pitch);
  float cov = fill(lx - halfW, 1.0);

  vec3 ink = int(u_mode + 0.5) == 1 ? saturation(s.rgb, 1.25) * 1.15 : u_ink;
  float level = (0.35 + 0.65 * b) * side * (1.0 + 0.6 * scan);
  vec3 col = mix(u_bg, ink * level, cov);
  col += ink * b * u_glow * 0.35 * exp(-lx / (pitch * 0.35)) * (1.0 - cov);
  return vec4(col, max(src(uv).a, s.a));
}
`,
};

// ── VHS ────────────────────────────────────────────────────────────────────

// Glyph order in the atlas (the shader indexes these).
const VHS_GLYPHS = [' ', '▶', 'P', 'L', 'A', 'Y', 'S', ':', 'R', 'E', 'C', '●', ...'0123456789'];

const vhs: EffectDef = {
  id: 'vhs',
  name: 'VHS',
  category: 'glitch',
  description: 'A worn videotape: wobbling lines, bleeding colour, tape noise, a tracking bar and the PLAY overlay.',
  params: [
    { type: 'range', key: 'wobble', label: 'Wobble', min: 0, max: 1, default: 0.45 },
    { type: 'range', key: 'bleed', label: 'Colour bleed', min: 0, max: 1, default: 0.55 },
    { type: 'range', key: 'noise', label: 'Tape noise', min: 0, max: 1, default: 0.45 },
    { type: 'range', key: 'tracking', label: 'Tracking', min: 0, max: 1, default: 0.5 },
    {
      type: 'select',
      key: 'osd',
      label: 'Overlay',
      options: [
        { value: 0, label: 'Off' },
        { value: 1, label: '▶ PLAY' },
        { value: 2, label: '● REC' },
      ],
      default: 1,
    },
    { type: 'range', key: 'soft', label: 'Softness', min: 0, max: 1, default: 0.5, group: 'Tone' },
    { type: 'range', key: 'color', label: 'Colour', min: 0, max: 1.5, default: 0.75, unit: '×', group: 'Tone' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Rental tape', values: {} },
    { name: 'Worn out', values: { noise: 1, tracking: 1, wobble: 0.9, color: 0.5, bleed: 0.9 } },
    { name: 'Home video', values: { osd: 2, wobble: 0.3, tracking: 0.2, color: 0.95 } },
    { name: 'Clean copy', values: { wobble: 0.12, noise: 0.12, tracking: 0, bleed: 0.3, soft: 0.3 } },
    { name: 'Late-night rerun', values: { color: 0.25, soft: 0.9, noise: 0.7, osd: 0 } },
    { name: 'Colour smear', values: { bleed: 1, color: 1.4, osd: 0, tracking: 0.3 } },
  ],
  atlas: (p) =>
    Number(p.osd) > 0.5 ? { glyphs: VHS_GLYPHS, font: 'mono', weight: 700, cellAspect: 0.62, fill: 0.78 } : null,
  glsl: /* glsl */ `
vec3 vhsToYiq(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 vhsToRgb(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }

const float VHS_PLAY[6] = float[6](1.0, 0.0, 2.0, 3.0, 4.0, 5.0);
const float VHS_REC[6] = float[6](11.0, 0.0, 8.0, 9.0, 10.0, 0.0);

// Glyph index for character i of an overlay line (-1: nothing).
float vhsChar(int line, int i, int mode, float secs) {
  if (line == 0) {
    if (i > 5) return -1.0;
    return mode == 2 ? VHS_REC[i] : VHS_PLAY[i];
  }
  // "SP 0:00:00"
  if (i == 0) return 6.0;
  if (i == 1) return 2.0;
  if (i == 2) return 0.0;
  if (i == 4 || i == 7) return 7.0;
  float hh = floor(secs / 3600.0);
  float mm = mod(floor(secs / 60.0), 60.0);
  float ss = mod(floor(secs), 60.0);
  float d = 0.0;
  if (i == 3) d = mod(hh, 10.0);
  else if (i == 5) d = floor(mm / 10.0);
  else if (i == 6) d = mod(mm, 10.0);
  else if (i == 8) d = floor(ss / 10.0);
  else if (i == 9) d = mod(ss, 10.0);
  else return -1.0;
  return 12.0 + d;
}

// Overlay ink at px for one line of text starting at org (top-left), cells ch px tall.
float vhsText(vec2 px, vec2 org, float ch, int line, int mode, float secs, out float gi) {
  float cw = ch * 0.62;
  vec2 lp = (px - org) / vec2(cw, ch);
  gi = -1.0;
  if (lp.x < 0.0 || lp.y < 0.0 || lp.y >= 1.0 || lp.x >= 10.0) return 0.0;
  gi = vhsChar(line, int(floor(lp.x)), mode, secs);
  if (gi < 0.0) return 0.0;
  return glyph(gi, vec2(fract(lp.x), lp.y), ch);
}

vec4 effect(vec2 uv) {
  float t = u_time * u_speed;
  float fr = floor(t * 30.0);
  vec2 px = uv * u_res;
  float ln = floor(uv.y * 240.0);

  // Line wobble: per-line jitter plus a slow bend.
  float wob = (hash12(vec2(ln, fr + u_seed * 50.0)) - 0.5) * 0.003;
  wob += (vnoise(vec2(uv.y * 5.0, t * 1.3)) - 0.5) * 0.014;
  wob *= u_wobble;
  // Head-switching noise along the bottom edge.
  float hsw = smoothstep(0.955, 1.0, uv.y);
  wob += hsw * (0.02 + 0.03 * hash12(vec2(ln, fr))) * (0.3 + u_wobble);
  // Tracking bar rolling through.
  float ty = fract(t * 0.05 + u_seed);
  float dy = uv.y - ty;
  dy -= floor(dy + 0.5);
  float bar = exp(-dy * dy / 0.0012) * u_tracking;
  wob += bar * (hash12(vec2(ln, fr + 3.0)) - 0.35) * 0.05;
  vec2 p = vec2(uv.x + wob, uv.y);

  // Luma: soft. Chroma: much softer, smeared to the right.
  float lumPx = max(u_soft * u_res.y / 240.0, 1.0);
  vec4 sc = srcAvg(p, lumPx);
  float Y = dot(sc.rgb, vec3(0.299, 0.587, 0.114));
  float cpx = u_res.y / 110.0 * (0.4 + u_bleed);
  float shift = u_bleed * u_res.y / 160.0;
  vec2 iq = vec2(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 5; i++) {
    float o = (shift + float(i) * cpx * 0.7) / u_res.x;
    float w = 1.0 - float(i) * 0.17;
    iq += vhsToYiq(srcAvg(p - vec2(o, 0.0), cpx).rgb).yz * w;
    wsum += w;
  }
  iq /= wsum;
  vec3 col = vhsToRgb(vec3(Y, iq * u_color));

  // Tape tone: lifted blacks, soft whites, a faint magenta-teal cast.
  col = col * 0.86 + 0.07;
  col *= vec3(1.03, 0.98, 1.04);

  // Dropouts: short white streaks.
  float nl = floor(uv.y * 360.0);
  float hn = hash12(vec2(nl, fr + 11.0));
  if (hn > 1.0 - u_noise * 0.03) {
    float x0 = hash12(vec2(nl, fr + 12.0));
    float len = 0.04 + 0.25 * hash12(vec2(nl, fr + 13.0));
    float seg = smoothstep(x0, x0 + 0.01, uv.x) * smoothstep(x0 + len, x0 + len - 0.03, uv.x);
    float spark = smoothstep(0.35, 0.8, vnoise(vec2(uv.x * 220.0, nl + fr)));
    col = mix(col, vec3(0.95), seg * spark);
  }
  // Tracking bar and head switching: snow.
  float snow = hash13(vec3(floor(px / max(u_unit * 1.5, 1.0)), fr));
  float snowAmt = bar * 0.7 * step(0.45, hash12(vec2(ln * 0.5, fr + 7.0))) + hsw * 0.5;
  col = mix(col, vec3(snow), clamp(snowAmt, 0.0, 1.0) * 0.8);
  col += bar * 0.06;
  // Grain.
  col += (snow - 0.5) * u_noise * 0.12;
  // Faint scanlines (only where there is room for them).
  float lp = u_res.y / 240.0;
  col *= 1.0 - 0.08 * smoothstep(1.5, 3.0, lp) * (0.5 + 0.5 * cos(uv.y * 240.0 * TAU));
  // Vignette.
  vec2 vc = uv - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.45;

  // On-screen display: crisp, from the VCR, not the tape.
  int mode = int(u_osd + 0.5);
  if (mode > 0) {
    float ch = u_res.y * 0.065;
    vec2 m = vec2(u_res.y * 0.07);
    vec2 so = vec2(ch * 0.07);
    float secs = floor(u_time) + 3.0;
    float g0, g1, gs;
    float ink0 = vhsText(px, m, ch, 0, mode, secs, g0);
    float ink1 = vhsText(px, vec2(m.x, u_res.y - m.y - ch), ch, 1, mode, secs, g1);
    float sh = max(vhsText(px - so, m, ch, 0, mode, secs, gs), vhsText(px - so, vec2(m.x, u_res.y - m.y - ch), ch, 1, mode, secs, gs));
    col = mix(col, col * 0.25, sh * 0.75);
    vec3 osdCol = vec3(0.96, 0.97, 0.95);
    if (g0 > 10.5 && g0 < 11.5) {
      osdCol = vec3(1.0, 0.24, 0.18);
      ink0 *= step(0.5, fract(u_time * 0.8));
    }
    col = mix(col, osdCol, ink0);
    col = mix(col, vec3(0.96, 0.97, 0.95), ink1);
  }
  return vec4(clamp(col, 0.0, 1.0), sc.a);
}
`,
};

// ── Film Prism (analog) ────────────────────────────────────────────────────

const filmPrism: EffectDef = {
  id: 'film-prism',
  name: 'Film Prism',
  category: 'analog',
  description: 'Prismatic film: rainbow fringes toward the edges, drifting light leaks, red halation and grain.',
  params: [
    { type: 'range', key: 'aberration', label: 'Aberration', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'prism', label: 'Prism band', min: 0, max: 1, default: 0.45 },
    { type: 'range', key: 'leaks', label: 'Light leaks', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'halation', label: 'Halation', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'grain', label: 'Grain', min: 0, max: 1, default: 0.35 },
    { type: 'range', key: 'fade', label: 'Fade', min: 0, max: 1, default: 0.3, group: 'Tone' },
    { type: 'color', key: 'leakA', label: 'Leak colour', default: '#ff5a3c', group: 'Tone' },
    { type: 'color', key: 'leakB', label: 'Leak colour 2', default: '#ffc53d', group: 'Tone' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Summer roll', values: {} },
    { name: 'Prism flare', values: { prism: 1, aberration: 0.85, leaks: 0.35 } },
    { name: 'Burnt edges', values: { leaks: 1, leakA: '#ff3c1e', leakB: '#ff9a3c', fade: 0.45 } },
    { name: 'Clean lens', values: { leaks: 0, prism: 0, halation: 0.25, grain: 0.15, fade: 0.1 } },
    { name: 'Night film', values: { halation: 1, leaks: 0.2, grain: 0.6, fade: 0.15 } },
    { name: 'Basil leak', values: { leakA: '#7fe08f', leakB: '#ffc53d', prism: 0.7 } },
    { name: 'Faded print', values: { fade: 0.9, grain: 0.5, aberration: 0.3, leaks: 0.4 } },
  ],
  glsl: /* glsl */ `
${MIRROR}
vec4 effect(vec2 uv) {
  float t = u_time * u_speed;
  float aspect = u_res.x / u_res.y;
  // Gate weave.
  uv.y += (vnoise(vec2(t * 3.0, u_seed * 10.0)) - 0.5) * 0.0025 * step(0.001, u_speed);

  // Spectral fringes: radial, growing to the edges.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(d) / length(vec2(aspect, 1.0) * 0.5);
  vec2 radial = normalize(d + 1e-5) * r * r * u_aberration * 0.045;
  // A prism band sweeping across adds a strong directional split.
  vec2 pd = normalize(vec2(0.8, 0.6));
  float bp = dot(d, pd);
  float bc = 0.4 * sin(t * 0.21 + u_seed * 6.0);
  float band = smoothstep(0.32, 0.0, abs(bp - bc));
  vec2 split = radial + vec2(-pd.y, pd.x) * band * u_prism * 0.06;
  split /= vec2(aspect, 1.0);

  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float x = float(i) / 6.0;
    vec3 w = clamp(1.0 - abs(x - vec3(0.08, 0.5, 0.92)) * 2.8, 0.0, 1.0);
    vec3 c = src(mirrorUV(uv + split * (x - 0.5) * 2.0)).rgb;
    acc += c * w;
    wsum += w;
  }
  vec3 col = acc / wsum;
  float alpha = src(uv).a;
  // Light caught in the prism: a faint rainbow across the band.
  vec3 rainbow = hsv2rgb(vec3(fract((bp - bc) * 1.6 + 0.62), 0.75, 1.0));
  col = 1.0 - (1.0 - col) * (1.0 - rainbow * band * band * u_prism * 0.22);

  // Halation: red-orange glow around highlights.
  vec3 h1 = srcAvg(uv, u_res.y * 0.015).rgb;
  vec3 h2 = srcAvg(uv, u_res.y * 0.05).rgb;
  float hl = max(luma(h1) - 0.55, 0.0) + 0.7 * max(luma(h2) - 0.5, 0.0);
  col += vec3(1.0, 0.3, 0.12) * hl * u_halation * 1.8;

  // Film tone: gentle S-curve, lifted warm blacks.
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
  col = mix(col, col * 0.82 + vec3(0.1, 0.075, 0.06), u_fade);

  // Light leaks: warm blobs drifting in from the edges.
  vec2 a = uv * vec2(aspect, 1.0);
  vec2 c1 = vec2(-0.05 + 0.08 * sin(t * 0.31), 0.25 + 0.3 * sin(t * 0.17 + 1.0));
  vec2 c2 = vec2(aspect + 0.02 + 0.08 * sin(t * 0.23 + 2.0), 0.75 + 0.25 * sin(t * 0.19 + 4.0));
  vec2 c3 = vec2(aspect * (0.3 + 0.4 * fract(t * 0.03 + u_seed)), -0.12);
  float b1 = exp(-dot(a - c1, a - c1) * 5.0);
  float b2 = exp(-dot(a - c2, a - c2) * 4.0);
  float b3 = exp(-dot(a - c3, a - c3) * 9.0);
  float org = 0.55 + 0.9 * fbm(a * 2.2 + vec2(t * 0.08, -t * 0.05));
  vec3 leak = (u_leakA * (b1 * 1.2 + b3 * 0.7) + u_leakB * b2 * 1.1) * org;
  leak += u_leakA * smoothstep(0.1, 0.0, uv.x) * 0.35 * org;
  col = 1.0 - (1.0 - col) * (1.0 - clamp(leak * u_leaks, 0.0, 1.0));

  // Grain, strongest in the mid-tones.
  float gs = max(u_unit * 1.4, 1.0);
  vec2 gp = uv * u_res / gs;
  float fr = floor(t * 24.0);
  float n = vnoise(gp + fr * 17.31) + 0.5 * vnoise(gp * 2.3 - fr * 9.13) - 0.75;
  float lm = luma(col);
  col += n * u_grain * 0.28 * (0.45 + 0.55 * (1.0 - abs(lm * 2.0 - 1.0)));

  return vec4(clamp(col, 0.0, 1.0), alpha);
}
`,
};

// ── Wave Lines (analog) ────────────────────────────────────────────────────

const waveLines: EffectDef = {
  id: 'wave-lines',
  name: 'Wave Lines',
  category: 'analog',
  description: 'The picture drawn as stacked horizontal lines lifted by brightness, like a pulsar plot or a scope.',
  params: [
    { type: 'range', key: 'lines', label: 'Lines', min: 12, max: 200, step: 1, default: 56 },
    { type: 'range', key: 'amp', label: 'Height', min: 0, max: 4, default: 2.2, unit: '×' },
    { type: 'range', key: 'thick', label: 'Thickness', min: 0.03, max: 0.6, default: 0.12 },
    { type: 'toggle', key: 'hidden', label: 'Hide lines behind', default: true },
    { type: 'range', key: 'wobble', label: 'Wobble', min: 0, max: 1, default: 0.3, group: 'Shape' },
    {
      type: 'select',
      key: 'mode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo' },
        { value: 2, label: 'Height ramp' },
      ],
      default: 0,
      group: 'Ink',
    },
    { type: 'color', key: 'ink', label: 'Ink', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'bg', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 0.35, group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Pulsar', values: {} },
    { name: 'Oscilloscope', values: { hidden: false, ink: '#7fe08f', glow: 1.4, lines: 36, amp: 1.2, thick: 0.08 } },
    { name: 'Photo lines', values: { mode: 1, lines: 80, thick: 0.2, glow: 0.2 } },
    { name: 'Print', values: { ink: '#15120e', bg: '#f5ecd7', glow: 0, thick: 0.1 } },
    { name: 'Fine mesh', values: { lines: 140, thick: 0.18, amp: 2.8, wobble: 0.15 } },
    { name: 'Heat ridges', values: { mode: 2, amp: 2.6, wobble: 0.5 } },
    { name: 'Cheese wire', values: { ink: '#ffc53d', wobble: 0.7, lines: 44, glow: 0.8 } },
  ],
  glsl: /* glsl */ `
float wlHeight(vec2 q, float spPx, float t, float row) {
  float b = luma(srcAvg(q, spPx * 0.7).rgb);
  b = smoothstep(0.12, 0.85, b);
  float n = vnoise(vec2(q.x * 60.0 - t * 1.7, row * 3.7)) - 0.5;
  float w = sin(q.x * TAU * 4.0 - t * 2.2 + row * 0.6);
  return b + u_wobble * (n * (0.35 + 0.9 * b) + 0.06 * w);
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float sp = u_res.y / u_lines;
  float amp = u_amp * sp;
  float t = u_time * u_speed;
  float th = max(sp * u_thick * 0.5, 0.5);
  float base = floor(px.y / sp);
  float e = max(sp * 0.25, 1.5) / u_res.x;
  int mode = int(u_mode + 0.5);
  vec3 col = u_bg;
  float alpha = src(uv).a;

  // Lines at and below this pixel can be lifted up to it; draw them back (top) to front (bottom).
  for (int k = -1; k < 6; k++) {
    float row = base + float(k);
    float y0 = (row + 0.5) * sp;
    if (y0 > u_res.y + sp) continue;
    vec2 q = vec2(uv.x, clamp(y0 / u_res.y, 0.0, 1.0));
    float h0 = wlHeight(q, sp, t, row);
    float h1 = wlHeight(q + vec2(e, 0.0), sp, t, row);
    float yc = y0 - amp * h0;
    float slope = -amp * (h1 - h0) / (e * u_res.x);
    float d = abs(px.y - yc) / sqrt(1.0 + slope * slope);
    if (u_hidden > 0.5 && px.y > yc) col = u_bg;
    vec3 lc = u_ink;
    if (mode == 1) lc = saturation(srcAvg(q, sp).rgb, 1.2) * 1.1;
    else if (mode == 2) lc = ramp3(vec3(0.5, 0.08, 0.06), vec3(1.0, 0.353, 0.235), vec3(1.0, 0.85, 0.45), clamp(h0, 0.0, 1.0));
    float ink = fill(d - th, 1.0);
    col = mix(col, lc, ink);
    col += lc * u_glow * 0.3 * exp(-max(d - th, 0.0) / (th * 3.0 + sp * 0.15)) * (1.0 - ink);
  }
  return vec4(clamp(col, 0.0, 1.0), alpha);
}
`,
};

export const GLITCH_EFFECTS: EffectDef[] = [
  crtScreen,
  crystalGlass,
  glassPixelDispersion,
  glitch,
  pixelSort,
  ribbonScan,
  vhs,
  filmPrism,
  waveLines,
];
