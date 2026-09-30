import { type EffectDef } from './types';

const CLASSIC_RAMP = ' .:+*=#%@';
const DENSE_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const KATAKANA = ' ･ｰｼﾂｿﾝｱｲｳｴｵｶｷｸｹｺｻｽｾﾀﾁﾃﾄﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ';

/** Unique characters of `text`, in order. */
export function chars(text: string): string[] {
  return [...new Set(Array.from(text).filter((c) => c !== '\n' && c !== '\r' && c !== '\t'))];
}

/** Every character of `text` in order, repeats kept (for text that flows cell by cell). */
function sequence(text: string, fallback: string): string[] {
  const s = Array.from(text.replace(/[\n\r\t]+/g, ' '));
  return s.length ? s : Array.from(fallback);
}

/** Words of `text`, split on white space, in order. */
function words(text: string, fallback: string): string[] {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length ? w : fallback.split(/\s+/).filter(Boolean);
}

const FONT_OPTIONS = [
  { value: 0, label: 'Serif' },
  { value: 1, label: 'Sans' },
  { value: 2, label: 'Mono' },
] as const;

function fontOf(v: unknown): 'serif' | 'sans' | 'mono' {
  return (['serif', 'sans', 'mono'] as const)[Math.round(Number(v))] ?? 'serif';
}

/**
 * The signature look: the classic site's colour ASCII (the pizza renderer's
 * ramp, material colour ramps, rippling rows, diagonal light bands and
 * sparkle), as one fragment shader so it runs on every frame of a video.
 */
const ascii: EffectDef = {
  id: 'ascii',
  name: 'ASCII',
  category: 'type',
  pick: true,
  description: 'Colour ASCII: glyphs picked by brightness, rippling like fabric under sweeping bands of light.',
  params: [
    { type: 'range', key: 'columns', label: 'Columns', min: 20, max: 320, step: 1, default: 110 },
    { type: 'range', key: 'density', label: 'Density', min: -1, max: 1, default: 0.1 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.25, unit: '×' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Materials' },
        { value: 2, label: 'Ink' },
      ],
      default: 1,
    },
    {
      type: 'toggle',
      key: 'autoTone',
      label: 'Auto tone',
      default: true,
      hint: 'Centre the tones on the picture’s own brightness',
    },
    { type: 'text', key: 'ramp', label: 'Ramp', default: CLASSIC_RAMP, maxLength: 96, group: 'Shape' },
    { type: 'toggle', key: 'sortRamp', label: 'Sort ramp by ink', default: false, group: 'Shape' },
    { type: 'range', key: 'aspect', label: 'Glyph width', min: 0.4, max: 1, default: 0.6, group: 'Shape' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'lift', label: 'Colour lift', min: 0, max: 1, default: 0.1, group: 'Ink' },
    { type: 'range', key: 'photo', label: 'Photo behind', min: 0, max: 1, default: 0, group: 'Ink' },
    { type: 'range', key: 'wave', label: 'Wave', min: 0, max: 3, default: 1, group: 'Light' },
    { type: 'range', key: 'bands', label: 'Light bands', min: 0, max: 1.5, default: 0.8, group: 'Light' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Light' },
    { type: 'toggle', key: 'sparkle', label: 'Sparkle', default: true, group: 'Light' },
    { type: 'range', key: 'glow', label: 'Glyph glow', min: 0, max: 2, default: 1, group: 'Light' },
  ],
  presets: [
    { name: 'Pizza wave', values: {} },
    { name: 'Colour photo', values: { colorMode: 0, wave: 0, bands: 0, sparkle: false, lift: 0.2 } },
    {
      name: 'Terminal',
      values: { colorMode: 2, ink: '#7fe08f', wave: 0, bands: 0.3, glow: 1.2, columns: 140 },
    },
    {
      name: 'Ink on paper',
      values: { colorMode: 2, ink: '#1a1612', paper: '#f5ecd7', wave: 0, bands: 0, sparkle: false, glow: 0 },
    },
    { name: 'Amber phosphor', values: { colorMode: 2, ink: '#ffc53d', glow: 1.8, bands: 0.5, wave: 0.4 } },
    {
      name: 'Dense newsprint',
      values: {
        ramp: DENSE_RAMP,
        sortRamp: true,
        columns: 220,
        colorMode: 2,
        ink: '#161412',
        paper: '#ece6d8',
        wave: 0,
        bands: 0,
        sparkle: false,
        glow: 0,
      },
    },
    { name: 'Katakana rain', values: { ramp: KATAKANA, sortRamp: true, colorMode: 2, ink: '#7fe08f', aspect: 0.8 } },
    { name: 'Blocks', values: { ramp: ' ░▒▓█', columns: 90, colorMode: 0, wave: 0.5 } },
    { name: 'Binary', values: { ramp: ' 01', colorMode: 0, columns: 160, bands: 1.2 } },
    { name: 'Neon bloom', values: { colorMode: 0, glow: 2, lift: 0.5, bands: 1.2 } },
    { name: 'Blueprint', values: { colorMode: 2, ink: '#cfe4ff', paper: '#0b2a5b', wave: 0, sparkle: false } },
    { name: 'Big type', values: { columns: 48, wave: 0.6, glow: 1.2 } },
  ],
  atlas: (p) => ({ glyphs: chars(String(p.ramp || CLASSIC_RAMP)), sortByInk: !!p.sortRamp, cellAspect: 0.6 }),
  glsl: /* glsl */ `
// The pizza renderer's fabric: wave geometry follows the picture (about 42 rows tall), not the glyph size.
vec2 waveOffset(vec2 p, float t, vec2 ref, vec2 cell) {
  float lambdaX = ref.x * 34.0;
  float lambdaY = ref.y * 60.0;
  float w1 = sin(TAU * (p.x / lambdaX + p.y / lambdaY) - 0.55 * t);
  float w2 = sin(TAU * (p.x / (lambdaX * 0.6) - p.y / (lambdaY * 0.8)) + 0.8 * t + 1.7);
  float dy = cell.y * 0.55 * u_wave * (0.7 * w1 + 0.3 * w2);
  float dx = cell.x * 0.25 * u_wave * sin(TAU * p.y / (ref.y * 18.0) + 0.4 * t);
  return vec2(dx, dy);
}

// Diagonal light bands with wavy edges.
float bandAt(vec2 p, float t, vec2 ref) {
  float w1 = sin(TAU * (p.x / (ref.x * 34.0) + p.y / (ref.y * 60.0)) - 0.55 * t);
  float bu = (p.x * 0.85 + p.y * 0.55) / (ref.x * 26.0);
  float warp = 0.9 * sin(TAU * p.y / (ref.y * 22.0) + 0.35 * t) + 0.5 * w1;
  float b = 0.5 + 0.5 * sin(TAU * bu - 0.9 * t + warp);
  b = b * b * (3.0 - 2.0 * b);
  return (b - 0.5) * u_bands;
}

vec4 effect(vec2 uv) {
  float cw = u_res.x / u_columns;
  float ch = cw / u_aspect;
  vec2 cell = vec2(cw, ch);
  vec2 px = uv * u_res;
  float t = u_time * u_speed;
  vec2 ref = vec2(0.6, 1.0) * (u_res.y / 42.0);
  float mid = u_autoTone > 0.5 ? clamp(luma(textureLod(u_src, vec2(0.5), 20.0).rgb), 0.2, 0.7) : 0.5;
  int mode = int(u_colorMode + 0.5);

  // Each glyph rides the wave as a whole, carrying its own colour, like the original's sprites:
  // find the (displaced) glyph that covers this pixel among the nearby cells.
  vec2 home = floor(px / cell);
  float bestInk = 0.0;
  float bestHalo = 0.0;
  vec3 bestCol = vec3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = home + vec2(float(i), float(j));
      vec2 center = (id + 0.5) * cell;
      vec2 local = (px - center - waveOffset(center, t, ref, cell)) / cell + 0.5;
      if (local.x < 0.0 || local.y < 0.0 || local.x >= 1.0 || local.y >= 1.0) continue;
      vec4 s = srcAvg(center / u_res, cw);
      if (s.a < 0.05) continue;
      float tone = clamp((luma(s.rgb) - mid) * u_contrast + 0.5, 0.0, 1.0);
      float band = bandAt(center, t, ref);
      float spark = 0.0;
      if (u_sparkle > 0.5 && u_speed > 0.0) {
        float h = hash13(vec3(id, floor(t * 1.7 + u_seed * 13.0)));
        spark = h > 0.965 ? 0.28 : 0.0;
      }
      float level = clamp(0.62 + (tone - 0.5) * 1.2 + band * 0.9 + spark, 0.0, 1.0);
      level = floor(level * 11.0 + 0.5) / 11.0;
      vec3 col;
      if (mode == 0) col = s.rgb * (0.9 + band * 0.6 + spark);
      else if (mode == 1) col = materialRamp(saturation(s.rgb, 1.15), level);
      else col = u_ink * (0.72 + band * 0.5 + spark);
      col = mix(col, vec3(1.0), u_lift * 0.5) + u_lift * 0.1;
      float gi = rampIndex(tone + u_density * 0.5 + band * 0.35 + spark * 0.5);
      float ink = min(1.0, glyph(gi, local, ch) * 1.3);
      float halo = glyph(gi, local, ch * 0.25) * u_glow * smoothstep(0.5, 1.0, level);
      if (ink + halo * 0.5 > bestInk + bestHalo * 0.5) {
        bestInk = ink;
        bestHalo = halo;
        bestCol = col;
      }
    }
  }

  vec4 here = src(uv);
  vec3 paper = mix(u_paper, here.rgb, u_photo);
  vec3 rgb = mix(paper, bestCol, bestInk) + bestCol * bestHalo * 0.6 * (1.0 - bestInk);
  float a = here.a > 0.5 ? 1.0 : max(bestInk, bestHalo);
  return vec4(rgb, a);
}
`,
};

