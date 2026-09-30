import { type EffectDef } from './types';

/**
 * Pixel & 3D: tiles, blocks, bricks, flat cel regions, quadtrees and Voronoi
 * cells. Cell sizes are counts across the layer so the structure is the same
 * in the preview and in a 4K export.
 */

/** Area average of about px × px output pixels, whatever the source texture's own size. */
const AREA_AVG = /* glsl */ `
vec4 areaAvg(vec2 uv, float px) {
  float k = float(textureSize(u_src, 0).x) / max(u_res.x, 1.0);
  return textureLod(u_src, uv, log2(max(px * k, 1.0)));
}
`;

const blockMosaic: EffectDef = {
  id: 'block-mosaic',
  name: 'Block Mosaic',
  category: 'pixel',
  description: 'Hand-laid mosaic tiles in grout, each a slightly different shade with a glazed bevel.',
  params: [
    { type: 'range', key: 'tiles', label: 'Tiles', min: 16, max: 200, step: 1, default: 64 },
    {
      type: 'select',
      key: 'shape',
      label: 'Shape',
      options: [
        { value: 0, label: 'Square' },
        { value: 1, label: 'Brick' },
        { value: 2, label: 'Hand-laid' },
        { value: 3, label: 'Penny' },
      ],
      default: 2,
    },
    { type: 'range', key: 'grout', label: 'Grout', min: 0, max: 0.4, default: 0.1 },
    { type: 'color', key: 'groutColor', label: 'Grout colour', default: '#4a443c' },
    { type: 'range', key: 'jitter', label: 'Colour jitter', min: 0, max: 1, default: 0.5, group: 'Tile' },
    {
      type: 'range',
      key: 'levels',
      label: 'Tile colours',
      hint: 'Posterise per channel; 0 keeps photo colours',
      min: 0,
      max: 8,
      step: 1,
      default: 0,
      group: 'Tile',
    },
    { type: 'range', key: 'bevel', label: 'Bevel', min: 0, max: 1, default: 0.6, group: 'Light' },
    { type: 'range', key: 'glaze', label: 'Glaze', min: 0, max: 1, default: 0.5, group: 'Light' },
  ],
  presets: [
    { name: 'Tesserae', values: {} },
    { name: 'Bathroom tiles', values: { shape: 0, groutColor: '#e9e2d3', grout: 0.1, jitter: 0.25, tiles: 48 } },
    { name: 'Subway bricks', values: { shape: 1, groutColor: '#d8d0c0', tiles: 40, glaze: 0.8 } },
    { name: 'Penny floor', values: { shape: 3, grout: 0.16, groutColor: '#1a1714', tiles: 80 } },
    { name: 'Light grout', values: { groutColor: '#d4cbb8' } },
    { name: 'Smalti', values: { levels: 4, jitter: 0.8, tiles: 90, grout: 0.18 } },
    { name: 'Chunky', values: { tiles: 26, bevel: 1, glaze: 0.8, groutColor: '#000000' } },
  ],
  glsl:
    AREA_AVG +
    /* glsl */ `
float tileSd(vec2 q, int shape, vec2 hs, float rad) {
  if (shape == 3) return length(q) - hs.x;
  return sdRoundBox(q, hs, rad);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 px = uv * u_res;
  float cs = u_res.x / u_tiles;
  int shape = int(u_shape + 0.5);
  // Brick tiles are two cells wide, every other row half a brick over.
  vec2 dim = shape == 1 ? vec2(2.0, 1.0) : vec2(1.0);
  vec2 g = px / (cs * dim);
  float shift = shape == 1 ? mod(floor(g.y), 2.0) * 0.5 : 0.0;
  g.x += shift;
  vec2 id = floor(g);
  vec2 q = (fract(g) - 0.5) * dim;
  vec2 cuv = (id + 0.5 - vec2(shift, 0.0)) * dim * cs / u_res;
  vec3 hh = hash32(id + u_seed * 17.0);

  float hs = 0.5 - u_grout * 0.5;
  vec2 hsz = dim * 0.5 - u_grout * 0.5;
  float rad = shape == 0 || shape == 1 ? 0.05 : 0.0;
  if (shape == 2) {
    // Hand-laid: each tessera cut a little differently, turned and nudged.
    float a = (hh.z - 0.5) * 0.28;
    q = rot(a) * (q - (hh.xy - 0.5) * u_grout * 0.5);
    hsz = vec2(hs) * (1.0 - 0.1 * hash22(id + 5.3)) / (cos(abs(a)) + sin(abs(a)) * 0.7);
    rad = 0.03 + 0.07 * hh.y;
  }

  vec3 col = areaAvg(cuv, cs * dim.x).rgb;
  vec3 hsv = rgb2hsv(col);
  if (u_levels > 1.5) {
    // A box of smalti: 12 hues, a few saturations and values.
    hsv.x = floor(hsv.x * 12.0 + 0.5) / 12.0;
    hsv.y = clamp(floor(hsv.y * u_levels + 0.5) / u_levels, 0.0, 1.0);
    hsv.z = clamp(floor(hsv.z * u_levels + 0.5) / u_levels, 0.08, 1.0);
  }
  hsv.x = fract(hsv.x + (hh.x - 0.5) * 0.05 * u_jitter);
  hsv.y = clamp(hsv.y * (1.0 + (hh.y - 0.5) * 0.5 * u_jitter), 0.0, 1.0);
  hsv.z = clamp(hsv.z * (1.0 + (hh.z - 0.5) * 0.45 * u_jitter), 0.0, 1.0);
  col = hsv2rgb(hsv);

  float d = tileSd(q, shape, hsz, rad);
  float e = 0.01;
  vec2 nrm = vec2(tileSd(q + vec2(e, 0.0), shape, hsz, rad) - tileSd(q - vec2(e, 0.0), shape, hsz, rad),
                  tileSd(q + vec2(0.0, e), shape, hsz, rad) - tileSd(q - vec2(0.0, e), shape, hsz, rad));
  nrm = nrm / max(length(nrm), 1e-5);
  float bw = 0.04 + 0.14 * u_bevel;
  float edge = 1.0 - smoothstep(0.0, bw, -d);
  float lit = dot(nrm, normalize(vec2(-1.0, -1.25)));
  vec3 tile = col * (1.0 + lit * edge * 0.55 * u_bevel) * (1.0 - edge * edge * 0.18 * u_bevel);
  float und = vnoise(q * 3.0 + hh.xy * 10.0);
  float spot = smoothstep(0.32, 0.0, length(q - vec2(-0.14, -0.17) + (und - 0.5) * 0.14));
  tile += u_glaze * (0.3 * spot * spot + 0.06 * (und - 0.5)) * (1.0 - edge);
  tile *= 1.0 + (vnoise(q * 9.0 + hh.zx * 20.0) - 0.5) * 0.08;

  vec3 grout = u_groutColor * (0.85 + 0.25 * vnoise(px / cs * 5.0));
  grout *= 0.6 + 0.4 * smoothstep(0.0, 0.12, d);
  float cov = fill(d * cs, 1.0);
  return vec4(mix(grout, clamp(tile, 0.0, 1.0), cov), s.a);
}
`,
};

