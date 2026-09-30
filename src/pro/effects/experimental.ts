import { type EffectDef } from './types';

const thermal: EffectDef = {
  id: 'thermal',
  name: 'Thermal',
  category: 'light',
  pick: true,
  description: 'A heat camera: brightness mapped through iron, rainbow or white-hot palettes.',
  params: [
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Iron' },
        { value: 1, label: 'Rainbow' },
        { value: 2, label: 'White hot' },
        { value: 3, label: 'Black hot' },
        { value: 4, label: 'Arctic' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×' },
    { type: 'range', key: 'shift', label: 'Heat shift', min: -0.5, max: 0.5, default: 0 },
    { type: 'range', key: 'blur', label: 'Sensor blur', min: 0, max: 1, default: 0.35, group: 'Sensor' },
    { type: 'range', key: 'noise', label: 'Noise', min: 0, max: 1, default: 0.25, group: 'Sensor' },
    { type: 'toggle', key: 'scan', label: 'Scan lines', default: true, group: 'Sensor' },
    { type: 'toggle', key: 'hud', label: 'Crosshair', default: false, group: 'Sensor' },
  ],
  presets: [
    { name: 'Iron', values: {} },
    { name: 'Rainbow', values: { palette: 1 } },
    { name: 'White hot', values: { palette: 2, scan: false } },
    { name: 'Black hot', values: { palette: 3 } },
    { name: 'Arctic', values: { palette: 4, hud: true } },
  ],
  glsl: /* glsl */ `
vec3 heat(float t, int p) {
  t = clamp(t, 0.0, 1.0);
  if (p == 1) return hsv2rgb(vec3(0.7 * (1.0 - t), 0.9, 0.25 + 0.75 * smoothstep(0.0, 0.2, t)));
  if (p == 2) return vec3(t);
  if (p == 3) return vec3(1.0 - t);
  if (p == 4) return ramp3(vec3(0.02, 0.05, 0.2), vec3(0.1, 0.55, 0.85), vec3(0.95, 1.0, 1.0), t);
  vec3 a = vec3(0.0, 0.0, 0.05), b = vec3(0.35, 0.0, 0.55), c = vec3(0.85, 0.1, 0.25), d = vec3(1.0, 0.55, 0.0), e = vec3(1.0, 1.0, 0.75);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

vec4 effect(vec2 uv) {
  vec4 s = srcLod(uv, u_blur * 4.0);
  float l = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5 + u_shift, 0.0, 1.0);
  vec2 px = uv * u_res;
  l += (hash13(vec3(floor(px / 2.0), floor(u_time * 24.0))) - 0.5) * u_noise * 0.12;
  vec3 col = heat(l, int(u_palette + 0.5));
  if (u_scan > 0.5) col *= 0.88 + 0.12 * sin(px.y * PI * 0.5);
  if (u_hud > 0.5) {
    vec2 d = abs(px - u_res * 0.5);
    float w = u_res.y * 0.002 + 0.5;
    float cross = max(fill(d.x - w, 1.0) * step(d.y, u_res.y * 0.05), fill(d.y - w, 1.0) * step(d.x, u_res.y * 0.05));
    cross *= step(u_res.y * 0.012, max(d.x, d.y));
    col = mix(col, vec3(1.0), cross);
  }
  return vec4(col, s.a);
}
`,
};

const emberVeil: EffectDef = {
  id: 'ember-veil',
  name: 'Ember Veil',
  category: 'experimental',
  feedback: true,
  description: 'Glowing embers rise from the bright parts through heat shimmer, under a dark warm veil.',
  params: [
    { type: 'range', key: 'embers', label: 'Embers', min: 10, max: 90, step: 1, default: 34 },
    { type: 'range', key: 'veil', label: 'Veil', min: 0, max: 1, default: 0.75 },
    {
      type: 'range',
      key: 'threshold',
      label: 'Source',
      min: 0,
      max: 1,
      default: 0.45,
      hint: 'How bright a spot must be to shed embers',
    },
    { type: 'range', key: 'size', label: 'Ember size', min: 0.5, max: 8, step: 0.1, default: 2.6, unit: 'px' },
    { type: 'range', key: 'shimmer', label: 'Heat shimmer', min: 0, max: 1, default: 0.5, group: 'Motion' },
    { type: 'range', key: 'trails', label: 'Trails', min: 0, max: 1, default: 0.7, group: 'Motion' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
    { type: 'color', key: 'hot', label: 'Hot', default: '#ffc53d', group: 'Ink' },
    { type: 'color', key: 'cool', label: 'Cool', default: '#ff5a3c', group: 'Ink' },
  ],
  presets: [
    { name: 'Campfire', values: {} },
    { name: 'Inferno', values: { veil: 0.45, embers: 64, shimmer: 1, threshold: 0.3, size: 3 } },
    { name: 'Ash storm', values: { hot: '#f5ecd7', cool: '#8a8079', embers: 80, size: 1.6, trails: 0.4 } },
    { name: 'Blue flame', values: { hot: '#d8f0ff', cool: '#3c7bff', veil: 0.8 } },
    {
      name: 'Fireflies',
      values: { hot: '#e8ff9a', cool: '#7fe08f', speed: 0.35, veil: 0.85, trails: 0.3, embers: 24 },
    },
    { name: 'Slow drift', values: { speed: 0.4, trails: 1, size: 3.6, embers: 28 } },
  ],
  glsl: /* glsl */ `
// One depth of embers: a grid (cells cellPx wide) scrolling up at rise × height per second.
vec3 emberLayer(vec2 px, float cellPx, float rise, float t, float layer, float r) {
  float scroll = rise * t * u_res.y / cellPx;
  vec2 q = px / cellPx + vec2(0.0, scroll);
  vec2 id = floor(q);
  vec2 f = fract(q);
  vec3 h = hash32(id + vec2(layer * 37.1, layer * 11.3) + u_seed * 101.0);
  if (h.z < 0.5) return vec3(0.0);
  float hz = fract(h.z * 7.31);
  vec2 o = vec2(0.3 + 0.4 * h.x, 0.3 + 0.4 * h.y);
  // Sway as it climbs (by its height on screen), plus a little flutter.
  float ey = id.y + o.y - scroll;
  o.x += 0.22 * sin(ey * 0.9 + h.x * TAU) + 0.06 * sin(t * (1.5 + 2.0 * h.y) + hz * 20.0);
  vec2 d = (f - o) * cellPx;
  float rr = min(r * (0.5 + 1.1 * hz), cellPx * 0.08);
  // A short streak below the head, about one frame of travel long.
  float stretch = 1.0 + rise * u_res.y * u_speed / (30.0 * rr);
  vec2 ds = vec2(d.x, d.y > 0.0 ? d.y / stretch : d.y);
  float d2 = dot(ds, ds);
  float core = exp(-d2 / (rr * rr));
  float halo = exp(-dot(d, d) / (10.0 * rr * rr)) * 0.35;
  if (core + halo < 0.003) return vec3(0.0);

  // It rose from whatever is bright below it.
  vec2 e = (id + o - vec2(0.0, scroll)) * cellPx / u_res;
  float lod = srcLodFor(cellPx);
  float b1 = luma(textureLod(u_src, e + vec2(0.0, 0.04), lod).rgb);
  float b2 = luma(textureLod(u_src, e + vec2(0.0, 0.16), lod + 1.0).rgb);
  float b3 = luma(textureLod(u_src, e + vec2(0.0, 0.32), lod + 2.0).rgb);
  float heat = max(b1, max(b2 * 0.85, b3 * 0.65));
  float alive = smoothstep(u_threshold, u_threshold + 0.18, heat);
  float life = fract(t * (0.15 + 0.2 * h.y) + hz);
  alive *= smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.5, 1.0, life));
  float glow = alive * (0.65 + 0.35 * sin(t * (8.0 + 12.0 * h.y) + hz * 40.0)) * (0.5 + 0.8 * h.x);
  vec3 c = mix(u_cool, u_hot, clamp(core * glow * 1.4, 0.0, 1.0));
  return c * (core * 1.8 + halo) * glow + vec3(0.4 * core * glow * glow);
}

vec4 effect(vec2 uv) {
  float k = length(u_res) / 2203.0;
  float t = u_time * u_speed;
  float asp = u_res.x / u_res.y;
  vec2 px = uv * u_res;
  vec4 s = src(uv);

  // Heat shimmer, rising, strongest above bright areas.
  vec2 nq = vec2(uv.x * asp, uv.y) * 9.0 + vec2(0.0, t * 1.6);
  vec2 sh = vec2(vnoise(nq), vnoise(nq + 19.7)) - 0.5;
  float hot = luma(textureLod(u_src, uv + vec2(0.0, 0.06), srcLodFor(0.06 * u_res.y)).rgb);
  sh *= u_shimmer * 0.014 * smoothstep(0.1, 0.8, hot);
  vec3 img = src(uv + sh).rgb;

  // The dark warm veil; bright parts smoulder like coals.
  vec3 tintV = mix(vec3(0.9, 0.46, 0.24), u_cool, 0.5);
  vec3 warm = img * tintV * 0.36 + tintV * vec3(0.03, 0.012, 0.006);
  vec3 col = mix(img, warm, u_veil);
  float coal = luma(textureLod(u_src, uv + sh, srcLodFor(0.025 * u_res.y)).rgb);
  col += u_cool * pow(coal, 3.0) * 0.28 * u_veil;
  vec2 vd = (uv - 0.5) * vec2(asp, 1.0);
  col *= 1.0 - u_veil * 0.7 * smoothstep(0.3, 1.0, length(vd));

  // Embers at three depths.
  float cell = u_res.x / u_embers;
  float r = max(0.8, u_size * k);
  vec3 em = emberLayer(px, cell, 0.1, t, 0.0, r);
  em += emberLayer(px, cell * 1.8, 0.07, t, 1.0, r * 1.5) * 0.8;
  em += emberLayer(px, cell * 0.6, 0.14, t, 2.0, r * 0.7);

  // Trails: whatever glowed here last frame above the veil, fading.
  vec3 prev = texture(u_prev, uv).rgb;
  vec3 trail = max(prev - col - 0.02, 0.0) * mix(0.55, 0.96, u_trails);
  return vec4(col + max(em, trail), s.a);
}
`,
};

const holo: EffectDef = {
  id: 'holo',
  name: 'Holo',
  category: 'experimental',
  pick: true,
  description:
    'Holographic foil: an iridescent rainbow that shifts with the picture’s relief, with glints and fine lines.',
  params: [
    { type: 'range', key: 'foil', label: 'Foil', min: 0, max: 1, default: 0.8 },
    { type: 'range', key: 'scale', label: 'Rainbow', min: 0.3, max: 8, default: 2.2, unit: '×' },
    {
      type: 'select',
      key: 'pattern',
      label: 'Pattern',
      options: [
        { value: 0, label: 'Sweep' },
        { value: 1, label: 'Radial' },
        { value: 2, label: 'Shards' },
      ],
      default: 0,
    },
    { type: 'range', key: 'relief', label: 'Relief', min: 0, max: 3, default: 1.2 },
    { type: 'range', key: 'lines', label: 'Diffraction lines', min: 0, max: 1, default: 0.4, group: 'Surface' },
    { type: 'range', key: 'sparkle', label: 'Sparkle', min: 0, max: 1, default: 0.6, group: 'Surface' },
    { type: 'range', key: 'vivid', label: 'Vividness', min: 0, max: 1, default: 0.75, group: 'Surface' },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 35, unit: '°', group: 'Light' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Light' },
  ],
  presets: [
    { name: 'Foil card', values: {} },
    { name: 'Pastel sticker', values: { vivid: 0.35, foil: 0.6, scale: 1.4, sparkle: 0.8 } },
    { name: 'Shattered', values: { pattern: 2, scale: 1.2, relief: 0.8 } },
    { name: 'Radial', values: { pattern: 1, scale: 3.5, lines: 0.6 } },
    { name: 'Oil slick', values: { foil: 1, vivid: 1, scale: 5, relief: 2.5, sparkle: 0.2, lines: 0.1 } },
    { name: 'Subtle sheen', values: { foil: 0.4, sparkle: 0.35, lines: 0.2, scale: 1.2 } },
  ],
  glsl: /* glsl */ `
// Voronoi facets: a random value per facet, and the distance to its edge.
vec2 shard(vec2 p, out float edge) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0;
  vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      float d = length(g + hash22(ip + g + u_seed * 17.0) - fp);
      if (d < d1) { d2 = d1; d1 = d; best = ip + g; }
      else if (d < d2) d2 = d;
    }
  }
  edge = d2 - d1;
  return hash22(best * 1.7 + 3.1);
}

// Twinkling four-point glints, one candidate per cell.
float glints(vec2 px, float cellPx, float t, float salt) {
  vec2 id = floor(px / cellPx);
  vec3 h = hash32(id + salt + u_seed * 53.0);
  vec2 o = (0.3 + 0.4 * h.xy) * cellPx;
  vec2 d = px - id * cellPx - o;
  vec2 c = (id * cellPx + o) / u_res;
  float l = luma(textureLod(u_src, c, srcLodFor(cellPx * 0.5)).rgb);
  if (h.z > 0.25 + 0.6 * l) return 0.0;
  float tw = pow(max(0.0, sin(t * (1.4 + 2.2 * h.z) + h.x * TAU)), 10.0);
  float rad = cellPx * 0.42;
  float th = max(0.6, rad * 0.035);
  float core = exp(-dot(d, d) / max(rad * rad * 0.012, 0.5));
  float sx = max(0.0, 1.0 - abs(d.x) / rad) * exp(-abs(d.y) / th);
  float sy = max(0.0, 1.0 - abs(d.y) / rad) * exp(-abs(d.x) / th);
  return (core + (sx * sx + sy * sy) * 0.9) * tw;
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float t = u_time * u_speed;
  float asp = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0);
  vec2 px = uv * u_res;

  // Fake normals from the picture's brightness.
  float r = 0.008 * u_res.y;
  float lod = srcLodFor(r * 0.6);
  vec2 ex = vec2(r / u_res.x, 0.0), ey = vec2(0.0, r / u_res.y);
  float gx = luma(textureLod(u_src, uv + ex, lod).rgb) - luma(textureLod(u_src, uv - ex, lod).rgb);
  float gy = luma(textureLod(u_src, uv + ey, lod).rgb) - luma(textureLod(u_src, uv - ey, lod).rgb);
  vec2 nrm = vec2(gx, gy) * u_relief;
  float l = luma(s.rgb);

  float ang = radians(u_angle);
  vec2 dir = vec2(cos(ang), sin(ang));
  int pat = int(u_pattern + 0.5);
  float base = dot(p, dir);
  float seam = 1.0;
  if (pat == 1) base = length(p - 0.12 * vec2(sin(t * 0.3), cos(t * 0.4))) * 1.4;
  else if (pat == 2) {
    vec2 rnd = shard(p * 7.0, seam);
    base = dot(p, dir) * 0.4 + rnd.x * 1.1 + dot(p, rnd - 0.5) * 1.5;
    nrm += (rnd - 0.5) * 0.5;
  }

  // The card tilts slowly; the colour follows position, relief and brightness.
  vec2 tilt = vec2(sin(t * 0.7), cos(t * 0.53)) * 0.35;
  float phase = base * u_scale + dot(nrm, vec2(1.3, 0.9)) * 3.0 + dot(p, tilt) * 1.2 + l * 0.35 + t * 0.12;
  float pitch = max(1.5, 3.0 * k);
  float grating = sin(dot(px, vec2(-dir.y, dir.x)) * TAU / pitch);
  phase += grating * 0.035 * u_lines;
  vec3 rb = 0.5 + 0.5 * cos(TAU * (phase + vec3(0.0, 0.33, 0.67)));
  rb = mix(vec3(dot(rb, vec3(0.333))), rb, u_vivid);

  // Metallic base: the picture embossed, lit by a moving highlight.
  vec3 N = normalize(vec3(-nrm * 4.0, 1.0));
  vec3 H = normalize(vec3(tilt - p * 0.6, 1.0) + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 40.0);
  vec3 foil = vec3(0.35 + 0.65 * l) * (0.45 + 0.85 * rb) + spec * 0.6;
  foil *= 1.0 - 0.08 * u_lines * (0.5 + 0.5 * grating);
  if (pat == 2) foil *= 0.85 + 0.15 * smoothstep(0.0, 0.06, seam);
  foil = mix(foil, foil * (0.6 + 0.8 * s.rgb), 0.3);
  vec3 col = mix(s.rgb, foil, u_foil);

  float cell = u_res.y / 16.0;
  float g = glints(px, cell, t, 0.0) + 0.6 * glints(px, cell * 0.55, t * 1.3, 71.0);
  col += vec3(1.0, 0.98, 0.94) * g * u_sparkle;
  return vec4(col, s.a);
}
`,
};

const particleBrush: EffectDef = {
  id: 'particle-brush',
  name: 'Particle Brush',
  category: 'experimental',
  description: 'The picture repainted from short oriented brush strokes that follow its contours, on paper.',
  params: [
    { type: 'range', key: 'cells', label: 'Strokes', min: 16, max: 180, step: 1, default: 64 },
    { type: 'range', key: 'length', label: 'Stroke length', min: 0.5, max: 2.5, default: 1.6, unit: '×' },
    { type: 'range', key: 'width', label: 'Stroke width', min: 0.15, max: 1, default: 0.8, unit: '×' },
    { type: 'range', key: 'coverage', label: 'Coverage', min: 0.2, max: 1, default: 0.9 },
    {
      type: 'select',
      key: 'flow',
      label: 'Direction',
      options: [
        { value: 0, label: 'Along contours' },
        { value: 1, label: 'Across contours' },
        { value: 2, label: 'Hatched' },
      ],
      default: 0,
      group: 'Brush',
    },
    { type: 'range', key: 'jitter', label: 'Jitter', min: 0, max: 1, default: 0.35, group: 'Brush' },
    { type: 'range', key: 'bristle', label: 'Bristles', min: 0, max: 1, default: 0.6, group: 'Brush' },
    { type: 'range', key: 'vibrance', label: 'Vibrance', min: 0, max: 2, default: 1.2, unit: '×', group: 'Colour' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Colour' },
    { type: 'range', key: 'boil', label: 'Boil', min: 0, max: 1, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Oil sketch', values: {} },
    { name: 'Impasto', values: { cells: 40, width: 1, bristle: 1, vibrance: 1.4, coverage: 1 } },
    { name: 'Fine brush', values: { cells: 120, length: 1.8, width: 0.6, jitter: 0.2 } },
    {
      name: 'Hatching',
      values: { flow: 2, coverage: 0.9, width: 0.35, length: 2.4, vibrance: 1.1, jitter: 0.15, cells: 90 },
    },
    { name: 'Loose wash', values: { coverage: 0.55, width: 0.6, bristle: 0.9, vibrance: 0.9 } },
    { name: 'Boiling', values: { boil: 0.6, cells: 56 } },
    { name: 'Dark canvas', values: { paper: '#15120e', coverage: 0.75, vibrance: 1.5 } },
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float asp = u_res.x / u_res.y;
  vec2 px = uv * u_res;
  float cell = u_res.x / u_cells;
  vec2 cid = floor(px / cell);
  float boil = floor(u_time * 8.0 * u_boil);
  float lod = srcLodFor(cell * 0.8);
  float gd = cell * 0.5;
  int fl = int(u_flow + 0.5);

  // Colour and stroke direction of the 3×3 cells around this one.
  vec3 cols[9];
  vec2 dirs[9];
  float mags[9];
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      int n = j * 3 + i;
      vec2 cc = (cid + vec2(float(i - 1), float(j - 1)) + 0.5) * cell;
      vec3 c0 = textureLod(u_src, cc / u_res, lod).rgb;
      float l0 = luma(c0);
      float gx = luma(textureLod(u_src, (cc + vec2(gd, 0.0)) / u_res, lod).rgb) - l0;
      float gy = luma(textureLod(u_src, (cc + vec2(0.0, gd)) / u_res, lod).rgb) - l0;
      float fa = vnoise(cc / (cell * 8.0) + u_seed * 9.0) * TAU;
      vec2 field = vec2(cos(fa), sin(fa)) * 0.006;
      vec2 d = fl == 0 ? vec2(-gy, gx) : vec2(gx, gy);
      if (fl == 2) d = vec2(0.7071, -0.7071) + field * 20.0;
      cols[n] = c0;
      dirs[n] = normalize(d + field + 1e-6);
      mags[n] = length(vec2(gx, gy));
    }
  }

  // Paper with a little tooth, lightly toned by a thin underpainting.
  vec3 under = textureLod(u_src, uv, srcLodFor(cell * 3.0)).rgb;
  vec3 col = mix(u_paper, under, 0.18) * (0.95 + 0.05 * vnoise(px / max(1.0, 1.6 * k)) + 0.05 * (fbm(vec2(uv.x * asp, uv.y) * 6.0) - 0.5));

  // Three passes: broad strokes, then smaller ones, then detail where the picture has edges.
  for (int ps = 0; ps < 3; ps++) {
    float fp = float(ps);
    float scale = 1.0 - 0.24 * fp;
    for (int n = 0; n < 9; n++) {
      if (ps == 2 && mags[n] < 0.025) continue;
      vec2 id = cid + vec2(float(n - (n / 3) * 3 - 1), float(n / 3 - 1));
      vec3 h = hash32(id + fp * 17.31 + boil * 3.17 + u_seed * 41.0);
      if (hash12(id * 1.37 + fp * 5.1 + boil * 0.71) > u_coverage) continue;
      vec2 dir = rot((h.z - 0.5) * u_jitter * 1.4) * dirs[n];
      vec2 center = (id + 0.5 + (h.xy - 0.5) * 0.6) * cell;
      float wid = cell * u_width * scale * (0.8 + 0.25 * h.y);
      // Strokes stay within reach of the 3×3 cells this pixel looks at.
      float hl = min(0.5 * cell * u_length * scale * (0.75 + 0.5 * h.x), cell * 1.2 - wid * 0.5);
      vec2 d = px - center;
      float a = dot(d, dir);
      float b = dot(d, vec2(-dir.y, dir.x));
      if (abs(a) > hl + wid || abs(b) > wid) continue;
      float u = clamp(a / hl, -1.0, 1.0);
      float rad = wid * 0.5 * (1.0 - 0.4 * (u * 0.5 + 0.5));
      float bristle = vnoise(vec2(b / wid * 7.0 + h.z * 40.0, a / (hl * 2.0) * 1.5));
      float dist = length(vec2(max(abs(a) - hl, 0.0), b)) - rad;
      dist += (bristle - 0.5) * wid * 0.4 * u_bristle;
      float cov = fill(dist, 1.0);
      cov *= 1.0 - u_bristle * smoothstep(0.35, 1.0, u) * step(bristle, 0.42);
      vec3 sc = saturation(cols[n] * (0.86 + 0.28 * h.z), u_vibrance);
      sc *= 1.0 + (bristle - 0.5) * 0.3 * u_bristle - 0.12 * (b * b) / max(rad * rad, 1e-3);
      col = mix(col, sc, cov);
    }
  }
  return vec4(col, s.a);
}
`,
};

const rainReveal: EffectDef = {
  id: 'rain-reveal',
  name: 'Rain Reveal',
  category: 'experimental',
  description: 'Rain on a window: a fogged, dim picture behind glass, cleared by drops that refract it sharp.',
  params: [
    { type: 'range', key: 'rain', label: 'Rain', min: 0, max: 1, default: 0.75 },
    { type: 'range', key: 'size', label: 'Drop size', min: 0.4, max: 2.5, default: 1, unit: '×' },
    { type: 'range', key: 'blur', label: 'Fog', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'dim', label: 'Dim', min: 0, max: 1, default: 0.35 },
    { type: 'range', key: 'refract', label: 'Refraction', min: 0, max: 3, default: 1, unit: '×', group: 'Glass' },
    { type: 'color', key: 'tint', label: 'Glass tint', default: '#b8c8d8', group: 'Glass' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
    { type: 'toggle', key: 'storm', label: 'Lightning', default: false, group: 'Motion' },
  ],
  presets: [
    { name: 'Window', values: {} },
    { name: 'Downpour', values: { rain: 1, size: 0.7, speed: 1.5, blur: 0.75 } },
    { name: 'Drizzle', values: { rain: 0.3, size: 0.8, blur: 0.45, dim: 0.2 } },
    { name: 'Night city', values: { dim: 0.6, tint: '#5a7ab0', blur: 0.85 } },
    { name: 'Big drops', values: { size: 1.9, refract: 1.6, rain: 0.6 } },
    { name: 'Storm', values: { storm: true, rain: 0.95, dim: 0.55, tint: '#8a9ab8' } },
    { name: 'Warm window', values: { tint: '#ffc98a', dim: 0.25, blur: 0.7 } },
  ],
  glsl: /* glsl */ `
// A water drop: a spherical cap of radius r, as (height, coverage). Height grows with r², so a drop's
// refraction scales with its size.
vec2 cap(vec2 d, float r) {
  r = max(r, 1e-4);
  float c = sqrt(max(0.0, 1.0 - dot(d, d) / (r * r)));
  return vec2(c * r * r * 2500.0, c);
}

// Condensation beads that form and evaporate, one candidate per cell.
vec2 beads(vec2 p, float t, float amount) {
  const float N = 36.0;
  vec2 id = floor(p * N);
  vec3 h = hash32(id + u_seed * 13.0);
  if (h.y > amount) return vec2(0.0);
  float life = fract(t * (0.05 + 0.07 * h.z) + h.x * 7.0);
  float fade = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.75, 1.0, life));
  float r = (0.07 + 0.16 * h.z * h.z) / N * sqrt(fade);
  vec2 c = (id + 0.5 + (h.xy - 0.5) * 0.45) / N;
  return cap(p - c, r) * step(0.01, fade);
}

// Drops running down the glass in columns, falling in stick-slip hops and leaving a wet trail and droplets.
// Returns (height, coverage, cleared trail). p: y down.
vec3 runners(vec2 p, float t, float salt) {
  const float W = 0.12;
  const float P = 1.4;
  float cx = floor(p.x / W);
  vec3 h = hash32(vec2(cx * 1.7 + salt * 31.0, salt) + u_seed * 7.0);
  float x0 = (cx + 0.35 + 0.3 * h.x) * W;
  float wig = W * 0.2 * (h.y - 0.5);
  float ph = h.x * 6.0;
  float tau = t * (0.5 + 0.8 * h.y) + h.z * 17.0;
  float fall = (floor(tau) + smoothstep(0.5, 1.0, fract(tau))) * (0.07 + 0.1 * h.z);
  float yd = mod(fall + h.x * P, P);
  float dy = mod(p.y - yd + 0.5 * P, P) - 0.5 * P;
  float R = W * (0.15 + 0.1 * h.z);
  float xd = x0 + wig * sin((p.y - dy) * 11.0 + ph);
  vec2 head = cap(vec2(p.x - xd, dy * (dy < 0.0 ? 0.7 : 1.0)), R);

  float behind = -dy;
  float L = 0.3 + 0.4 * h.y;
  float along = clamp(behind / L, 0.0, 1.0);
  float xp = x0 + wig * sin(p.y * 11.0 + ph);
  float tw = R * (0.7 - 0.4 * along);
  float trail = (1.0 - smoothstep(tw * 0.5, tw, abs(p.x - xp))) * step(0.0, behind) * (1.0 - smoothstep(0.6, 1.0, along));

  const float NB = 24.0;
  float yb = (floor(p.y * NB) + 0.5) / NB;
  vec3 hb = hash32(vec2(cx + salt * 13.0, floor(p.y * NB)) + u_seed);
  float rb = R * (0.2 + 0.3 * hb.x) * step(0.35, hb.y) * (1.0 - smoothstep(0.3, 1.2, behind / L)) * step(R, behind);
  vec2 bead = rb > 1e-4 ? cap(vec2(p.x - x0 - wig * sin(yb * 11.0 + ph) - (hb.z - 0.5) * R, p.y - yb), rb) : vec2(0.0);
  return vec3(max(head, bead), trail);
}

// Everything on the glass: (height, coverage, cleared trail).
vec3 glass(vec2 p, float t) {
  vec2 b = beads(p, t, 0.15 + 0.6 * u_rain);
  vec3 r1 = runners(p, t, 1.0) * smoothstep(0.05, 0.35, u_rain);
  vec3 r2 = runners(vec2(p.x * 1.7 + 0.31, p.y * 1.7), t * 1.2, 2.0) * smoothstep(0.4, 0.85, u_rain);
  return vec3(max(b, max(r1.xy, r2.xy)), max(r1.z, r2.z));
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float asp = u_res.x / u_res.y;
  float T = u_time * u_speed;
  float t = T * 0.35;
  vec2 p = vec2((uv.x - 0.5) * asp, uv.y) / u_size;
  vec3 g = glass(p, t);
  float e = 0.0008;
  vec2 grad = vec2(glass(p + vec2(e, 0.0), t).x - g.x, glass(p + vec2(0.0, e), t).x - g.x) / e;
  grad *= min(1.0, 120.0 / max(length(grad), 1e-4));
  // A drop is a small lens: looking through it, the picture is flipped from its other side.
  vec2 off = grad * 0.0006 * u_refract * u_size * vec2(1.0 / asp, 1.0);

  float inDrop = smoothstep(0.0, 0.25, g.y);
  float clear = max(inDrop, clamp(g.z, 0.0, 1.0) * 0.75);
  float fogPx = mix(2.0, 0.045 * u_res.y, u_blur);
  float fl = srcLodFor(fogPx);
  vec2 o = 0.5 * fogPx / u_res;
  vec2 fu = uv + off;
  vec3 fog = textureLod(u_src, fu + vec2(-o.x, -o.y), fl).rgb + textureLod(u_src, fu + vec2(o.x, -o.y), fl).rgb;
  fog += textureLod(u_src, fu + vec2(-o.x, o.y), fl).rgb + textureLod(u_src, fu + vec2(o.x, o.y), fl).rgb;
  fog *= 0.25 * (1.0 - u_dim);
  fog = mix(fog, fog * u_tint * 1.2, 0.6) + u_tint * (0.03 + 0.1 * u_blur) * (1.0 - 0.5 * u_dim);
  vec3 sharp = textureLod(u_src, fu, srcLodFor(1.0)).rgb * (1.0 - u_dim * 0.3 * (1.0 - inDrop));
  vec3 col = mix(fog, sharp, clear);

  // Dark rims, and a crescent of light on the upper left of each drop.
  float rim = smoothstep(0.0, 0.05, g.y) * (1.0 - smoothstep(0.15, 0.5, g.y));
  col *= 1.0 - 0.35 * rim;
  vec2 nd = grad / max(length(grad), 1e-4);
  float glint = pow(clamp(dot(nd, vec2(0.7071)), 0.0, 1.0), 4.0) * smoothstep(0.2, 0.5, g.y) * (1.0 - smoothstep(0.6, 0.95, g.y));
  col += vec3(0.92, 0.96, 1.0) * glint * 0.3;

  if (u_storm > 0.5) {
    // Now and then a lightning flash: a strike and a flicker.
    float ep = floor(T * 0.25);
    float lt = fract(T * 0.25) * 4.0 - hash11(ep + u_seed * 17.0) * 3.0;
    float strike = step(0.45, hash11(ep * 1.3 + 5.0)) * step(0.0, lt);
    float flash = exp(-lt * 7.0) + 0.6 * exp(-abs(lt - 0.25) * 20.0);
    col *= 1.0 + strike * flash * 1.4;
  }
  vec2 vd = uv - 0.5;
  col *= 1.0 - 0.6 * dot(vd, vd);
  return vec4(col, s.a);
}
`,
};

const stardust: EffectDef = {
  id: 'stardust',
  name: 'Stardust',
  category: 'experimental',
  pick: true,
  description: 'The picture drawn in tiny twinkling stars on a deep night sky, over a faint nebula of itself.',
  params: [
    { type: 'range', key: 'density', label: 'Stars', min: 60, max: 400, step: 1, default: 190 },
    { type: 'range', key: 'size', label: 'Star size', min: 0.3, max: 3, default: 1, unit: '×' },
    { type: 'range', key: 'twinkle', label: 'Twinkle', min: 0, max: 1, default: 0.7 },
    { type: 'range', key: 'nebula', label: 'Nebula', min: 0, max: 1, default: 0.35 },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Star colour',
      options: [
        { value: 0, label: 'Picture' },
        { value: 1, label: 'Starlight' },
        { value: 2, label: 'Gold' },
      ],
      default: 0,
      group: 'Colour',
    },
    { type: 'color', key: 'sky', label: 'Sky', default: '#060a1c', group: 'Colour' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×', group: 'Colour' },
    { type: 'range', key: 'flares', label: 'Flares', min: 0, max: 1, default: 0.5, group: 'Light' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Light' },
  ],
  presets: [
    { name: 'Night sky', values: {} },
    { name: 'Starlight', values: { colorMode: 1, nebula: 0.25 } },
    { name: 'Gold dust', values: { colorMode: 2, sky: '#0b0704', nebula: 0.2 } },
    { name: 'Galaxy', values: { nebula: 0.85, density: 260, flares: 0.7 } },
    { name: 'Constellations', values: { density: 90, size: 1.7, flares: 1, nebula: 0.15, colorMode: 1 } },
    { name: 'Fine dust', values: { density: 360, size: 0.7, flares: 0.2, twinkle: 0.4 } },
  ],
  glsl: /* glsl */ `
float tone(vec3 c) { return pow(clamp((luma(c) - 0.5) * u_contrast + 0.5, 0.0, 1.0), 1.3); }

vec3 starTint(vec3 img, float h) {
  int m = int(u_colorMode + 0.5);
  if (m == 1) return mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.96, 0.9), h);
  if (m == 2) return mix(vec3(1.0, 0.72, 0.22), vec3(1.0, 0.94, 0.72), h);
  vec3 c = saturation(img, 1.35);
  return mix(c / max(max(c.r, max(c.g, c.b)), 0.25), vec3(1.0), 0.15);
}