// ── ASCII Ghost ────────────────────────────────────────────────────────────

const GHOST_RAMP = ' .:-=+*#%@';

const asciiGhost: EffectDef = {
  id: 'ascii-ghost',
  name: 'ASCII Ghost',
  category: 'type',
  description: 'Faint, cold ASCII haunting a dimmed photo, trailed by drifting echoes of itself.',
  feedback: true,
  params: [
    { type: 'range', key: 'columns', label: 'Columns', min: 30, max: 240, step: 1, default: 84 },
    { type: 'range', key: 'ink', label: 'Glyph ink', min: 0, max: 1, default: 0.7 },
    { type: 'range', key: 'echoes', label: 'Echoes', min: 0, max: 4, step: 1, default: 3 },
    { type: 'range', key: 'drift', label: 'Drift', min: 0, max: 3, default: 1.5, unit: '×' },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×', group: 'Tone' },
    { type: 'range', key: 'dim', label: 'Photo', min: 0, max: 1, default: 0.4, group: 'Tone' },
    { type: 'range', key: 'blur', label: 'Photo blur', min: 0, max: 1, default: 0.5, group: 'Tone' },
    { type: 'color', key: 'tint', label: 'Tint', default: '#9fd8ff', group: 'Ink' },
    { type: 'range', key: 'trails', label: 'Trails', min: 0, max: 0.97, default: 0.8, group: 'Motion' },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1, group: 'Motion' },
  ],
  presets: [
    { name: 'Spectre', values: {} },
    { name: 'Ectoplasm', values: { tint: '#7fe08f', echoes: 4, drift: 1.6, dim: 0.3 } },
    { name: 'Candlelit', values: { tint: '#ffc53d', dim: 0.55, echoes: 2, drift: 0.7, blur: 0.3 } },
    { name: 'Séance', values: { trails: 0.95, drift: 2.2, speed: 1.6, dim: 0.22, echoes: 4 } },
    { name: 'Whisper', values: { ink: 0.45, echoes: 1, blur: 0.9, dim: 0.6, columns: 150 } },
    { name: 'Poltergeist', values: { tint: '#ff5a3c', speed: 2.4, drift: 2.6, columns: 64, trails: 0.9 } },
  ],
  atlas: () => ({ glyphs: chars(GHOST_RAMP), sortByInk: true, cellAspect: 0.6 }),
  glsl: /* glsl */ `
// Glyph ink, halo and tone of the ASCII layer at px.
vec3 ghostLayer(vec2 px, vec2 cellPx, float t) {
  vec2 id = floor(px / cellPx);
  vec2 p = fract(px / cellPx);
  vec2 center = (id + 0.5) * cellPx / u_res;
  float tone = clamp((luma(srcAvg(center, cellPx.x).rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float gi = rampIndex(tone);
  float flick = 0.78 + 0.22 * sin(t * 2.3 + hash12(id) * TAU);
  return vec3(glyph(gi, p, cellPx.y) * flick, glyph(gi, p, cellPx.y * 0.3), tone);
}

vec3 screenRGB(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - clamp(b, 0.0, 1.0)); }

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float cw = u_res.x / u_columns;
  vec2 cellPx = vec2(cw, cw / 0.6);
  float t = u_time * u_speed;
  vec4 s = src(uv);

  // Dimmed, cooled, softly blurred photo.
  float br = u_blur * u_res.x * 0.012;
  vec2 o = vec2(br * 0.5) / u_res;
  vec3 b = (srcAvg(uv + o, br).rgb + srcAvg(uv - o, br).rgb + srcAvg(uv + vec2(o.x, -o.y), br).rgb +
            srcAvg(uv + vec2(-o.x, o.y), br).rgb) * 0.25;
  vec3 back = mix(vec3(luma(b)), b, 0.35);
  back = mix(back, luma(back) * u_tint * 1.4, 0.55) * u_dim;

  // Echo copies of the glyph layer, drifting up and sideways, each fainter and colder.
  vec3 echo = vec3(0.0);
  for (int k = 1; k <= 4; k++) {
    float fk = float(k);
    if (fk > u_echoes + 0.01) break;
    vec2 dir = vec2(1.3 * sin(t * 0.55 + fk * 2.4 + u_seed * TAU), -0.8 - 0.5 * sin(t * 0.4 + fk * 1.3));
    vec3 e = ghostLayer(px - dir * fk * u_drift * cw, cellPx, t + fk);
    vec3 ec = u_tint * mix(vec3(1.0), vec3(0.7, 0.72, 1.35), fk * 0.25);
    echo += ec * (e.x * 0.9 + e.y * 0.5) * pow(0.62, fk) * (0.15 + e.z * e.z);
  }

  vec3 g = ghostLayer(px, cellPx, t);
  vec3 glyphCol = mix(u_tint, b * 1.6 + 0.1, 0.2) * (0.2 + 1.1 * g.z * g.z);
  vec3 rgb = screenRGB(back, echo * u_ink);
  rgb = screenRGB(rgb, glyphCol * (g.x + g.y * 0.45) * u_ink);

  // Trails rise and fade.
  if (u_trails > 0.0) {
    vec4 pv = texture(u_prev, uv + vec2(0.0, 0.0012 * (0.4 + u_speed)));
    rgb = max(rgb, pv.rgb * pv.a * u_trails);
  }
  return vec4(rgb, s.a);
}
`,
};

// ── Tag Pills ──────────────────────────────────────────────────────────────

const PILL_WORDS =
  '#tag new ok hot v2 wip beta live todo done #fff 0x1f ship bug fix api dev prod sync idle 0xff pizza #ffc53d';
/** Label atlas: five buckets of words, at most 2, 3, 4, 5 and 8 characters long, six words each. */
const PILL_LIMITS = [2, 3, 4, 5, 8];
const PILL_SLOTS = 6;

function pillLabels(text: string): string[] {
  const all = [...new Set(words(text, PILL_WORDS))];
  const len = (w: string) => Array.from(w).length;
  const out: string[] = [];
  let prev = 0;
  for (const limit of PILL_LIMITS) {
    const exact = all.filter((w) => len(w) > prev && len(w) <= limit);
    const fit = all.filter((w) => len(w) <= limit);
    const pool = exact.length >= 2 ? exact : fit.length ? fit : all.map((w) => Array.from(w).slice(0, limit).join(''));
    for (let i = 0; i < PILL_SLOTS; i++) out.push(pool[Math.floor((i * pool.length) / PILL_SLOTS) % pool.length]!);
    prev = limit;
  }
  return out;
}