const blockify: EffectDef = {
  id: 'blockify',
  name: 'Blockify',
  category: 'pixel',
  description: 'The image extruded into a city of 3D blocks, lit tops and shaded sides, tall where it is bright.',
  params: [
    { type: 'range', key: 'blocks', label: 'Blocks', min: 12, max: 120, step: 1, default: 44 },
    { type: 'range', key: 'height', label: 'Height', min: 0, max: 3, default: 1.8, unit: '×' },
    {
      type: 'select',
      key: 'heightMode',
      label: 'Height from',
      options: [
        { value: 0, label: 'Brightness' },
        { value: 1, label: 'Darkness' },
        { value: 2, label: 'Flat' },
        { value: 3, label: 'Random' },
      ],
      default: 0,
    },
    { type: 'range', key: 'lean', label: 'Lean', min: 0, max: 0.6, default: 0.45, group: 'Shape' },
    { type: 'range', key: 'gap', label: 'Gap', min: 0, max: 0.4, default: 0.04, group: 'Shape' },
    {
      type: 'range',
      key: 'steps',
      label: 'Height steps',
      hint: '0 = smooth',
      min: 0,
      max: 8,
      step: 1,
      default: 0,
      group: 'Shape',
    },
    { type: 'range', key: 'shade', label: 'Side shade', min: 0, max: 1, default: 0.6, group: 'Light' },
    { type: 'range', key: 'edges', label: 'Edge lines', min: 0, max: 1, default: 0.55, group: 'Light' },
    { type: 'range', key: 'speed', label: 'Wave speed', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Skyline', values: {} },
    { name: 'Deep cuts', values: { heightMode: 1, height: 2, lean: 0.3 } },
    { name: 'Cubes', values: { heightMode: 2, height: 0.6, gap: 0.12, blocks: 30 } },
    { name: 'Terraces', values: { steps: 4, blocks: 60, height: 1.6 } },
    { name: 'Random city', values: { heightMode: 3, height: 2.2, edges: 0.7, blocks: 36 } },
    { name: 'Wave', values: { heightMode: 2, height: 1.4, speed: 1.5, blocks: 48 } },
    { name: 'Fine voxels', values: { blocks: 100, height: 1, edges: 0.2 } },
  ],
  glsl:
    AREA_AVG +
    /* glsl */ `
float blockHeight(vec3 c, vec2 id) {
  int m = int(u_heightMode + 0.5);
  float h = luma(c);
  if (m == 1) h = 1.0 - h;
  else if (m == 2) h = 0.5;
  else if (m == 3) h = hash12(id + u_seed * 23.0);
  if (u_speed > 0.0) h *= 0.6 + 0.4 * sin(u_time * u_speed * 2.0 - (id.x + id.y) * 0.35);
  if (u_steps > 0.5) h = floor(h * u_steps + 0.5) / u_steps;
  return max(h * u_height, 0.02);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float cs = u_res.x / u_blocks;
  vec2 P = uv * u_res / cs;
  vec2 base = floor(P);
  float lean = u_lean;
  float gap = u_gap * 0.5;

  // A pixel shows the column whose surface is nearest the viewer along its line of sight:
  // world point (P.x - t*lean, P.y + t) at height t, so the largest t wins.
  float bestT = -1.0;
  vec3 bestC = vec3(0.0);
  float bestH = 0.0;
  vec2 bestId = base;
  int face = -1;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 id = base + vec2(-float(i), float(j));
      vec3 c = areaAvg((id + 0.5) * cs / u_res, cs).rgb;
      float h = blockHeight(c, id);
      vec2 lo = id + gap;
      vec2 hi = id + 1.0 - gap;
      float t0 = max(0.0, lo.y - P.y);
      float t1 = min(h, hi.y - P.y);
      int f = t1 >= h ? 0 : 1;
      if (lean > 1e-4) {
        t0 = max(t0, (P.x - hi.x) / lean);
        float tx = (P.x - lo.x) / lean;
        if (tx < t1) { t1 = tx; f = 2; }
      } else if (P.x < lo.x || P.x > hi.x) {
        t1 = -1.0;
      }
      if (t1 >= t0 && t1 > bestT) {
        bestT = t1;
        bestC = c;
        bestH = h;
        bestId = id;
        face = f;
      }
    }
  }

  if (face < 0) return vec4(areaAvg(uv, cs).rgb * 0.16, s.a);
  vec2 lo = bestId + gap;
  vec2 hi = bestId + 1.0 - gap;
  float ew = max(0.9, cs * 0.045);
  float lineAt = 0.0;
  vec3 col;
  if (face == 0) {
    vec2 Q = vec2(P.x - bestH * lean, P.y + bestH);
    vec2 a = (Q - lo) * cs;
    vec2 b = (hi - Q) * cs;
    float ed = min(min(a.x, b.x), min(a.y, b.y));
    float bevel = 1.0 - smoothstep(0.0, cs * 0.12, min(a.x, a.y));
    col = bestC * 1.06 + 0.03 + bevel * 0.08;
    lineAt = ed;
  } else {
    float tn = bestT / max(bestH, 1e-3);
    float top = (bestH - bestT) * cs;
    if (face == 1) {
      float xw = P.x - bestT * lean;
      col = bestC * mix(1.0, 0.64, u_shade) * mix(0.8, 1.0, tn);
      lineAt = min(top, min(xw - lo.x, hi.x - xw) * cs);
    } else {
      float yw = P.y + bestT;
      col = bestC * mix(1.0, 0.4, u_shade) * mix(0.75, 1.0, tn);
      lineAt = min(top, min(yw - lo.y, hi.y - yw) * cs);
    }
  }
  col *= 1.0 - u_edges * 0.7 * (1.0 - smoothstep(ew * 0.5, ew * 0.5 + 1.0, lineAt));
  return vec4(clamp(col, 0.0, 1.0), s.a);
}
`,
};

const toyBricks: EffectDef = {
  id: '3d-toy-bricks',
  name: '3D Toy Bricks',
  category: 'pixel',
  description: 'A toy-brick mosaic: every cell a plastic plate in a brick colour, with a shaded round stud.',
  params: [
    { type: 'range', key: 'bricks', label: 'Bricks', min: 16, max: 160, step: 1, default: 56 },
    {
      type: 'select',
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 0, label: 'Classic box' },
        { value: 1, label: 'Primary' },
        { value: 2, label: 'Greyscale' },
        { value: 3, label: 'Warm' },
        { value: 4, label: 'Photo' },
      ],
      default: 0,
    },
    {
      type: 'select',
      key: 'style',
      label: 'Piece',
      options: [
        { value: 0, label: 'Stud plate' },
        { value: 1, label: 'Flat tile' },
        { value: 2, label: 'Round plate' },
      ],
      default: 0,
    },
    { type: 'range', key: 'sat', label: 'Saturation', min: 0, max: 2, default: 1.25, unit: '×', group: 'Colour' },
    { type: 'range', key: 'bright', label: 'Brightness', min: -0.3, max: 0.3, default: 0.04, group: 'Colour' },
    { type: 'toggle', key: 'dither', label: 'Dither', default: false, group: 'Colour' },
    { type: 'range', key: 'shadow', label: 'Shadows', min: 0, max: 1, default: 0.7, group: 'Light' },
    { type: 'range', key: 'gloss', label: 'Gloss', min: 0, max: 1, default: 0.55, group: 'Light' },
  ],
  presets: [
    { name: 'Brick box', values: {} },
    { name: 'Primary colours', values: { palette: 1 } },
    { name: 'Greyscale', values: { palette: 2, dither: true, bricks: 72 } },
    { name: 'Warm dither', values: { palette: 3, dither: true, bricks: 84 } },
    { name: 'Smooth tiles', values: { style: 1, gloss: 0.8, bricks: 64 } },
    { name: 'Round plates', values: { style: 2, bricks: 48 } },
    { name: 'Big bricks', values: { bricks: 24, shadow: 1 } },
    { name: 'Photo plastic', values: { palette: 4, bricks: 80 } },
  ],
  glsl:
    AREA_AVG +
    /* glsl */ `
vec3 snapBrick(vec3 c) {
  vec3 pal[16] = vec3[16](
    vec3(0.95, 0.95, 0.93), vec3(0.63, 0.65, 0.64), vec3(0.38, 0.4, 0.41), vec3(0.11, 0.11, 0.12),
    vec3(0.79, 0.1, 0.12), vec3(0.45, 0.08, 0.1), vec3(0.98, 0.52, 0.1), vec3(0.98, 0.8, 0.06),
    vec3(0.87, 0.77, 0.56), vec3(0.37, 0.2, 0.12), vec3(0.58, 0.49, 0.33), vec3(0.3, 0.64, 0.22),
    vec3(0.12, 0.34, 0.2), vec3(0.05, 0.34, 0.7), vec3(0.06, 0.16, 0.36), vec3(0.3, 0.7, 0.87)
  );
  int p = int(u_palette + 0.5);
  int mask = 0xFFFF;
  if (p == 1) mask = (1 << 0) | (1 << 1) | (1 << 3) | (1 << 4) | (1 << 7) | (1 << 11) | (1 << 13);
  if (p == 2) mask = 15;
  if (p == 3) mask = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11);
  vec3 best = pal[0];
  float bd = 1e9;
  for (int i = 0; i < 16; i++) {
    if (((mask >> i) & 1) == 0) continue;
    vec3 d = c - pal[i];
    float rm = 0.5 * (c.r + pal[i].r);
    float dd = dot(d * d, vec3(2.0 + rm, 4.0, 3.0 - rm));
    if (dd < bd) { bd = dd; best = pal[i]; }
  }
  return best;
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float cs = u_res.x / u_bricks;
  Cell c = grid(uv, vec2(cs));
  vec3 col = saturation(areaAvg(c.center, cs).rgb, u_sat) + u_bright;
  if (u_dither > 0.5) col += (bayer4(c.id) - 0.5) * 0.14;
  col = clamp(col, 0.0, 1.0);
  if (int(u_palette + 0.5) != 4) col = snapBrick(col);

  vec2 q = c.p - 0.5;
  float aa = 1.0 / cs;
  int style = int(u_style + 0.5);
  vec2 L = normalize(vec2(-1.0, -1.1));

  // Plate with bevelled edges and a broad plastic sheen.
  float pd = style == 2 ? length(q) - 0.47 : sdRoundBox(q, vec2(0.48), 0.05);
  float bev = 1.0 - smoothstep(0.0, 0.07, -pd);
  vec2 n = style == 2 ? normalize(q + 1e-5) : (abs(q.x) > abs(q.y) ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y)));
  vec3 top = col * (1.0 + 0.45 * dot(n, L) * bev);
  top += u_gloss * 0.07 * smoothstep(0.5, -0.6, q.x + q.y);

  if (style != 1) {
    // Soft shadow of the stud, cast to the bottom right.
    float sh = length(q - vec2(0.07, 0.085)) - 0.3;
    top *= 1.0 - u_shadow * 0.5 * (1.0 - smoothstep(-0.05, 0.07, sh));
    // Stud: darker cylinder wall, lighter top disc nudged towards the light.
    float wall = length(q - vec2(0.012, 0.016)) - 0.3;
    vec2 tq = q + vec2(0.018, 0.02);
    float disc = length(tq) - 0.275;
    float rim = smoothstep(0.18, 0.275, length(tq));
    vec3 wallCol = col * (0.56 + 0.26 * dot(normalize(q + 1e-5), L));
    vec3 discCol = col * (1.04 + 0.22 * rim * dot(normalize(tq + 1e-5), L));
    float hl = smoothstep(0.13, 0.0, length(tq - vec2(-0.1, -0.1)));
    discCol += u_gloss * 0.35 * hl * hl;
    discCol += u_gloss * 0.25 * (1.0 - smoothstep(0.0, 0.035, abs(disc + 0.012))) * max(dot(normalize(tq + 1e-5), L), 0.0);
    top = mix(top, wallCol, fill(wall, aa));
    top = mix(top, discCol, fill(disc, aa));
  } else {
    // Flat tile: glossy face with a groove near the edge.
    top *= 1.0 - 0.25 * smoothstep(0.02, 0.0, abs(pd + 0.06));
    top += u_gloss * 0.22 * pow(smoothstep(0.45, 0.0, length(q - vec2(-0.16, -0.18))), 2.0);
  }

  vec3 gapCol = style == 2 ? vec3(0.1, 0.1, 0.11) * (1.0 + 0.3 * col) : col * 0.3;
  return vec4(mix(gapCol, clamp(top, 0.0, 1.0), fill(pd, aa)), s.a);
}
`,
};