// The star of grid cell id (cells cellPx wide) in depth layer 0 (dust), 1 (stars) or 2 (bright, with flares).
vec3 star(vec2 id, vec2 px, float cellPx, float layer, float t) {
  vec3 h = hash32(id + layer * 91.7 + u_seed * 47.0);
  float pick = hash12(id * 1.31 + layer * 13.7 + u_seed * 7.0);
  vec2 c = (id + 0.22 + 0.56 * h.xy) * cellPx;
  vec3 img = textureLod(u_src, c / u_res, srcLodFor(cellPx)).rgb;
  float l = tone(img);
  float chance = layer < 0.5 ? 0.04 + l * 0.95 : layer < 1.5 ? l * l * 0.65 : smoothstep(0.5, 0.95, l) * 0.45;
  if (pick > chance) return vec3(0.0);

  vec2 d = px - c;
  float frac = layer < 0.5 ? 0.11 : layer < 1.5 ? 0.075 : 0.04;
  float rad = min(cellPx * frac * u_size * (0.45 + 0.8 * l), cellPx * (layer < 1.5 ? 0.1 : 0.2));
  float re = max(rad, 0.65);
  float energy = rad / re; // sub-pixel stars stay visible as single bright pixels
  float d2 = dot(d, d);
  float b = exp(-d2 / (re * re));
  if (layer > 1.5) {
    float len = cellPx * 0.9 * u_flares;
    float w = re * 0.35;
    float sx = exp(-abs(d.y) / w) * pow(max(0.0, 1.0 - abs(d.x) / max(len, 1e-3)), 2.0);
    float sy = exp(-abs(d.x) / w) * pow(max(0.0, 1.0 - abs(d.y) / max(len, 1e-3)), 2.0);
    b += (sx + sy) * 0.7 + exp(-d2 / (re * re * 16.0)) * 0.25;
  }
  float ph = sin(t * (1.2 + 3.0 * h.z) + h.z * 60.0);
  float tw = mix(1.0, 0.5 + 0.5 * ph, u_twinkle) * (1.0 + 0.8 * u_twinkle * pow(max(ph, 0.0), 16.0));
  return starTint(img, h.x) * b * energy * tw * (0.8 + 1.1 * l);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float t = u_time * u_speed;
  float asp = u_res.x / u_res.y;
  vec2 px = uv * u_res;

  // Night sky, and a faint nebula of the picture.
  vec3 col = u_sky * (0.55 + 0.7 * uv.y);
  vec3 neb = textureLod(u_src, uv, srcLodFor(0.05 * u_res.y)).rgb;
  float gas = fbm(vec2(uv.x * asp, uv.y) * 3.5 + vec2(t * 0.01, u_seed * 10.0));
  vec3 nc = saturation(neb, 1.3) * vec3(0.8, 0.8, 1.25);
  col += nc * tone(neb) * (0.25 + 1.4 * gas * gas) * u_nebula * 0.8;

  float cell = u_res.x / u_density;
  col += star(floor(px / cell), px, cell, 0.0, t);
  float c1 = cell * 2.4;
  col += star(floor(px / c1), px, c1, 1.0, t);
  float c2 = cell * 6.5;
  vec2 id2 = floor(px / c2);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) col += star(id2 + vec2(float(i), float(j)), px, c2, 2.0, t);
  }
  return vec4(col, s.a);
}
`,
};

/** HUD glyphs, in atlas order; the title's characters follow them. */
const HUD_GLYPHS = [...'0123456789', 'I', 'D', ' ', '·', '.', 'X', 'Y', ':', 'T', 'R', 'E', 'C', 'F', '%', '-'];

const brandGenerator: EffectDef = {
  id: 'brand-generator',
  name: 'Brand Generator',
  category: 'tracking',
  description: 'A tracking HUD over the picture: boxes on bright, busy regions, labels, crosshair, grid and scan line.',
  params: [
    { type: 'range', key: 'boxes', label: 'Tracking cells', min: 3, max: 16, step: 1, default: 7 },
    { type: 'range', key: 'threshold', label: 'Threshold', min: 0, max: 1, default: 0.45 },
    { type: 'color', key: 'accent', label: 'Accent', default: '#ffc53d' },
    { type: 'range', key: 'grid', label: 'Grid', min: 0, max: 1, default: 0.35, group: 'Overlay' },
    { type: 'range', key: 'scan', label: 'Scan line', min: 0, max: 1, default: 0.6, group: 'Overlay' },
    { type: 'toggle', key: 'labels', label: 'Labels', default: true, group: 'Overlay' },
    { type: 'text', key: 'title', label: 'Title', default: 'PIZZA CAM 01', maxLength: 24, group: 'Overlay' },
    { type: 'range', key: 'dim', label: 'Dim image', min: 0, max: 1, default: 0.3, group: 'Image' },
    { type: 'toggle', key: 'mono', label: 'Mono image', default: false, group: 'Image' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Tracker', values: {} },
    { name: 'Pepperoni alert', values: { accent: '#ff5a3c', dim: 0.5, mono: true, title: 'TARGET LOCK' } },
    { name: 'Basil night', values: { accent: '#7fe08f', dim: 0.55, mono: true, title: 'NIGHT OPS 03' } },
    { name: 'Surveillance', values: { accent: '#f5ecd7', dim: 0.4, boxes: 10, mono: true, title: 'CAM 02 LOBBY' } },
    { name: 'Minimal', values: { grid: 0, scan: 0, labels: false, dim: 0.1 } },
    { name: 'Dense', values: { boxes: 12, threshold: 0.3, grid: 0.2 } },
  ],
  atlas: (p) => ({
    glyphs: [...HUD_GLYPHS, ...Array.from(String(p.title ?? '')).slice(0, 24)],
    font: 'mono',
    weight: 600,
    cellAspect: 0.6,
    fill: 0.9,
  }),
  glsl: /* glsl */ `