const tagPills: EffectDef = {
  id: 'tag-pills',
  name: 'Tag Pills',
  category: 'type',
  description: 'The picture rebuilt from rows of rounded UI tags, each filled with its colour and a tiny label.',
  params: [
    { type: 'range', key: 'rows', label: 'Rows', min: 8, max: 90, step: 1, default: 30 },
    { type: 'range', key: 'length', label: 'Pill length', min: 1, max: 6, default: 2.8, unit: '×' },
    {
      type: 'select',
      key: 'style',
      label: 'Style',
      options: [
        { value: 0, label: 'Filled' },
        { value: 1, label: 'Outline' },
        { value: 2, label: 'Soft' },
      ],
      default: 0,
    },
    { type: 'range', key: 'tone', label: 'Size by tone', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'gap', label: 'Gap', min: 0, max: 0.6, default: 0.18, group: 'Shape' },
    { type: 'text', key: 'labels', label: 'Labels', default: PILL_WORDS, maxLength: 200, group: 'Label' },
    { type: 'range', key: 'label', label: 'Label size', min: 0, max: 1, default: 0.62, group: 'Label' },
    { type: 'range', key: 'sat', label: 'Colour boost', min: 0, max: 2, default: 1.25, unit: '×', group: 'Ink' },
    { type: 'color', key: 'bg', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Scroll', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Tag cloud', values: {} },
    { name: 'Outline chips', values: { style: 1, tone: 0.3 } },
    { name: 'Dark-mode labels', values: { style: 2, length: 3.4, bg: '#0d0b09' } },
    { name: 'Big chips', values: { rows: 14, length: 3.6, label: 0.7 } },
    { name: 'Confetti', values: { rows: 64, length: 1.6, gap: 0.3, tone: 0.9, label: 0 } },
    { name: 'Ticker', values: { speed: 1, style: 2, rows: 22 } },
    { name: 'Cream board', values: { bg: '#f5ecd7', style: 1, gap: 0.24, tone: 0.2 } },
  ],
  atlas: (p) => ({ glyphs: pillLabels(String(p.labels ?? '')), font: 'mono', cellAspect: 3 }),
  glsl: /* glsl */ `
float pillJit(float k, float row) { return (hash12(vec2(k * 1.37, row * 2.11) + u_seed * 17.0) - 0.5) * 0.7; }

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float rh = u_res.y / u_rows;
  float row = floor(px.y / rh);
  float W = rh * u_length;
  float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
  float shift = hash11(row * 7.13 + 3.1) * W * 5.0 + u_time * u_speed * rh * dir * (1.0 + hash11(row * 1.37 + 0.4));
  float x = px.x + shift;

  // Pill boundaries sit near multiples of W, jittered, so widths vary.
  float k = floor(x / W);
  float b0 = (k + pillJit(k, row)) * W;
  float b1 = (k + 1.0 + pillJit(k + 1.0, row)) * W;
  if (x < b0) {
    k -= 1.0;
    b1 = b0;
    b0 = (k + pillJit(k, row)) * W;
  } else if (x >= b1) {
    k += 1.0;
    b0 = b1;
    b1 = (k + 1.0 + pillJit(k + 1.0, row)) * W;
  }
  float pw = b1 - b0;
  vec2 cp = vec2((b0 + b1) * 0.5 - shift, (row + 0.5) * rh);
  vec4 cs = (srcAvg((cp - vec2(pw * 0.28, 0.0)) / u_res, rh) + srcAvg(cp / u_res, rh) +
             srcAvg((cp + vec2(pw * 0.28, 0.0)) / u_res, rh)) / 3.0;
  float tone = clamp((luma(cs.rgb) - 0.5) * 1.2 + 0.5, 0.0, 1.0);
  vec3 c = clamp(saturation(cs.rgb, u_sat) * mix(0.8, 1.25, tone), 0.0, 1.0);

  // The pill: shorter and slimmer where the picture is dark.
  float gap = u_gap * rh;
  float full = (rh - gap) * 0.5;
  float hh = full * mix(1.0, mix(0.35, 1.0, tone), u_tone);
  float hw = max(pw * 0.5 - gap * 0.5 - (full - hh), 0.0);
  vec2 q = px - cp;
  float d = sdRoundBox(q, vec2(hw, hh), min(hh, hw));
  float cover = fill(d, 1.0);

  int style = int(u_style + 0.5);
  vec3 pill = c;
  vec3 text = luma(c) > 0.42 ? c * 0.16 : mix(c, vec3(1.0), 0.8);
  float lx = 0.0;
  float pad = hh * 0.9;
  if (style == 1) {
    float lw = max(1.0, rh * 0.07);
    float ring = fill(abs(d + lw * 0.5) - lw * 0.5, 1.0);
    pill = mix(mix(u_bg, c, 0.1), c, ring);
    text = clamp(c * 1.15 + 0.04, 0.0, 1.0);
  } else if (style == 2) {
    pill = mix(u_bg, c, 0.3);
    text = clamp(c * 1.3 + 0.06, 0.0, 1.0);
    float roomy = step(hh * 3.4, hw * 2.0);
    float dotA = fill(length(q - vec2(-hw + hh * 0.95, 0.0)) - hh * 0.3, 1.0) * roomy;
    pill = mix(pill, text, dotA);
    lx = hh * 0.5 * roomy;
    pad += hh * roomy;
  }

  // Label: the longest word bucket that fits the pill.
  float ink = 0.0;
  float lc = hh * 2.0 * u_label * 1.2;
  if (lc > 1.0) {
    float lw = lc * 3.0;
    float nfit = (hw * 2.0 - pad) / (0.16 * lw);
    float bucket = nfit >= 5.75 ? 4.0 : nfit >= 5.0 ? 3.0 : nfit >= 4.0 ? 2.0 : nfit >= 3.0 ? 1.0 : nfit >= 2.0 ? 0.0 : -1.0;
    if (bucket >= 0.0) {
      float wi = bucket * 6.0 + floor(hash12(vec2(k * 2.3, row * 1.7) + 4.1) * 6.0);
      ink = glyph(wi, (q - vec2(lx, 0.0)) / vec2(lw, lc) + 0.5, lc);
    }
  }

  vec3 rgb = mix(u_bg, pill, cover);
  rgb = mix(rgb, text, ink * cover);
  return vec4(rgb, src(uv).a);
}
`,
};

// ── Data Hatching ──────────────────────────────────────────────────────────

const DATA_SETS = ['0123456789', '01', '0123456789ABCDEF', '0123456789.:+-=#%$@'];