const outline: EffectDef = {
  id: 'outline',
  name: 'Outline',
  category: 'pixel',
  description: 'Flat posterised colour regions with bold dark outlines, like a sticker or a cel.',
  params: [
    { type: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1, default: 4 },
    { type: 'range', key: 'width', label: 'Line width', min: 0.5, max: 12, step: 0.5, default: 3, unit: 'px' },
    {
      type: 'select',
      key: 'colorMode',
      label: 'Colour',
      options: [
        { value: 0, label: 'Posterise' },
        { value: 1, label: 'Cel shade' },
        { value: 2, label: 'Pop' },
        { value: 3, label: 'Photo' },
      ],
      default: 0,
    },
    { type: 'color', key: 'lineColor', label: 'Line colour', default: '#0d0b09' },
    {
      type: 'range',
      key: 'smooth',
      label: 'Simplify',
      hint: 'Blur before posterising: fewer, rounder regions',
      min: 0,
      max: 1,
      default: 0.35,
      group: 'Shape',
    },
    { type: 'range', key: 'contrast', label: 'Contrast', min: 0.3, max: 3, default: 1.15, unit: '×', group: 'Tone' },
    { type: 'range', key: 'sat', label: 'Saturation', min: 0, max: 2, default: 1.3, unit: '×', group: 'Tone' },
  ],
  presets: [
    { name: 'Sticker', values: {} },
    { name: 'Cel shade', values: { colorMode: 1, levels: 3, width: 2.5 } },
    { name: 'Pop art', values: { colorMode: 2, levels: 4, width: 4 } },
    { name: 'Comic ink', values: { colorMode: 3, levels: 5, width: 2, smooth: 0.2 } },
    { name: 'Chunky', values: { levels: 3, width: 7, smooth: 0.7 } },
    { name: 'Neon', values: { colorMode: 1, lineColor: '#7fe08f', levels: 3, contrast: 1.4 } },
    { name: 'Gold contours', values: { colorMode: 3, levels: 7, width: 1.5, lineColor: '#ffc53d', smooth: 0.25 } },
    { name: 'Stencil', values: { colorMode: 2, levels: 2, width: 2 } },
  ],
  glsl: /* glsl */ `
vec3 prep(vec2 uv, float lod) {
  vec3 c = srcLod(uv, lod).rgb;
  return clamp(saturation(contrast(c, u_contrast), u_sat), 0.0, 1.0);
}

vec3 toYcc(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(-0.168736, -0.331264, 0.5)), dot(c, vec3(0.5, -0.418688, -0.081312)));
}

vec3 fromYcc(vec3 y) {
  return vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y);
}

// The quantity being posterised: its integer crossings are the region boundaries.
// Posterise works in luma + chroma so browns stay brown; the others band one tone.
vec3 field(vec3 c, int mode) {
  float n = u_levels;
  vec3 f;
  if (mode == 0) {
    vec3 y = toYcc(c);
    f = vec3(y.x * n, y.yz * n / 0.4 + 0.5);
  } else if (mode == 1) {
    f = vec3(rgb2hsv(c).z * n, 0.5, 0.5);
  } else {
    f = vec3(luma(c) * n, 0.5, 0.5);
  }
  f += 0.0137;
  f.x = clamp(f.x, 0.03, n - 0.03);
  return f;
}

vec3 popRamp(float t) {
  vec3 a = vec3(0.1, 0.06, 0.05), b = vec3(1.0, 0.353, 0.235), c = vec3(1.0, 0.773, 0.239), d = vec3(0.961, 0.925, 0.843);
  if (t < 1.0 / 3.0) return mix(a, b, t * 3.0);
  if (t < 2.0 / 3.0) return mix(b, c, t * 3.0 - 1.0);
  return mix(c, d, t * 3.0 - 2.0);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  int mode = int(u_colorMode + 0.5);
  float k = float(textureSize(u_src, 0).x) / max(u_res.x, 1.0);
  float lod = log2(max(1.0, u_res.x * (0.001 + u_smooth * 0.012) * k));
  float w = u_width * u_unit;
  float h = max(1.0, w * 0.5);
  vec2 dx = vec2(h / u_res.x, 0.0);
  vec2 dy = vec2(0.0, h / u_res.y);
  vec3 c0 = prep(uv, lod);
  vec3 f0 = field(c0, mode);
  vec3 gx = (field(prep(uv + dx, lod), mode) - field(prep(uv - dx, lod), mode)) / (2.0 * h);
  vec3 gy = (field(prep(uv + dy, lod), mode) - field(prep(uv - dy, lod), mode)) / (2.0 * h);
  vec3 g = max(sqrt(gx * gx + gy * gy), vec3(0.002));
  vec3 bd = (0.5 - abs(fract(f0) - 0.5)) / g;
  float dist = min(bd.x, min(bd.y, bd.z));
  float line = clamp(w * 0.5 - dist + 0.5, 0.0, 1.0);

  float n = u_levels;
  vec3 col;
  if (mode == 0) {
    vec3 q = floor(f0);
    col = clamp(fromYcc(vec3((q.x + 0.25) / (n - 0.5), (q.yz * 0.4) / n)), 0.0, 1.0);
  } else if (mode == 1) {
    vec3 hsv = rgb2hsv(c0);
    hsv.y = min(hsv.y * 1.1, 1.0);
    hsv.z = (min(floor(f0.x), n - 1.0) + 1.0) / n;
    col = hsv2rgb(hsv);
  } else if (mode == 2) {
    col = popRamp(min(floor(f0.x), n - 1.0) / (n - 1.0));
  } else {
    col = c0;
  }
  return vec4(mix(col, u_lineColor, line), s.a);
}
`,
};