const float G_I = 10.0;
const float G_D = 11.0;
const float G_SP = 12.0;
const float G_MID = 13.0;
const float G_DOT = 14.0;
const float G_X = 15.0;
const float G_Y = 16.0;
const float G_COLON = 17.0;
const float G_T = 18.0;
const float G_R = 19.0;
const float G_E = 20.0;
const float G_C = 21.0;
const float G_F = 22.0;
const float G_TITLE = ${HUD_GLYPHS.length}.0;

float dgt(float v, float place) { return mod(floor((v + 0.5) / pow(10.0, place)), 10.0); }

// Glyph j of a HUD string: 0 "ID 04 · 0.87", 1 "X 0.512 Y 0.448", 2 the title, 3 "T 00:01.50", 4 "REC · F 00045".
float charAt(int kind, int j, vec4 d) {
  if (kind == 0) {
    if (j == 0) return G_I;
    if (j == 1) return G_D;
    if (j == 3) return dgt(d.x, 1.0);
    if (j == 4) return dgt(d.x, 0.0);
    if (j == 6) return G_MID;
    if (j == 8) return dgt(d.y, 2.0);
    if (j == 9) return G_DOT;
    if (j == 10) return dgt(d.y, 1.0);
    if (j == 11) return dgt(d.y, 0.0);
    return G_SP;
  }
  if (kind == 1) {
    if (j == 0) return G_X;
    if (j == 8) return G_Y;
    if (j == 1 || j == 7 || j == 9) return G_SP;
    float v = j < 8 ? d.x : d.y;
    int q = j < 8 ? j - 2 : j - 10;
    if (q == 0) return dgt(v, 3.0);
    if (q == 1) return G_DOT;
    return dgt(v, float(4 - q));
  }
  if (kind == 2) return G_TITLE + float(j);
  if (kind == 3) {
    if (j == 0) return G_T;
    if (j == 2) return dgt(d.x, 1.0);
    if (j == 3) return dgt(d.x, 0.0);
    if (j == 4) return G_COLON;
    if (j == 5) return dgt(d.y, 1.0);
    if (j == 6) return dgt(d.y, 0.0);
    if (j == 7) return G_DOT;
    if (j == 8) return dgt(d.z, 1.0);
    if (j == 9) return dgt(d.z, 0.0);
    return G_SP;
  }
  if (j == 0) return G_R;
  if (j == 1) return G_E;
  if (j == 2) return G_C;
  if (j == 4) return G_MID;
  if (j == 6) return G_F;
  if (j >= 8) return dgt(d.x, float(12 - j));
  return G_SP;
}

