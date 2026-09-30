# ascii art

Turn any photo into **animated colour ASCII art** in your browser — or switch to the **PRO studio** for videos, 59
looks, layers, motion and a timeline, with MP4 export. Upload (or drop, or paste) a picture, and it's redrawn
as glyphs that ripple like fabric under sweeping bands of light, with bloom, adjustable detail, and AI subject /
background separation. Nothing is uploaded anywhere: your photo never leaves your device.

![The pizza sample as colour ASCII](docs/screenshot.png)

The colour-ASCII look comes from the animated pizza of
[PizzaDrop](https://github.com/awne8886/p2p-file) (`client/src/ascii/`): the same density ramp (`. : + * = # % @`),
shadow → base → highlight colour ramps per "material", glow baked into the brightest glyphs, rippling rows, diagonal
light bands and sparse flicker. It's generalised from one hand-drawn pizza to any photo, and moved onto the GPU.

## Features

- **Upload anything**: pick a file, drag it onto the page, or paste from the clipboard. JPEG, PNG, WebP, GIF, AVIF, and
  whatever else your browser decodes. Photos are capped at 2048 px internally.
- **Collapsible sidebar** (right side, or a bottom sheet on phones; press **H** to toggle), with:
  - **Characters**: size (smaller = more detail; the grid size is shown live), character set (the original ramp,
    standard, a dense 70-glyph ramp, blocks `░▒▓█`, binary, Matrix-style katakana, or your own characters, which are
    sorted by measured ink automatically), glyph density, and optional **edge lines** (`- | / \` along strong edges).
  - **Colour & tone**: _Photo_ (every glyph keeps its colour), _Palette_ (an adaptive palette of k-means "materials",
    like the pizza's cheese / pepperoni / crust), or _Mono_ (one tint). Auto tone, brightness, contrast, saturation,
    and how much of the photo shows through behind the glyphs.
  - **Wave animation**: on/off, wave on/off, wave height, wavelength, speed, light-band strength, sparkle.
  - **Bloom**: on/off, intensity, radius, threshold, and the baked glyph glow.
  - **Subject & background**: separate the subject automatically, then show
    - **Subject only**: ASCII subject on black, with the original's dim stars,
    - **On photo**: ASCII subject over the untouched photo background (with background brightness and blur),
    - **Inverse**: the photo's subject over an ASCII background,
    - plus _swap subject & background_, and fine-tuning of the cut-out (threshold, edge softness, grow / shrink).
  - **Export**: PNG (2× or 4×), a 6-second video (WebM, or MP4 where that's what the browser records), or the grid as
    plain text.
- Settings persist between visits. With `prefers-reduced-motion`, the animation starts paused (one switch turns it on).

## PRO studio

The sidebar's **PRO** card (or `#/pro`) switches the site to its other side: a full image **and video** effects studio in
the same black / cream / cheese colours, laid out like [Ladybug](https://app.theladybug.app/). The photo open in the
classic view comes along as the first layer. **Classic** in the rail (or the logo) goes back.

- **Video in, video out.** Drop or pick videos (or pictures, or use the webcam). Every frame goes through the looks,
  live in the preview, and again frame by frame on export.
- **59 looks** in ten families, with search, live thumbnails, presets and _Surprise me_: Light & glass (Thermal), Type
  & code (ASCII, Dither Text, Matrix Rain, Number Field, Word Mosaic…), Halftone & dither (Halftone, Dithering, Riso,
  Pixel Poster, Retro Matrix…), Textile & craft (Crosshatch, Knitted Embroidery, Kilim Carpet…), Pixel & 3D (Toy
  Bricks, Voronoi, Quadtree Zoom…), Edges & outlines (Contour Map, Edge Detection…), Analog & glitch (CRT, VHS, Pixel
  Sort, Glitch…), Analog (Film Prism, Wave Lines), Experimental (Holo, Stardust, Ember Veil…) and Tracking & interface
  (Brand Generator). The classic site's rippling colour ASCII is the _ASCII_ look.
- **Stacks of looks** per layer and for the whole canvas, each with blend mode, strength and where it appears (brights,
  darks, centre, edges, the tracked object, the subject or the background). Any number setting can **loop** between two values (◇) or **follow the sound** (♪) of the
  video layers. Save stacks to _Saved looks_ and reuse them.
- **Layers**: pictures, videos, webcam, type, shapes (circle, square, sphere, star, blob…) and the animated sample clip,
  with placement handles, fit, opacity, blend modes, 3D tilt, and **motion** presets (drift, orbit, spin, bounce,
  zoom, shake, swing…) that always loop seamlessly.
- **Object tracking** (the dock's _Track_ tab): draw a box around something in a video or the sample clip and it is
  followed through the whole clip (a template tracker with normalized cross-correlation, run frame by frame in the
  browser, forwards and backwards from where you drew it). Other layers can **follow** it (optionally growing and
  shrinking with it), _Label that follows_ adds a tag that rides along, any look can appear only on the **tracked
  object**, and _Cut out the object_ separates it from everything around it, in its real shape.
- **Subject & background** (the dock's _Subject_ tab): the subject of a video, the sample clip, a picture or the webcam
  is separated from its background, with the classic site's models (_AI · fast_, _AI · best_ on WebGPU, or _Classic_
  with no download). Then pick a composition: the looks **on the subject** over the untouched video, the characters
  **laid over** the subject so the video shows through them, the **subject only** (its background see-through, so the
  layers below show), the looks on the background, or the background only; or set what shows, where the looks go, and
  how they blend, yourself. Edges have a threshold, softness, grow / shrink and a steadier mode, and the background can
  be dimmed, blurred or desaturated before the looks. Videos are analysed ahead of time (5 to 30 masks a second, blended
  in between) over the part of the clip the layer plays, so the preview and the export both get a mask for every
  frame; the webcam is separated live. With _Tracked object_, only the tracked object is separated, in a window that
  follows it. Canvas looks can appear on the subjects of every layer, or on the background.
- **Finish**: bloom, streaks and trails per layer or for the canvas; paper grain and a colour grade for the canvas.
- **Canvas & timeline**: aspect presets or any size, length, frame rate, loop, background (see-through, light, dark,
  colour), a transport bar and an expandable timeline where clips can be moved and trimmed.
- **Export**: MP4 or WebM (with the video layers' sound mixed in), a PNG of the current frame, or a PNG sequence as a
  ZIP; 720 px up to 4K, any length and frame rate, optional motion blur. Rendering is frame-accurate: videos are
  decoded frame by frame with WebCodecs ([Mediabunny](https://mediabunny.dev/)), so a slow machine just takes longer.
  Browsers without WebCodecs fall back to a real-time recording.
- Undo / redo, keyboard shortcuts (press **?**), templates, and autosave (the project in `localStorage`, its files in
  IndexedDB). Nothing leaves your device.

Under the hood (`src/pro/`): each look is one fragment shader (`effects/`) run by a WebGL2 compositor
(`gl/renderer.ts`) that renders each layer's looks at the size it covers on screen, places it with a projective
transform, then applies the canvas's looks and finish. The same renderer draws the preview and, off screen, the export
(`export/exporter.ts`). A layer with its subject separated gets up to two more passes: its background is treated
first (brightness, blur, saturation), and after its looks a matte pass keeps them to their part of the picture, over the
untouched one, and cuts away what doesn't show. Its masks come from the classic site's segmentation worker, analysed
ahead of time (`subject/`) and kept in IndexedDB, outside the project.

## How it works

```
 photo ─┬─► grid sampler ──► per-cell colour, coverage, edge orientation (structure tensor)
        │                         │
        │                  tone map (Oklab) ─► colour mode (photo / k-means palette / mono)
        │                         │                    │
        │                         └──► shadow · base · highlight ramp, density bias, floor
        │                                              │  16 bytes per cell
        │                                              ▼
        │                                WebGL2: one instanced quad per cell
        │                                vertex shader = the original per-frame loop
        │                                (row ripple, light bands, flicker, colour level, glyph pick)
        │                                              │
        └─► segmentation worker ─► soft mask ─► composite (photo / mask / glyphs) ─► bloom ─► screen
             (U²-Net / BiRefNet / classic,
              refined by a colour-guided filter)
```

- **Sampling** (`src/ascii/analyze.ts`): like the original, the picture is rasterised at a few samples per character
  cell; each cell keeps its alpha-weighted average colour and coverage. A Sobel structure tensor per cell gives the
  dominant edge orientation and how clean it is, for the edge-line glyphs.
- **Tone and colour** (`src/ascii/cells.ts`, `palette.ts`): lightness is auto-levelled in Oklab (measured on the whole
  picture, so the subject looks the same in every composition). Every colour gets a shadow → base → highlight ramp
  derived with constants fitted to the pizza's hand-made materials: shadows darken, desaturate and warm towards red,
  highlights lighten and warm towards yellow. In _Palette_ mode, weighted k-means finds the materials, and small,
  colourful clusters get a brightness floor so they never sink into a dark band (the pizza's pepperoni rule).
- **Rendering** (`src/ascii/renderer.ts`, `shaders.ts`): the pizza renderer blits pre-drawn glyph sprites with
  `drawImage`. Here, every cell is an instanced quad reading a glyph atlas, and the per-frame maths runs in the vertex
  shader, including the same integer hash for the flicker, so hundreds of thousands of glyphs animate at full frame
  rate. Glyphs are drawn offscreen, then a bright-pass + dual-Kawase blur chain produces the bloom, and a final pass
  composites photo, mask and glyphs.
- **Subject separation** (`src/segment/`): runs in a Web Worker so the animation never stutters.
  - **AI · fast**: [U²-Net small](https://huggingface.co/BritishWerewolf/U-2-Netp) (4.6 MB, Apache-2.0), on
    [onnxruntime-web](https://onnxruntime.ai/). Works in every browser.
  - **AI · high quality**: [BiRefNet lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) (MIT), 115 MB
    (fp16) or 224 MB. Needs WebGPU, since at 1024 px it doesn't fit in WebAssembly's memory.
  - **Classic**: no download. It models the background from the colours touching the frame, scores every pixel
    against it with a centre prior, and Otsu-thresholds, keeps the main regions and fills holes. Good for product
    shots and portraits against plain backgrounds.
  - Either way, the coarse mask is refined at 1024 px with a **colour-guided filter**, so its edges snap to the edges in
    the photo. A cut-out PNG with transparency uses its own alpha instead.
  - Models download once from Hugging Face (pinned revisions) and are cached by the browser.

## Development

Requires Node 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # lint, format check, typecheck, unit tests
npm run build      # static site in dist/
```

In development, `#/pro-sheet` renders every look (`?presets=1` for every preset, `?only=a,b` for some) on the sample
picture and lists any shader that fails to compile.

## Deploying

It's a static site. `.github/workflows/pages.yml` checks every push and pull request and publishes `main` to
**GitHub Pages**. One-time setup: _Settings → Pages → Build and deployment → Source: GitHub Actions_. Any other static
host works too: `npm run build` and upload `dist/` (set `BASE_PATH` if it's served under a sub-path).

## Licence

MIT. The segmentation models keep their own licences (Apache-2.0 and MIT, above); Mediabunny is MPL-2.0.