const quadtreeZoom: EffectDef = {
  id: 'quadtree-zoom',
  name: 'Quadtree Zoom',
  category: 'pixel',
  description: 'An adaptive quadtree: blocks split into smaller squares wherever the image has detail.',
  params: [
    { type: 'range', key: 'depth', label: 'Levels', min: 1, max: 6, step: 1, default: 6 },
    { type: 'range', key: 'detail', label: 'Detail', min: 0, max: 1, default: 0.55 },
    {
      type: 'select',
      key: 'style',
      label: 'Fill',
      options: [
        { value: 0, label: 'Flat' },
        { value: 1, label: 'Photo' },
        { value: 2, label: 'Dots' },
        { value: 3, label: 'Tiles' },
      ],
      default: 0,
    },
    { type: 'range', key: 'base', label: 'Top blocks', min: 1, max: 12, step: 1, default: 3, group: 'Shape' },
    { type: 'range', key: 'border', label: 'Border', min: 0, max: 6, step: 0.5, default: 1, unit: 'px', group: 'Line' },
    { type: 'color', key: 'lineColor', label: 'Border colour', default: '#000000', group: 'Line' },
    { type: 'range', key: 'speed', label: 'Breathe', min: 0, max: 3, default: 0, group: 'Motion' },
  ],
  presets: [
    { name: 'Quadtree', values: {} },
    { name: 'Cream lines', values: { lineColor: '#f5ecd7', border: 1.5 } },
    { name: 'Photo grid', values: { style: 1, lineColor: '#ffc53d', detail: 0.7 } },
    { name: 'Dots', values: { style: 2, detail: 0.65 } },
    { name: 'Tiles', values: { style: 3, border: 2, lineColor: '#15120e' } },
    { name: 'Breathing', values: { speed: 1, detail: 0.6 } },
    { name: 'Coarse', values: { depth: 4, detail: 0.4, border: 2 } },
  ],
  glsl:
    AREA_AVG +
    /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  vec2 px = uv * u_res;
  float size = u_res.x / u_base;
  vec2 org = floor(px / size) * size;
  float thr0 = 0.22 * pow(0.03, u_detail);
  int maxL = int(u_depth + 0.5);
  vec3 col = vec3(0.0);
  for (int L = 0; L < 7; L++) {
    float hs = size * 0.5;
    vec3 a = areaAvg((org + vec2(0.5, 0.5) * hs) / u_res, hs).rgb;
    vec3 b = areaAvg((org + vec2(1.5, 0.5) * hs) / u_res, hs).rgb;
    vec3 c = areaAvg((org + vec2(0.5, 1.5) * hs) / u_res, hs).rgb;
    vec3 d = areaAvg((org + vec2(1.5, 1.5) * hs) / u_res, hs).rgb;
    vec3 m = (a + b + c + d) * 0.25;
    col = m;
    if (L >= maxL) break;
    float det = (length(a - m) + length(b - m) + length(c - m) + length(d - m)) * 0.25;
    float thr = thr0;
    if (u_speed > 0.0) thr *= exp2(1.8 * sin(u_time * u_speed + (org.x + org.y + size) / u_res.x * 4.0));
    if (det < thr) break;
    org += step(org + hs, px) * hs;
    size = hs;
  }

  vec2 lp = px - org;
  float e = min(min(lp.x, lp.y), min(size - lp.x, size - lp.y));
  float bw = u_border * u_unit;
  float line = bw > 0.0 ? clamp(bw * 0.5 - e + 0.5, 0.0, 1.0) : 0.0;
  int st = int(u_style + 0.5);
  vec3 fillCol = col;
  if (st == 1) fillCol = s.rgb;
  if (st == 2) {
    float r = length(lp - size * 0.5) - size * 0.46;
    fillCol = mix(u_lineColor, col, fill(r, 1.0));
    line = 0.0;
  }
  if (st == 3) {
    float gp = min(max(bw, 1.0), size * 0.12);
    vec2 q = lp - size * 0.5;
    float d = sdRoundBox(q, vec2(size * 0.5 - gp), size * 0.12);
    float bev = 1.0 - smoothstep(0.0, size * 0.1, -d);
    float lit = dot(normalize(q + 1e-4), normalize(vec2(-1.0, -1.0)));
    fillCol = mix(u_lineColor, col * (1.0 + 0.35 * lit * bev) + 0.06 * (1.0 - bev), fill(d, 1.0));
    line = 0.0;
  }
  return vec4(mix(fillCol, u_lineColor, line), s.a);
}
`,
};

const voronoi: EffectDef = {
  id: 'voronoi',
  name: 'Voronoi',
  category: 'pixel',
  description: 'Voronoi cells from a jittered grid, each filled with the image colour at its seed.',
  params: [
    { type: 'range', key: 'cells', label: 'Cells', min: 6, max: 160, step: 1, default: 44 },
    { type: 'range', key: 'jitter', label: 'Jitter', min: 0, max: 1, default: 0.9 },
    {
      type: 'select',
      key: 'style',
      label: 'Style',
      options: [
        { value: 0, label: 'Flat' },
        { value: 1, label: 'Facets' },
        { value: 2, label: 'Stained glass' },
        { value: 3, label: 'Pebbles' },
      ],
      default: 0,
    },
    {
      type: 'range',
      key: 'edge',
      label: 'Edge width',
      min: 0,
      max: 8,
      step: 0.5,
      default: 1,
      unit: 'px',
      group: 'Edges',
    },
    { type: 'color', key: 'edgeColor', label: 'Edge colour', default: '#0d0b09', group: 'Edges' },
    { type: 'range', key: 'sat', label: 'Saturation', min: 0, max: 2, default: 1.1, unit: '×', group: 'Colour' },
    { type: 'range', key: 'speed', label: 'Drift', min: 0, max: 2, default: 0.25, group: 'Motion' },
  ],
  presets: [
    { name: 'Cells', values: {} },
    { name: 'Crystal', values: { style: 1, cells: 36, edge: 0.5 } },
    { name: 'Stained glass', values: { style: 2, edge: 3, cells: 30, sat: 1.4 } },
    { name: 'Pebbles', values: { style: 3, edge: 2, edgeColor: '#2b241d', cells: 40 } },
    { name: 'Grid', values: { jitter: 0.25, edge: 1.5, edgeColor: '#f5ecd7', speed: 0 } },
    { name: 'Fine shards', values: { cells: 110, edge: 0.5, speed: 0 } },
    { name: 'Lava lamp', values: { speed: 1.2, cells: 20, edge: 2, edgeColor: '#ff5a3c', style: 1 } },
  ],
  glsl:
    AREA_AVG +
    /* glsl */ `