// Box outline (faint), corner brackets and centre mark; dp from the box centre, bs its size, w the line width.
float boxMarks(vec2 dp, vec2 bs, float w) {
  float rd = abs(sdBox(dp, bs * 0.5));
  vec2 fc = bs * 0.5 - abs(dp);
  float bl = min(bs.x, bs.y) * 0.2;
  float rect = fill(rd - w * 0.5, 1.0) * 0.45;
  float corner = fill(rd - w * 1.3, 1.0) * step(fc.x, bl) * step(fc.y, bl);
  float ctr = max(fill(abs(dp.x) - w * 0.5, 1.0) * step(abs(dp.y), bl * 0.3), fill(abs(dp.y) - w * 0.5, 1.0) * step(abs(dp.x), bl * 0.3));
  return max(max(rect, corner), ctr * 0.8);
}

// Crosshair of radius R around dt = 0: gapped ring, rotating dashed ring, ticks, hairlines, centre pip.
float reticle(vec2 dt, float R, float w, float t) {
  float dl = length(dt);
  float ax = min(abs(dt.x), abs(dt.y));
  float far = max(abs(dt.x), abs(dt.y));
  float ring = fill(abs(dl - R) - w * 0.5, 1.0) * step(R * 0.3, ax);
  float dash = fill(abs(dl - R * 1.6) - w * 0.4, 1.0) * step(0.5, fract(atan(dt.y, dt.x) / TAU * 24.0 + t * 0.2)) * 0.6;
  float ticks = fill(ax - w * 0.5, 1.0) * step(R * 0.45, far) * step(far, R * 1.35);
  float hair = fill(ax - w * 0.3, 1.0) * step(R * 1.35, far) * 0.3;
  float pip = fill(dl - w * 1.2, 1.0);
  return clamp(ring + dash + ticks + hair + pip, 0.0, 1.0);
}