const dataHatching: EffectDef = {
  id: 'data-hatching',
  name: 'Data Hatching',
  category: 'type',
  description: 'Engraver’s cross-hatching drawn in tiny streaming digits: darker areas get more, bolder lines.',
  params: [
    { type: 'range', key: 'lines', label: 'Lines', min: 20, max: 220, step: 1, default: 76 },
    { type: 'range', key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, default: 45, unit: '°' },
    { type: 'range', key: 'layers', label: 'Cross-hatch', min: 1, max: 3, step: 1, default: 3 },
    {
      type: 'select',
      key: 'data',
      label: 'Data',
      options: [
        { value: 0, label: 'Digits' },
        { value: 1, label: 'Binary' },
        { value: 2, label: 'Hex' },
        { value: 3, label: 'Mixed' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.3, unit: '×', group: 'Tone' },
    { type: 'range', key: 'bias', label: 'Darkness', min: -0.5, max: 0.5, default: 0, group: 'Tone' },
    { type: 'range', key: 'speed', label: 'Flow', min: 0, max: 3, default: 0.5, group: 'Motion' },
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
    { type: 'color', key: 'ink', label: 'Ink', default: '#1a1410', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
  ],
  presets: [
    { name: 'Ledger', values: {} },
    { name: 'Binary engraving', values: { data: 1, lines: 120 } },
    { name: 'Hex blueprint', values: { data: 2, ink: '#cfe4ff', paper: '#0b2a5b' } },
    { name: 'Terminal', values: { data: 1, ink: '#7fe08f', paper: '#000000', angle: 30 } },
    { name: 'Photo data', values: { colorMode: 1, paper: '#000000', data: 3 } },
    { name: 'Red ledger', values: { ink: '#ff5a3c', angle: 60, layers: 2 } },
    { name: 'Coarse', values: { lines: 44, data: 3, layers: 2, ink: '#000000', paper: '#ffc53d' } },
  ],
  atlas: (p) => ({
    glyphs: chars(DATA_SETS[Math.round(Number(p.data))] ?? DATA_SETS[0]!),
    sortByInk: true,
    cellAspect: 0.62,
  }),
  glsl: /* glsl */ `
// One hatch layer: rows of characters along lines at angle ang, present where the ink amount passes thr.
float hatchLayer(vec2 px, float ang, float sp, float thr, float layer, bool darkPaper) {
  mat2 R = rot(ang);
  vec2 r = R * px;
  float gh = sp * 0.7;
  float cw = gh * 0.62;
  float line = floor(r.y / sp);
  float lh = hash11(line * 3.71 + layer * 11.3 + u_seed * 5.0);
  float flow = u_time * u_speed * cw * (1.5 + 3.0 * lh) * (lh < 0.5 ? -1.0 : 1.0);
  float xr = r.x + flow;
  float ci = floor(xr / cw);
  vec2 p = vec2(fract(xr / cw), (fract(r.y / sp) - 0.5) * sp / gh + 0.5);
  vec2 cpx = transpose(R) * vec2((ci + 0.5) * cw - flow, (line + 0.5) * sp);
  float tone = clamp((luma(srcAvg(cpx / u_res, sp).rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float amt = clamp((darkPaper ? tone : 1.0 - tone) + u_bias, 0.0, 1.0);
  float k = clamp((amt - thr) / max(1.0 - thr, 0.05), 0.0, 1.0);
  if (k <= 0.0) return 0.0;
  // Bigger, heavier characters where there's more ink.
  float sc = mix(0.35, 1.0, k);
  vec2 gp = (p - 0.5) / sc + 0.5;
  vec2 cid = vec2(ci, line + layer * 997.0);
  float hsel = hash13(vec3(cid, floor(u_time * u_speed * 0.8 + hash12(cid) * 7.0)));
  float gi = floor(clamp(hsel * 0.55 + 0.45 * k, 0.0, 0.999) * u_glyphCount);
  return smoothstep(0.08, 0.6, glyph(gi, gp, gh * sc)) * smoothstep(0.0, 0.15, k);
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float sp = u_res.x / u_lines;
  int mode = int(u_colorMode + 0.5);
  bool darkPaper = mode == 1 ? luma(u_paper) < 0.5 : luma(u_paper) < luma(u_ink);
  float a = radians(u_angle);
  float ink = hatchLayer(px, a, sp, 0.06, 0.0, darkPaper);
  if (u_layers > 1.5) ink = max(ink, hatchLayer(px, a + PI * 0.5, sp, 0.52, 1.0, darkPaper));
  if (u_layers > 2.5) ink = max(ink, hatchLayer(px, a - PI * 0.25, sp, 0.8, 2.0, darkPaper));
  vec3 inkCol = mode == 1 ? clamp(saturation(srcAvg(uv, sp).rgb, 1.3) * 1.3 + 0.05, 0.0, 1.0) : u_ink;
  return vec4(mix(u_paper, inkCol, ink), src(uv).a);
}
`,
};

// ── Dither Text ────────────────────────────────────────────────────────────

const ditherText: EffectDef = {
  id: 'dither-text',
  name: 'Dither Text',
  category: 'type',
  pick: true,
  description: '1-bit ordered dithering where every dot is a letter of your text, repeated across the picture.',
  params: [
    { type: 'text', key: 'text', label: 'Text', default: 'PIZZA', maxLength: 64 },
    { type: 'range', key: 'columns', label: 'Columns', min: 20, max: 240, step: 1, default: 96 },
    {
      type: 'select',
      key: 'pattern',
      label: 'Pattern',
      options: [
        { value: 0, label: 'Bayer 4×4' },
        { value: 1, label: 'Bayer 8×8' },
        { value: 2, label: 'Noise' },
        { value: 3, label: 'Clustered dots' },
      ],
      default: 1,
    },
    {
      type: 'select',
      key: 'mode',
      label: 'Letters',
      options: [
        { value: 0, label: 'Show / hide' },
        { value: 1, label: 'Bold / faint' },
        { value: 2, label: 'Knockout' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.8, unit: '×', group: 'Tone' },
    { type: 'range', key: 'bright', label: 'Brightness', min: -0.5, max: 0.5, default: 0, group: 'Tone' },
    { type: 'range', key: 'aspect', label: 'Glyph width', min: 0.4, max: 1, default: 0.66, group: 'Shape' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#000000', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#f5ecd7', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Scroll text', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Pizza press', values: {} },
    { name: 'Cheese on black', values: { ink: '#ffc53d', paper: '#000000' } },
    { name: 'Pepperoni dots', values: { pattern: 3, ink: '#ff5a3c', columns: 110 } },
    { name: 'Bold & faint', values: { mode: 1, ink: '#7fe08f', paper: '#000000', text: 'BASIL' } },
    { name: 'Knockout', values: { mode: 2, columns: 72, text: 'SLICE' } },
    { name: 'Big letters', values: { columns: 44, text: 'HELLO', contrast: 2.2 } },
    { name: 'Static', values: { pattern: 2, text: '01', columns: 140, ink: '#f5ecd7', paper: '#000000' } },
    { name: 'Marquee', values: { speed: 1, text: 'NOW SERVING ', ink: '#ffc53d', paper: '#120d0a' } },
  ],
  atlas: (p) => ({
    glyphs: sequence(String(p.text ?? ''), 'PIZZA'),
    cellAspect: Number(p.aspect) || 0.66,
    weight: 800,
    fill: 0.96,
  }),
  glsl: /* glsl */ `
float ditherTh(vec2 id, int m) {
  if (m == 0) return bayer4(id);
  if (m == 2) return hash12(id + u_seed * 91.0);
  if (m == 3) {
    vec2 f = fract((id + 0.5) / 4.0) - 0.5;
    return clamp((length(f) - 0.17) / 0.37 + hash12(id) * 0.04, 0.0, 1.0);
  }
  return bayer8(id);
}

vec4 effect(vec2 uv) {
  float cw = u_res.x / u_columns;
  float ch = cw / u_aspect;
  Cell c = grid(uv, vec2(cw, ch));
  vec4 s = srcAvg(c.center, cw);
  float tone = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5 + u_bright, 0.0, 1.0);
  float amt = luma(u_paper) < luma(u_ink) ? tone : 1.0 - tone;
  bool on = amt > ditherTh(c.id, int(u_pattern + 0.5)) + 0.004;
  // The text flows through the grid like a paragraph.
  float idx = mod(c.id.x + c.id.y * ceil(u_columns) + floor(u_time * u_speed * 4.0), u_glyphCount);
  float g = glyph(idx, c.p, ch);
  int mode = int(u_mode + 0.5);
  float ink = on ? g : 0.0;
  if (mode == 1) ink = g * (on ? 1.0 : 0.2);
  else if (mode == 2) ink = on ? 1.0 - g : 0.0;
  return vec4(mix(u_paper, u_ink, ink), s.a);
}
`,
};

// ── Grid Glyph ─────────────────────────────────────────────────────────────

const GRID_GLYPHS = '·▫▪□■○●◇◆+×';

const gridGlyph: EffectDef = {
  id: 'grid-glyph',
  name: 'Grid Glyph',
  category: 'type',
  description: 'A ruled square grid with one geometric glyph per cell, from dot to solid block by tone.',
  params: [
    { type: 'range', key: 'cells', label: 'Cells', min: 12, max: 200, step: 1, default: 72 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.25, unit: '×' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Photo' },
        { value: 1, label: 'Ink' },
      ],
      default: 0,
    },
    { type: 'text', key: 'glyphs', label: 'Glyphs', default: GRID_GLYPHS, maxLength: 48, group: 'Shape' },
    { type: 'range', key: 'scale', label: 'Glyph size', min: 0.5, max: 1.4, default: 1, unit: '×', group: 'Shape' },
    { type: 'range', key: 'line', label: 'Line width', min: 0, max: 0.2, default: 0.06, group: 'Grid' },
    { type: 'color', key: 'lineColor', label: 'Line colour', default: '#4a4034', group: 'Grid' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'tint', label: 'Cell tint', min: 0, max: 1, default: 0.12, group: 'Ink' },
  ],
  presets: [
    { name: 'Specimen', values: {} },
    {
      name: 'Graph paper',
      values: {
        colorMode: 1,
        ink: '#1a1410',
        paper: '#f5ecd7',
        lineColor: '#9cc4c4',
        tint: 0,
        contrast: 1.9,
        cells: 60,
      },
    },
    {
      name: 'Blueprint',
      values: { colorMode: 1, ink: '#cfe4ff', paper: '#0b2a5b', lineColor: '#2f5c9e', tint: 0, contrast: 1.6 },
    },
    { name: 'Cheese', values: { colorMode: 1, ink: '#ffc53d', lineColor: '#2a2216', tint: 0.05, contrast: 1.6 } },
    { name: 'Big cells', values: { cells: 32, line: 0.07, tint: 0.3 } },
    { name: 'Circles', values: { glyphs: '·∘○◎◉●', cells: 56 } },
    { name: 'Squares', values: { glyphs: '·▫□▪■', cells: 90, line: 0.04, tint: 0.2 } },
    {
      name: 'Plus & cross',
      values: {
        glyphs: '·-+×*#',
        colorMode: 1,
        ink: '#ff5a3c',
        paper: '#f5ecd7',
        lineColor: '#e8c9b8',
        tint: 0,
        contrast: 2,
        cells: 56,
      },
    },
  ],
  atlas: (p) => ({ glyphs: chars(String(p.glyphs || GRID_GLYPHS)), sortByInk: true, font: 'mono' }),
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float cell = u_res.x / u_cells;
  Cell c = grid(uv, vec2(cell));
  vec4 s = srcAvg(c.center, cell);
  float tone = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  int mode = int(u_colorMode + 0.5);
  bool darkPaper = mode == 0 ? luma(u_paper) < 0.5 : luma(u_paper) < luma(u_ink);
  float amt = darkPaper ? tone : 1.0 - tone;
  // Denser glyphs also sit a little larger in their cell.
  float sz = u_scale * mix(0.72, 1.12, amt);
  float ink = glyph(rampIndex(amt), (c.p - 0.5) / sz + 0.5, cell * sz);
  vec3 inkCol = mode == 0 ? clamp(saturation(s.rgb, 1.25) * 1.2 + 0.03, 0.0, 1.0) : mix(u_paper, u_ink, 0.4 + 0.6 * amt);
  vec3 rgb = mix(mix(u_paper, s.rgb, u_tint), inkCol, ink);
  // Grid rules on the cell edges.
  vec2 e2 = min(c.p, 1.0 - c.p) * cell;
  float lw = u_line * cell;
  float rule = min(lw, 1.0) * fill(min(e2.x, e2.y) - max(lw, 1.0) * 0.5, 1.0);
  rgb = mix(rgb, u_lineColor, rule);
  return vec4(rgb, s.a);
}
`,
};

// ── Inscribe ───────────────────────────────────────────────────────────────

const INSCRIPTION = 'IN DOUGH WE TRUST · BAKED IN FIRE · SHARED IN SLICES · ';

const inscribe: EffectDef = {
  id: 'inscribe',
  name: 'Inscribe',
  category: 'type',
  description: 'Your text carved line after line across the picture, heavier and larger where the image is.',
  params: [
    { type: 'text', key: 'text', label: 'Text', default: INSCRIPTION, maxLength: 240 },
    { type: 'range', key: 'rows', label: 'Rows', min: 12, max: 140, step: 1, default: 56 },
    { type: 'range', key: 'weight', label: 'Weight by tone', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'size', label: 'Size by tone', min: 0, max: 1, default: 0.35 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.5, unit: '×', group: 'Tone' },
    { type: 'select', key: 'font', label: 'Font', options: FONT_OPTIONS, default: 0, group: 'Shape' },
    { type: 'range', key: 'carve', label: 'Carve', min: 0, max: 1, default: 0.55, group: 'Light' },
    { type: 'range', key: 'photo', label: 'Photo colour', min: 0, max: 1, default: 1, group: 'Ink' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#ffc53d', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#0b0906', group: 'Ink' },
  ],
  presets: [
    { name: 'Inscription', values: {} },
    { name: 'Gold leaf', values: { photo: 0.2, carve: 0.8 } },
    { name: 'Marble', values: { paper: '#e9e2d4', ink: '#2a241c', photo: 0.35, carve: 0.9, weight: 0.8 } },
    { name: 'Typewriter', values: { font: 2, carve: 0, rows: 72, photo: 0.6, ink: '#f5ecd7' } },
    { name: 'Big words', values: { rows: 22, text: 'PIZZA NAPOLETANA · ', size: 0.5 } },
    { name: 'Stone tablet', values: { paper: '#8a8378', ink: '#241f1a', photo: 0, carve: 1, rows: 40 } },
    { name: 'Neon sans', values: { font: 1, photo: 0.4, ink: '#ff5a3c', carve: 0.2, weight: 0.9 } },
  ],
  atlas: (p) => ({
    glyphs: sequence(String(p.text ?? ''), INSCRIPTION),
    font: fontOf(p.font),
    weight: 600,
    cellAspect: 0.62,
    fill: 0.86,
  }),
  glsl: /* glsl */ `
// Glyph ink dilated by r (cell units) for a bolder stroke.
float boldInk(float gi, vec2 p, float ch, vec2 r) {
  float a = glyph(gi, p, ch);
  a = max(a, glyph(gi, p + r, ch));
  a = max(a, glyph(gi, p - r, ch));
  a = max(a, glyph(gi, p + vec2(r.x, -r.y), ch));
  a = max(a, glyph(gi, p + vec2(-r.x, r.y), ch));
  return a;
}

vec4 effect(vec2 uv) {
  float ch = u_res.y / u_rows;
  float cw = ch * 0.62;
  Cell c = grid(uv, vec2(cw, ch));
  float gi = mod(c.id.x + floor(hash11(c.id.y * 0.713 + 0.3) * 997.0), u_glyphCount);
  vec4 cs = srcAvg(c.center, ch);
  float tone = clamp((luma(cs.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float amt = luma(u_paper) < 0.4 ? tone : 1.0 - tone;

  float sc = mix(1.0, mix(0.55, 1.0, amt), u_size);
  vec2 p = (c.p - 0.5) / sc + 0.5;
  float r = u_weight * amt * 0.045;
  vec2 rr = vec2(r / 0.62, r) * 0.7071;
  float cpx = ch * sc;
  float ink = boldInk(gi, p, cpx, rr);
  // Chisel light from the top left: the wall facing the light is shaded, the far wall lit.
  vec2 lo = vec2(0.05 / 0.62, 0.05);
  float shade = boldInk(gi, p - lo, cpx, rr) - boldInk(gi, p + lo, cpx, rr);

  vec3 photo = clamp(saturation(src(uv).rgb, 1.15) * 1.2 + 0.03, 0.0, 1.0);
  vec3 col = mix(u_ink, photo, u_photo) * (1.0 + u_carve * 0.65 * shade);
  vec2 px = uv * u_res;
  vec3 paper = u_paper * (0.93 + 0.12 * vnoise(px / (ch * 0.4)) * vnoise(px / (ch * 3.0) + 7.0));
  // Shallow cuts where the picture is light on the stone, deep ones where it carries ink.
  return vec4(mix(paper, col, ink * mix(0.22, 1.0, smoothstep(0.0, 0.85, amt))), cs.a);
}
`,
};

// ── Matrix Rain ────────────────────────────────────────────────────────────

const RAIN_SETS = [
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>',
  '0123456789',
  '01',
  '0123456789ABCDEF',
];

const matrixRain: EffectDef = {
  id: 'matrix-rain',
  name: 'Matrix Rain',
  category: 'type',
  description: 'Falling streams of katakana and digits with white-hot heads, the photo glowing through the rain.',
  params: [
    { type: 'range', key: 'columns', label: 'Columns', min: 20, max: 220, step: 1, default: 90 },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 1 },
    { type: 'range', key: 'tail', label: 'Trail length', min: 2, max: 40, step: 1, default: 14 },
    { type: 'range', key: 'density', label: 'Drops', min: 0.2, max: 3, default: 1, unit: '×' },
    { type: 'range', key: 'reveal', label: 'Photo reveal', min: 0, max: 1, default: 0.75 },
    {
      type: 'select',
      key: 'charset',
      label: 'Characters',
      options: [
        { value: 0, label: 'Katakana' },
        { value: 1, label: 'Digits' },
        { value: 2, label: 'Binary' },
        { value: 3, label: 'Hex' },
      ],
      default: 0,
      group: 'Shape',
    },
    { type: 'range', key: 'glow', label: 'Glow', min: 0, max: 2, default: 0.9, group: 'Light' },
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
    { type: 'color', key: 'ink', label: 'Rain', default: '#39ff6a', group: 'Ink' },
    { type: 'color', key: 'head', label: 'Heads', default: '#e6ffe9', group: 'Ink' },
  ],
  presets: [
    { name: 'Digital rain', values: {} },
    { name: 'Photo rain', values: { colorMode: 1, head: '#ffffff' } },
    { name: 'Amber', values: { ink: '#ffc53d', head: '#fff4d6' } },
    { name: 'Red pill', values: { ink: '#ff5a3c', head: '#ffe1d9', charset: 1 } },
    { name: 'Binary storm', values: { charset: 2, columns: 150, speed: 1.8, tail: 22, density: 1.6 } },
    { name: 'Slow drip', values: { speed: 0.35, density: 0.5, tail: 26, glow: 1.4 } },
    { name: 'Ghost in the code', values: { reveal: 1, density: 0.6, columns: 120 } },
  ],
  atlas: (p) => ({
    glyphs: chars(RAIN_SETS[Math.round(Number(p.charset))] ?? RAIN_SETS[0]!),
    font: 'mono',
    weight: 600,
    cellAspect: 0.72,
    fill: 0.82,
  }),
  glsl: /* glsl */ `
// Cells behind the head of drop stream j in this column (≥ tail: dark).
float rainDist(float col, float row, float rows, float t, float j) {
  float h1 = hash12(vec2(col, j * 7.0 + 1.0) + u_seed * 13.0);
  float h2 = hash12(vec2(col * 1.7, j * 3.0 + 5.0) + u_seed * 3.0);
  float v = mix(0.55, 1.45, h1) * 9.0;
  float period = floor(rows * mix(0.7, 1.5, h2) / u_density + u_tail);
  float head = floor(t * v + h2 * period * 3.0);
  return mod(head - row, period);
}

vec4 effect(vec2 uv) {
  float cw = u_res.x / u_columns;
  float ch = cw / 0.72;
  Cell c = grid(uv, vec2(cw, ch));
  float rows = u_res.y / ch;
  float t = u_time * u_speed;
  float lit = 0.0;
  float head = 0.0;
  for (int j = 0; j < 2; j++) {
    float d = rainDist(c.id.x, c.id.y, rows, t, float(j));
    lit = max(lit, d < u_tail ? pow(1.0 - d / u_tail, 1.4) : 0.0);
    head = max(head, 1.0 - step(1.0, d));
  }
  vec4 s = srcAvg(c.center, cw);
  float tone = clamp((luma(s.rgb) - 0.5) * 1.6 + 0.5, 0.0, 1.0);

  // Each cell swaps its character now and then, at its own pace.
  float hc = hash12(c.id + 0.37);
  float gi = floor(hash13(vec3(c.id, floor(t * (0.3 + 2.5 * hc) + hc * 9.0))) * u_glyphCount);
  vec2 gp = vec2(1.0 - c.p.x, c.p.y);
  float g = glyph(gi, gp, ch);
  float halo = glyph(gi, gp, ch * 0.3);

  float b = lit * mix(1.0, 0.22 + 1.2 * tone, u_reveal) + u_reveal * 0.5 * tone * sqrt(tone);
  vec3 inkCol = int(u_colorMode + 0.5) == 1 ? clamp(saturation(s.rgb, 1.4) * 1.5 + 0.05, 0.0, 1.0) : u_ink;
  vec3 col = mix(inkCol * 0.35, inkCol, smoothstep(0.0, 0.8, b)) * min(b * 1.2, 1.4);
  col = mix(col, u_head, head * mix(1.0, 0.35 + 0.65 * tone, u_reveal * 0.6));
  vec3 rgb = col * g + col * halo * u_glow * 0.45 + inkCol * 0.03 * tone * u_reveal;
  return vec4(rgb, s.a);
}
`,
};

// ── Number Field ───────────────────────────────────────────────────────────

const numberField: EffectDef = {
  id: 'number-field',
  name: 'Number Field',
  category: 'type',
  pick: true,
  description: 'A field of digits where each number is the brightness underneath, rolling like an odometer.',
  params: [
    { type: 'range', key: 'columns', label: 'Columns', min: 16, max: 200, step: 1, default: 80 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.4, unit: '×' },
    {
      type: 'select',
      key: 'motion',
      label: 'Motion',
      options: [
        { value: 0, label: 'Still' },
        { value: 1, label: 'Flicker' },
        { value: 2, label: 'Roll' },
      ],
      default: 2,
    },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Ink' },
        { value: 1, label: 'Photo' },
      ],
      default: 1,
    },
    { type: 'range', key: 'speed', label: 'Speed', min: 0, max: 3, default: 0.6, group: 'Motion' },
    { type: 'range', key: 'fade', label: 'Fade by tone', min: 0, max: 1, default: 0.85, group: 'Tone' },
    { type: 'toggle', key: 'invert', label: 'Dark = 9', default: false, group: 'Tone' },
    { type: 'range', key: 'cellFill', label: 'Cell fill', min: 0, max: 1, default: 0, group: 'Ink' },
    { type: 'color', key: 'ink', label: 'Ink', default: '#f5ecd7', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Paper', default: '#000000', group: 'Ink' },
  ],
  presets: [
    { name: 'Counting', values: {} },
    { name: 'Cream digits', values: { colorMode: 0 } },
    { name: 'Heat map', values: { cellFill: 0.9, columns: 48 } },
    { name: 'Spreadsheet', values: { colorMode: 0, ink: '#1a1410', paper: '#f5ecd7', invert: true, cellFill: 0.35 } },
    { name: 'Terminal', values: { colorMode: 0, ink: '#7fe08f', motion: 1 } },
    { name: 'Cheese counter', values: { colorMode: 0, ink: '#ffc53d', columns: 40, fade: 0.9 } },
    { name: 'Fine print', values: { columns: 170, fade: 0.9, motion: 0 } },
  ],
  atlas: () => ({ glyphs: Array.from('0123456789'), font: 'mono', cellAspect: 0.7 }),
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  float cw = u_res.x / u_columns;
  float ch = cw / 0.7;
  Cell c = grid(uv, vec2(cw, ch));
  vec4 s = srcAvg(c.center, cw);
  float tone = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float target = floor((u_invert > 0.5 ? 1.0 - tone : tone) * 9.0 + 0.5);
  float h = hash12(c.id + u_seed * 41.0);
  float t = u_time * u_speed;
  int motion = int(u_motion + 0.5);
  float f = target;
  float flash = 0.0;
  if (motion == 1) {
    float slot = floor(t * 2.5 + h * 17.0);
    if (hash13(vec3(c.id, slot)) > 0.9) {
      f = clamp(target + (hash13(vec3(c.id, slot + 0.5)) < 0.5 ? -1.0 : 1.0), 0.0, 9.0);
      flash = 1.0;
    }
  } else if (motion == 2) {
    // Now and then a counter ticks one step up or down and back.
    float ph = fract(t * 0.18 + h);
    float cyc = floor(t * 0.18 + h);
    float dir = hash13(vec3(c.id, cyc)) < 0.5 ? -1.0 : 1.0;
    float roll = hash13(vec3(c.id * 1.3, cyc + 0.5)) < 0.55 ? 1.0 : 0.0;
    float off = (smoothstep(0.0, 0.06, ph) - smoothstep(0.45, 0.51, ph)) * dir * roll;
    f = clamp(target + off, 0.0, 9.0);
    flash = 1.0 - abs(2.0 * fract(f) - 1.0);
  }
  // Odometer: the old digit slides up as the next one rolls in from below.
  float a = floor(f);
  float y = c.p.y + (f - a);
  float g = y < 1.0 ? glyph(a, vec2(c.p.x, y), ch) : glyph(min(a + 1.0, 9.0), vec2(c.p.x, y - 1.0), ch);

  float amt = luma(u_paper) < 0.5 ? tone : 1.0 - tone;
  float alpha = mix(1.0, 0.12 + 0.88 * amt, u_fade);
  int mode = int(u_colorMode + 0.5);
  vec3 col = mode == 1 ? clamp(saturation(s.rgb, 1.25) * 1.25 + 0.04, 0.0, 1.0) : u_ink;
  // Heat-map cells behind the digits.
  vec3 fillCol = mode == 1 ? s.rgb : mix(u_paper, u_ink, amt);
  float gapPx = max(1.0, cw * 0.06);
  float box = fill(sdBox((c.p - 0.5) * vec2(cw, ch), vec2(cw, ch) * 0.5 - gapPx * 0.5), 1.0) * u_cellFill;
  vec3 bg = mix(u_paper, fillCol, box);
  vec3 digitCol = mix(col, luma(fillCol) > 0.45 ? vec3(0.05) : vec3(0.97), box);
  vec3 rgb = mix(bg, digitCol, g * mix(alpha, 1.0, box)) + digitCol * flash * g * 0.3;
  return vec4(rgb, s.a);
}
`,
};

// ── Pixel Code ─────────────────────────────────────────────────────────────

const CODE_CHARS = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}()[];:.,=+-*/<>!&|"\'_#$@%^~?';
/** Keywords and operators by length (index = length). */
const CODE_TOKENS: readonly (readonly string[])[] = [
  [],
  ['{', '}', '(', ')', ';', '=', '+', '*', '<', '>', '!', '.', ',', ':', '-', '/'],
  ['fn', 'if', '=>', '0x', '{}', '()', '&&', '||', '!=', '==', '+=', 'do', 'in', 'as', '::', '->', '[]', '<='],
  ['let', 'for', 'var', 'mut', 'pub', 'use', 'nil', 'new', 'try', 'i++', '===', '();', '...', 'end', 'def', 'int'],
  ['self', 'true', 'null', 'else', 'func', 'enum', 'type', 'void', 'this', 'impl', 'case', 'from', 'loop', 'bool'],
  ['const', 'while', 'false', 'async', 'await', 'yield', 'match', 'break', 'class', 'print', 'float', 'trait'],
  ['return', 'import', 'export', 'static', 'struct', 'string', 'switch', 'typeof', 'delete', 'unsafe'],
];

const CODE_TABLES = (() => {
  const at = (c: string) => CODE_CHARS.indexOf(c);
  const flat: number[] = [];
  const start: number[] = [];
  const count: number[] = [];
  CODE_TOKENS.forEach((list, n) => {
    const fit = list.filter((w) => w.length === n);
    start.push(flat.length);
    count.push(fit.length);
    for (const w of fit) for (const c of w) flat.push(at(c));
  });
  const freq = Array.from('etaoinshrdlcumwfgypbvkjxqz').map(at);
  const arr = (name: string, v: number[]) => `const int ${name}[${v.length}] = int[${v.length}](${v.join(', ')});`;
  return [
    arr('KW', flat),
    arr('KW_START', start),
    arr('KW_COUNT', count),
    arr('FREQ', freq),
    `const int C_ZERO = ${at('0')};`,
    `const int C_X = ${at('x')};`,
    `const int C_A = ${at('a')};`,
    `const int C_LBRACE = ${at('{')};`,
    `const int C_RBRACE = ${at('}')};`,
    `const int C_LPAREN = ${at('(')};`,
    `const int C_RPAREN = ${at(')')};`,
    `const int C_SEMI = ${at(';')};`,
    `const int C_DOT = ${at('.')};`,
    `const int C_SLASH = ${at('/')};`,
    `const int C_QUOTE = ${at('"')};`,
  ].join('\n');
})();

const pixelCode: EffectDef = {
  id: 'pixel-code',
  name: 'Pixel Code',
  category: 'type',
  description: 'The picture typed out as indented source code, every character coloured by the photo.',
  params: [
    { type: 'range', key: 'columns', label: 'Columns', min: 40, max: 320, step: 1, default: 150 },
    { type: 'range', key: 'structure', label: 'Structure', min: 0, max: 1, default: 0.5 },
    { type: 'range', key: 'syntax', label: 'Syntax colour', min: 0, max: 1, default: 0.2 },
    {
      type: 'select',
      key: 'palette',
      label: 'Theme',
      options: [
        { value: 0, label: 'Pizza' },
        { value: 1, label: 'Dusk' },
        { value: 2, label: 'Phosphor' },
        { value: 3, label: 'Amber' },
      ],
      default: 0,
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.2, unit: '×', group: 'Tone' },
    { type: 'range', key: 'cut', label: 'Dark cut', min: 0, max: 0.6, default: 0.04, group: 'Tone' },
    { type: 'range', key: 'boost', label: 'Colour boost', min: 0.5, max: 2.5, default: 1.6, unit: '×', group: 'Ink' },
    { type: 'color', key: 'paper', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'toggle', key: 'numbers', label: 'Line numbers', default: false, group: 'Shape' },
    { type: 'range', key: 'speed', label: 'Scroll', min: 0, max: 3, default: 0.3, group: 'Motion' },
  ],
  presets: [
    { name: 'Source', values: {} },
    { name: 'Editor', values: { syntax: 0.85, numbers: true, paper: '#14110e', columns: 120 } },
    { name: 'Minified', values: { structure: 0, columns: 200 } },
    { name: 'Deep nesting', values: { structure: 1, columns: 120 } },
    { name: 'Dusk theme', values: { syntax: 1, palette: 1, paper: '#16121f', cut: 0 } },
    { name: 'Phosphor', values: { syntax: 1, palette: 2, numbers: true } },
    { name: 'Amber listing', values: { syntax: 1, palette: 3, columns: 110, speed: 0.8 } },
  ],
  atlas: () => ({ glyphs: Array.from(CODE_CHARS), font: 'mono', weight: 700, cellAspect: 0.6, fill: 0.85 }),
  glsl: /* glsl */ `
${CODE_TABLES}

float codeLevel(float row) {
  return clamp(floor(vnoise(vec2(row * 0.19 + 3.0, u_seed * 13.0)) * 6.0 - 1.0), 0.0, 4.0);
}

// Token boundaries along a line: near every 6th column, jittered.
float codeB(float k, float row) {
  return k < 0.5 ? 0.0 : k * 6.0 + floor(hash12(vec2(k * 1.13, row * 0.71) + u_seed * 7.0) * 5.0) - 2.0;
}

int lowerChar(float h) { return FREQ[int(clamp(pow(h, 1.5) * 26.0, 0.0, 25.0))]; }

// Atlas index of the character at column col of line row (0 = blank), and its syntax class:
// 0 keyword, 1 name, 2 number, 3 string, 4 punctuation, 5 comment.
int codeChar(float col, float row, float cols, out int cls) {
  cls = 1;
  float st = u_structure;
  float hr = hash12(vec2(row * 0.37, 5.1) + u_seed * 3.0);
  float lev = codeLevel(row);
  float indent = floor(lev * 4.0 * st);
  float j = col - indent;
  if (j < 0.0) return 0;
  if (hr < 0.04 * st) return 0;
  if (lev < codeLevel(row - 1.0) && hash12(vec2(row, 2.2)) < st) {
    cls = 4;
    if (j < 0.5) return C_RBRACE;
    if (j < 1.5 && hr > 0.6) return C_SEMI;
    return 0;
  }
  float len = floor((cols - indent) * (1.0 - st * 0.45 * hash12(vec2(row, 9.3))));
  if (j >= len) return 0;
  if (hr < 0.12 * st) {
    cls = 5;
    if (j < 1.5) return C_SLASH;
    if (j < 2.5) return 0;
    return hash12(vec2(col, row) + 0.3) < 0.17 ? 0 : lowerChar(hash12(vec2(col * 1.7, row * 0.3)));
  }
  if (j > len - 1.5) {
    cls = 4;
    return codeLevel(row + 1.0) > lev ? C_LBRACE : C_SEMI;
  }
  float k = floor(j / 6.0);
  float b0 = codeB(k, row);
  float b1 = codeB(k + 1.0, row);
  if (j < b0) {
    k -= 1.0;
    b1 = b0;
    b0 = codeB(k, row);
  } else if (j >= b1) {
    k += 1.0;
    b0 = b1;
    b1 = codeB(k + 1.0, row);
  }
  int n = int(b1 - b0) - 1;
  int pos = int(j - b0);
  if (pos >= n) return 0;
  vec3 h = hash32(vec2(k * 3.1 + 0.5, row * 1.9 + 0.25) + u_seed * 11.0);
  if (n <= 6 && (h.x < 0.36 || (k < 0.5 && h.x < 0.8))) {
    cls = n == 1 ? 4 : 0;
    int which = min(int(h.y * float(KW_COUNT[n])), KW_COUNT[n] - 1);
    return KW[KW_START[n] + which * n + pos];
  }
  float hp = hash12(vec2(j * 1.3 + k, row * 0.7 + 1.7));
  if (h.x < 0.5) {
    cls = 2;
    if (n >= 4 && h.y < 0.5) {
      if (pos == 0) return C_ZERO;
      if (pos == 1) return C_X;
      int hd = int(hp * 16.0);
      return hd < 10 ? C_ZERO + hd : C_A + hd - 10;
    }
    return C_ZERO + int(hp * 10.0);
  }
  if (h.x < 0.6 && n >= 3) {
    cls = 3;
    if (pos == 0 || pos == n - 1) return C_QUOTE;
    return lowerChar(hp);
  }
  if (n >= 4 && h.y < 0.35) {
    if (pos == n - 2) return C_LPAREN;
    if (pos == n - 1) return C_RPAREN;
  } else if (n >= 3 && h.y < 0.5) {
    if (pos == n - 1) return C_LPAREN;
  } else if (n >= 5 && h.y < 0.65 && pos == n / 2) {
    return C_DOT;
  }
  if (h.z < 0.5 && pos == 1 + int(h.z * 2.0 * float(max(n - 2, 1)))) return lowerChar(hp) + 26;
  return lowerChar(hp);
}

vec3 synColor(int cls, int pal) {
  vec3 p0[6] = vec3[6](vec3(1.0, 0.35, 0.24), vec3(0.96, 0.93, 0.84), vec3(1.0, 0.77, 0.24), vec3(0.5, 0.88, 0.56), vec3(0.79, 0.73, 0.6), vec3(0.43, 0.39, 0.35));
  vec3 p1[6] = vec3[6](vec3(1.0, 0.47, 0.78), vec3(0.97, 0.97, 0.95), vec3(0.74, 0.58, 0.98), vec3(0.95, 0.98, 0.55), vec3(0.55, 0.91, 0.99), vec3(0.38, 0.45, 0.64));
  vec3 p2[6] = vec3[6](vec3(0.71, 1.0, 0.69), vec3(0.5, 0.88, 0.56), vec3(0.31, 0.82, 0.42), vec3(0.62, 1.0, 0.69), vec3(0.23, 0.6, 0.31), vec3(0.17, 0.42, 0.22));
  vec3 p3[6] = vec3[6](vec3(1.0, 0.82, 0.48), vec3(1.0, 0.77, 0.24), vec3(1.0, 0.69, 0.13), vec3(1.0, 0.88, 0.63), vec3(0.69, 0.48, 0.1), vec3(0.42, 0.29, 0.07));
  int i = clamp(cls, 0, 5);
  if (pal == 1) return p1[i];
  if (pal == 2) return p2[i];
  if (pal == 3) return p3[i];
  return p0[i];
}

vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float cw = u_res.x / u_columns;
  float ch = cw / 0.6;
  float scroll = u_time * u_speed * 1.5;
  float rowF = px.y / ch + scroll;
  float row = floor(rowF);
  float col = floor(px.x / cw);
  vec2 p = vec2(fract(px.x / cw), fract(rowF));
  vec2 center = vec2((col + 0.5) * cw, (row + 0.5 - scroll) * ch) / u_res;
  float gutter = u_numbers > 0.5 ? 5.0 : 0.0;
  int cls = 6;
  int gi = 0;
  if (col < gutter) {
    float num = mod(row + 1.0, 10000.0);
    float pw = col < 0.5 ? 1000.0 : col < 1.5 ? 100.0 : col < 2.5 ? 10.0 : 1.0;
    if (col < 3.5 && (num >= pw || pw < 1.5)) gi = C_ZERO + int(mod(floor(num / pw), 10.0));
  } else {
    gi = codeChar(col - gutter, row, ceil(u_columns) - gutter, cls);
  }
  vec4 s = srcAvg(center, cw);
  float tone = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 pc = clamp(saturation(s.rgb, 1.2) * u_boost + 0.02, 0.0, 1.0);
  vec3 c = mix(pc, synColor(cls, int(u_palette + 0.5)) * (0.3 + 0.9 * tone), u_syntax);
  float vis = smoothstep(u_cut, u_cut + 0.35, tone);
  if (cls == 6) {
    c = mix(u_paper, vec3(0.62, 0.58, 0.52), 0.55);
    vis = 1.0;
  }
  float g = gi > 0 ? min(glyph(float(gi), p, ch) * 1.4, 1.0) : 0.0;
  return vec4(mix(u_paper, c, g * vis), src(uv).a);
}
`,
};

// ── Word Mosaic ────────────────────────────────────────────────────────────

const MOSAIC_WORDS = 'PIZZA CHEESE BASIL DOUGH CRUST SAUCE OVEN SLICE PEPPERONI TOMATO OLIVE FIRE';

const wordMosaic: EffectDef = {
  id: 'word-mosaic',
  name: 'Word Mosaic',
  category: 'type',
  description: 'Your words tiled row after row, each one coloured by the picture and bolder where it’s bright.',
  params: [
    { type: 'text', key: 'text', label: 'Words', default: MOSAIC_WORDS, maxLength: 240 },
    { type: 'range', key: 'rows', label: 'Rows', min: 8, max: 100, step: 1, default: 34 },
    { type: 'range', key: 'weight', label: 'Weight by tone', min: 0, max: 1, default: 0.6 },
    { type: 'range', key: 'fade', label: 'Fade by tone', min: 0, max: 1, default: 0.7 },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.25, unit: '×', group: 'Tone' },
    { type: 'range', key: 'tile', label: 'Tile fill', min: 0, max: 1, default: 0.18, group: 'Shape' },
    { type: 'select', key: 'font', label: 'Font', options: FONT_OPTIONS, default: 1, group: 'Shape' },
    { type: 'toggle', key: 'shuffle', label: 'Shuffle words', default: true, group: 'Shape' },
    { type: 'color', key: 'paper', label: 'Background', default: '#000000', group: 'Ink' },
    { type: 'range', key: 'speed', label: 'Drift', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Pizza words', values: {} },
    { name: 'Serif poster', values: { font: 0, tile: 0, rows: 26, weight: 0.8 } },
    { name: 'Tiles', values: { tile: 0.85, fade: 0.25, rows: 28 } },
    { name: 'Micro type', values: { rows: 70, tile: 0, fade: 0.5 } },
    { name: 'Headline', values: { rows: 12, text: 'PIZZA NIGHT', shuffle: false, weight: 0.9 } },
    { name: 'Cream paper', values: { paper: '#f5ecd7', tile: 0.1 } },
    { name: 'Drifting', values: { speed: 0.8, font: 2, rows: 40 } },
  ],
  atlas: (p) => ({
    glyphs: [...new Set(words(String(p.text ?? ''), MOSAIC_WORDS))],
    font: fontOf(p.font),
    weight: 800,
    cellAspect: 3.5,
  }),
  glsl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 px = uv * u_res;
  float rh = u_res.y / u_rows;
  float cw = rh * 3.5;
  float row = floor(px.y / rh);
  float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
  float shift = hash11(row * 3.1 + u_seed * 5.0) * cw + u_time * u_speed * rh * 2.0 * dir;
  float x = px.x + shift;
  float col = floor(x / cw);
  vec2 p = vec2(fract(x / cw), fract(px.y / rh));
  vec2 cp = vec2((col + 0.5) * cw - shift, (row + 0.5) * rh);
  vec4 s = (srcAvg((cp - vec2(cw * 0.3, 0.0)) / u_res, rh) + srcAvg(cp / u_res, rh) +
            srcAvg((cp + vec2(cw * 0.3, 0.0)) / u_res, rh)) / 3.0;
  float tone = clamp((luma(s.rgb) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  bool darkPaper = luma(u_paper) < 0.5;
  float amt = darkPaper ? tone : 1.0 - tone;

  float n = u_glyphCount;
  float wi = u_shuffle > 0.5 ? floor(hash12(vec2(col, row) + u_seed * 3.0) * n) : mod(col + row * ceil(u_res.x / cw + 1.0), n);
  // Bolder where brighter: dilate the word.
  float r = u_weight * amt * 0.05;
  vec2 o = vec2(r / 3.5, r) * 0.7071;
  float g = glyph(wi, p, rh);
  g = max(g, glyph(wi, p + o, rh));
  g = max(g, glyph(wi, p - o, rh));
  g = max(g, glyph(wi, p + vec2(o.x, -o.y), rh));
  g = max(g, glyph(wi, p + vec2(-o.x, o.y), rh));
  float alpha = mix(1.0, 0.1 + 0.9 * amt, u_fade);

  vec3 wc = clamp(saturation(s.rgb, 1.25) * 1.2 + 0.03, 0.0, 1.0);
  vec3 tileCol = darkPaper ? wc * 0.35 : mix(wc, vec3(1.0), 0.55);
  float tileA = fill(sdRoundBox((p - 0.5) * vec2(cw, rh), vec2(cw, rh) * 0.5 - rh * 0.06, rh * 0.14), 1.0) * u_tile;
  vec3 rgb = mix(mix(u_paper, tileCol, tileA), wc, g * alpha);
  return vec4(rgb, src(uv).a);
}
`,
};

export const TYPE_EFFECTS: EffectDef[] = [
  ascii,
  asciiGhost,
  tagPills,
  dataHatching,
  ditherText,
  gridGlyph,
  inscribe,
  matrixRain,
  numberField,
  pixelCode,
  wordMosaic,
];