vec2 siteAt(vec2 id) {
  vec2 h = hash22(id + u_seed * 71.0);
  vec2 o = (h - 0.5) * u_jitter;
  if (u_speed > 0.0) {
    float t = u_time * u_speed;
    o += 0.3 * u_jitter * vec2(sin(t + h.x * TAU), cos(t * 0.87 + h.y * TAU));
  }
  return 0.5 + clamp(o, -0.5, 0.5);
}

vec4 effect(vec2 uv) {
  vec4 s = src(uv);
  float cs = u_res.x / u_cells;
  vec2 x = uv * u_res / cs;
  vec2 n = floor(x);
  vec2 f = fract(x);

  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + siteAt(n + g) - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  // Distance to the nearest cell border (exact, via the bisectors).
  md = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + siteAt(n + g) - f;
      if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }

  vec2 site = (n + mg + siteAt(n + mg)) * cs / u_res;
  vec3 col = saturation(areaAvg(site, cs * 0.7).rgb, u_sat);
  int st = int(u_style + 0.5);
  float ew = u_edge * u_unit;
  float dpx = md * cs;
  float rad = length(mr);
  vec3 L = normalize(vec3(-0.5, -0.6, 0.62));

  if (st == 1) {
    vec3 nn = normalize(vec3(-mr / max(rad, 1e-4) * 0.55, 1.0));
    col *= 0.62 + 0.6 * max(dot(nn, L), 0.0);
  } else if (st == 2) {
    ew = ew + 1.5 * u_unit;
    col = clamp(col * 1.15 + 0.06, 0.0, 1.0);
    col *= 0.78 + 0.34 * smoothstep(0.0, 0.35, md) + 0.08 * (vnoise(x * 6.0) - 0.5);
  } else if (st == 3) {
    float hgt = smoothstep(0.0, 0.3, md);
    vec3 nn = normalize(vec3(-mr / max(rad, 1e-4) * (1.0 - hgt) * 1.4, 1.0));
    col *= 0.55 + 0.6 * max(dot(nn, L), 0.0);
    col += 0.18 * pow(max(dot(reflect(-L, nn), vec3(0.0, 0.0, 1.0)), 0.0), 12.0);
    dpx -= cs * 0.04;
  }
  float edge = ew > 0.0 ? clamp(ew * 0.5 - dpx + 0.5, 0.0, 1.0) : 0.0;
  return vec4(mix(clamp(col, 0.0, 1.0), u_edgeColor, edge), s.a);
}
`,
};

export const PIXEL_EFFECTS: EffectDef[] = [blockMosaic, blockify, toyBricks, outline, quadtreeZoom, voronoi];