// Ink of a HUD string of len glyphs, h px tall, top-left at o.
float hudText(vec2 px, vec2 o, float h, float len, int kind, vec4 d) {
  vec2 q = (px - o) / vec2(h * 0.6, h);
  if (q.x < 0.0 || q.y < 0.0 || q.x >= len || q.y >= 1.0) return 0.0;
  float j = floor(q.x);
  return glyph(charAt(kind, int(j), d), vec2(q.x - j, q.y), h);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float k = length(u_res) / 2203.0;
  float t = u_time * u_speed;
  vec2 px = uv * u_res;
  float lw = max(1.0, 1.4 * k);
  vec3 acc = u_accent;
  vec3 dark = vec3(0.02, 0.018, 0.015);
  bool labels = u_labels > 0.5;

  vec3 col = s.rgb;
  if (u_mono > 0.5) col = vec3(luma(col)) * mix(vec3(1.0), acc, 0.15);
  col *= 1.0 - u_dim;

  // Thin grid, with plus marks where its lines cross.
  float gs = u_res.y / 10.0;
  vec2 gp = abs(fract(px / gs + 0.5) - 0.5) * gs;
  float gl = max(fill(gp.x - lw * 0.3, 1.0), fill(gp.y - lw * 0.3, 1.0));
  float pm = max(fill(gp.x - lw * 0.5, 1.0) * step(gp.y, gs * 0.05), fill(gp.y - lw * 0.5, 1.0) * step(gp.x, gs * 0.05));
  col = mix(col, acc, clamp(gl * 0.16 + pm * 0.7, 0.0, 1.0) * u_grid);

  // Tracking boxes: one candidate per detection cell, kept where the cell is bright or busy.
  float cols = u_boxes;
  float rows = max(1.0, floor(cols * u_res.y / u_res.x + 0.5));
  vec2 cellPx = u_res / vec2(cols, rows);
  vec2 cid = floor(px / cellPx);
  vec2 c0 = cid * cellPx;
  vec2 cc = (c0 + cellPx * 0.5) / u_res;
  float mean = luma(textureLod(u_src, cc, srcLodFor(cellPx.x * 0.6)).rgb);
  vec2 qo = cellPx * 0.22 / u_res;
  float lf = srcLodFor(cellPx.x * 0.12);
  float det = abs(luma(textureLod(u_src, cc + vec2(-qo.x, -qo.y), lf).rgb) - mean);
  det += abs(luma(textureLod(u_src, cc + vec2(qo.x, -qo.y), lf).rgb) - mean);
  det += abs(luma(textureLod(u_src, cc + vec2(-qo.x, qo.y), lf).rgb) - mean);
  det += abs(luma(textureLod(u_src, cc + vec2(qo.x, qo.y), lf).rgb) - mean);
  float score = clamp(mean * 0.75 + det * 1.2, 0.0, 0.99);
  float epoch = floor(t * 0.35 + hash12(cid + 7.0) * 4.0);
  vec3 h = hash32(cid + epoch * 13.1 + u_seed * 71.0);
  if (score > u_threshold && h.z > 0.18) {
    float tagH = min(cellPx.y * 0.08, 15.0 * k);
    vec2 bs = vec2(cellPx.x * mix(0.5, 0.85, h.x), (cellPx.y - tagH) * mix(0.5, 0.82, h.y));
    vec2 room = vec2(cellPx.x - bs.x, cellPx.y - tagH - bs.y);
    vec2 jit = vec2(vnoise(vec2(t * 1.1, cid.x * 3.1 + cid.y * 7.7)), vnoise(vec2(t * 1.1 + 17.0, cid.y * 5.3 + cid.x))) - 0.5;
    vec2 bmin = c0 + vec2(0.0, tagH) + room * clamp(0.5 + (h.yx - 0.5) * 0.7 + jit * 0.3, 0.0, 1.0);
    vec2 dp = px - (bmin + bs * 0.5);
    col = mix(col, acc, step(sdBox(dp, bs * 0.5), 0.0) * 0.07);
    col = mix(col, dark, boxMarks(dp - vec2(lw), bs, lw * 1.6) * 0.45);
    col = mix(col, acc, boxMarks(dp, bs, lw));
    if (labels) {
      // Tag on top of the box: "ID 04 · 0.87", dark on the accent.
      float th = tagH * 0.8;
      vec2 tmin = vec2(bmin.x - lw * 0.5, bmin.y - tagH);
      vec2 tq = px - tmin;
      if (tq.x >= 0.0 && tq.y >= 0.0 && tq.x < 12.0 * th * 0.6 + tagH * 0.5 && tq.y < tagH) {
        float id = mod(cid.y * cols + cid.x + 1.0, 100.0);
        float sc = floor(clamp(score + jit.x * 0.06, 0.0, 0.99) * 100.0);
        col = mix(acc, dark, hudText(px, tmin + vec2(tagH * 0.25, tagH * 0.1), th, 12.0, 0, vec4(id, sc, 0.0, 0.0)));
      }
    }
  }

  // Crosshair drifting around the middle, with a dashed outer ring and hairlines across the frame.
  vec2 tp = u_res * (0.5 + vec2(0.17 * sin(t * 0.31 + u_seed * 6.0), 0.12 * sin(t * 0.47 + 1.3)));
  vec2 dt = px - tp;
  float R = 0.07 * u_res.y;
  col = mix(col, dark, reticle(dt - vec2(lw), R, lw * 1.8, t) * 0.5);
  col = mix(col, acc, reticle(dt, R, lw * 1.2, t));

  // Scan line sweeping down, with a fading wake.
  float sy = (fract(t * 0.2) * 1.3 - 0.15) * u_res.y;
  float dy = px.y - sy;
  float wake = dy < 0.0 ? exp(dy / (0.07 * u_res.y)) * 0.16 : 0.0;
  col = mix(col, acc, (fill(abs(dy) - lw * 0.6, 1.0) * 0.85 + wake) * u_scan);

  // Frame corners.
  float m = 0.035 * u_res.y;
  float fl = 0.07 * u_res.y;
  vec2 e = min(px, u_res - px) - m;
  float frame = fill(abs(e.x) - lw, 1.0) * step(-lw, e.y) * step(e.y, fl) + fill(abs(e.y) - lw, 1.0) * step(-lw, e.x) * step(e.x, fl);
  col = mix(col, acc, clamp(frame, 0.0, 1.0));

  if (labels) {
    float th = 15.0 * k;
    float pad = th * 0.35;
    // Crosshair read-out.
    vec2 ro = tp + vec2(R * 1.0, R * 1.05);
    vec4 xy = vec4(floor(tp.x / u_res.x * 1000.0), floor(tp.y / u_res.y * 1000.0), 0.0, 0.0);
    col = mix(col, dark, hudText(px - vec2(lw), ro, th * 0.85, 15.0, 1, xy) * 0.7);
    col = mix(col, acc, hudText(px, ro, th * 0.85, 15.0, 1, xy));
    // Title plate, top left.
    vec2 o = vec2(m + fl * 0.35, m + fl * 0.3);
    float len = u_glyphCount - G_TITLE;
    vec2 pq = px - o;
    if (len > 0.5 && pq.x >= 0.0 && pq.y >= 0.0 && pq.x < len * th * 0.6 + pad * 2.0 && pq.y < th + pad * 2.0) {
      col = mix(acc, dark, hudText(px, o + vec2(pad), th, len, 2, vec4(0.0)));
    }
    // Blinking REC and the frame counter under it.
    vec2 o2 = o + vec2(0.0, th + pad * 3.0);
    float rec = fill(length(px - o2 - vec2(th * 0.4, th * 0.5)) - th * 0.3, 1.0) * step(fract(t * 0.8), 0.6);
    col = mix(col, vec3(1.0, 0.353, 0.235), rec);
    col = mix(col, acc, hudText(px, o2 + vec2(th * 1.1, th * 0.08), th * 0.85, 13.0, 4, vec4(u_frame, 0.0, 0.0, 0.0)));
    // Timecode, top right.
    float tc = max(u_time, 0.0);
    vec2 o3 = vec2(u_res.x - m - fl * 0.35 - 10.0 * th * 0.6, m + fl * 0.3 + pad);
    col = mix(col, acc, hudText(px, o3, th, 10.0, 3, vec4(floor(tc / 60.0), floor(mod(tc, 60.0)), floor(fract(tc) * 100.0), 0.0)));
  }
  return vec4(col, s.a);
}
`,
};

export const EXPERIMENTAL_EFFECTS: EffectDef[] = [
  thermal,
  emberVeil,
  holo,
  particleBrush,
  rainReveal,
  stardust,
  brandGenerator,
];
