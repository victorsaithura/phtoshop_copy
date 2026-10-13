# PhotoForge

A Photoshop-style photo editor that runs entirely in the browser. There is no server and no build step: images are processed locally and never uploaded. Once opened, it also works offline and can be installed as an app.

## Run it

The app uses JavaScript modules, so it has to be served over HTTP. Opening `index.html` straight from disk does not work.

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static file server works (`npx serve`, VS Code Live Server, …).

### Host it for free on GitHub Pages

1. Go to the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
3. After a minute the app is live at `https://<your-user>.github.io/phtoshop_copy/`.

On a free GitHub plan, Pages only works for public repositories.

### Install it and use it offline

After the first visit over `https://` (or `localhost`), PhotoForge keeps a copy of itself so it opens without an internet connection. Choose **File ▸ Install PhotoForge…** (or the install button in Chrome/Edge's address bar, or Share ▸ Add to Dock / Home Screen in Safari) to run it in its own window. An installed copy can open PNG, JPEG, WebP, `.psd` and `.pfp` files straight from your computer.

## Features

**Documents**
- New document with presets (HD, 4K, square post, story, A4, Letter…), or open PNG, JPEG, WebP, GIF, BMP and SVG files
- Save your work as a PhotoForge project (Ctrl+S, `.pfp`) with every layer, group, mask, adjustment layer, layer style and editable text, and open it again later
- Open and save Photoshop documents (`.psd`, 8/16-bit RGB or Grayscale): layers, groups, masks, opacity, blend modes and visibility are kept. When saving, type is rasterized, layer styles are merged into their layers and adjustment layers are saved as merged pixels; when opening, Photoshop adjustment layers and layer styles are left out (you are told which)
- Autosave: unsaved documents are kept in the browser, and if the tab closes or crashes PhotoForge offers to recover them next time
- Several documents open at once, in tabs
- Drag and drop images onto the window, or paste them with Ctrl+V
- Export as PNG, JPEG or WebP with quality and scale options

**Layers**
- Add, duplicate, delete, rename (double-click), reorder (drag), hide and lock
- Opacity and 16 blend modes (Multiply, Screen, Overlay, Soft Light, Color, Luminosity, …)
- Layer via Copy / Cut, Merge Down, Merge Visible, Flatten Image
- Ctrl-click a thumbnail to select the layer's pixels
- **Groups:** Group Layers (Ctrl+G), Ungroup (Ctrl+Shift+G), New Group; nested groups with Pass Through or any blend mode, opacity and masks. Drag layers into a group, collapse it with its arrow, and move, duplicate, delete, flip or merge (Ctrl+E) a whole group at once
- **Adjustment layers** (Layer ▸ New Adjustment Layer, or the half-circle button in the Layers panel): Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter, Invert, Posterize, Threshold and Gradient Map, editable at any time (double-click the icon), with their own mask, opacity and blend mode. Inside a group, an adjustment layer only affects that group (unless the group is Pass Through)
- **Layer styles** (Layer ▸ Layer Style, the fx button, or double-click beside a layer's name): Bevel & Emboss, Stroke, Inner Shadow, Inner Glow, Color Overlay, Outer Glow and Drop Shadow, with live preview; they follow every edit to the layer. Copy, paste and clear styles from the same menu; Merge Down bakes them in

**Tools**

| Tool | Key | Notes |
|---|---|---|
| Move | V | Moves the layer, or only the selected pixels; Alt-drag moves a copy; arrow keys nudge |
| Rectangular / Elliptical Marquee | M | New / add / subtract / intersect, feather, drag a selection to move it |
| Lasso / Polygonal Lasso | L | Freehand or click-to-place outlines |
| Magic Wand | W | Select similar colours (tolerance, contiguous, sample all layers) |
| Crop | C | Handles, aspect-ratio presets, rule-of-thirds guides, can extend the canvas; Enter or double-click to crop |
| Eyedropper | I | Point or averaged sample, current layer or all layers |
| Spot Healing / Healing Brush | J | Remove blemishes; texture is blended seamlessly into the surroundings |
| Brush / Pencil | B | Size, hardness, opacity, flow, pen pressure, Shift-click straight lines |
| Clone Stamp | S | Alt-click a source, then paint; aligned or not, current layer or all layers |
| Eraser | E | Soft or hard erasing to transparency |
| Gradient / Paint Bucket | G | Linear, radial, angle and reflected gradients; fill with tolerance and contiguous options |
| Blur / Sharpen / Smudge | R | Paint to soften, sharpen or smear |
| Dodge / Burn / Sponge | O | Lighten or darken shadows, midtones or highlights; saturate or desaturate |
| Type | T | Editable text layers: font, size, bold/italic, alignment, colour |
| Rectangle / Ellipse / Polygon / Line | U | Shapes on new layers with fill, stroke, rounded corners, sides |
| Hand | H | Hold Space with any tool to pan |
| Zoom | Z | Alt-click zooms out; Ctrl + scroll or pinch also zooms |

**Image menu**
- Adjustments with live preview: Brightness/Contrast, Levels (Ctrl+L), Curves (Ctrl+M), Exposure, Vibrance, Hue/Saturation (Ctrl+U), Color Balance (Ctrl+B), Black & White, Photo Filter, Invert (Ctrl+I), Posterize, Threshold, Gradient Map, Desaturate
- Auto Tone and Auto Contrast
- Image Size (with resampling), Canvas Size (with anchor and extension color), Crop to Selection, Duplicate
- Image Rotation: 180°, 90° clockwise/counter-clockwise, arbitrary angle, flip canvas horizontally/vertically

**Filter menu**
- Blur: Gaussian, Motion, Box · Sharpen: Sharpen, Unsharp Mask · Noise: Add Noise · Pixelate: Mosaic
- Stylize: Emboss, Find Edges · Render: Vignette · Other: High Pass
- Last Filter (Ctrl+Alt+F) repeats the previous filter with the same settings

Adjustments and filters apply to the active layer, limited to the selection when there is one (feathered selections blend smoothly). Dialogs sit beside the canvas, can be dragged by their title, and show a live preview you can toggle.

**Layer masks**
- Layer ▸ Layer Mask: Reveal All, Hide All, Reveal/Hide Selection, Disable, Apply, Delete (or the mask button in the Layers panel)
- Click the mask thumbnail to edit it: paint black to hide, white to reveal; Fill, Gradient and Invert work on masks too
- Shift-click the mask thumbnail to switch it off; masks move and transform with their layer

**Editing**
- Undo/redo (last 60 steps) and a History panel to jump to any step
- Free Transform (Ctrl+T, or Ctrl+Alt+T where the browser keeps Ctrl+T): scale, rotate and move a layer with handles
- Edit ▸ Transform: flip or rotate the active layer
- Cut, copy, copy merged, paste (in place when pasting your own copy), clear and fill
- Select all, deselect, reselect, inverse
- Color panel with HSV picker, hex/RGB input and swatches

Press **?** inside the app for the full list of keyboard shortcuts. On a Mac, use ⌘ wherever Ctrl is mentioned.

## Roadmap

- **Phase 1 (done):** documents, layers, selections, painting, fills, gradients, history, export.
- **Phase 2 (done):** adjustments, filters, crop, image and canvas size, rotation and flips.
- **Phase 3 (done):** lasso and magic wand, healing and clone tools, dodge/burn/sponge, blur/sharpen/smudge, type, shapes, layer masks, Free Transform, project files.
- **Phase 4 (done):** layer groups, adjustment layers, layer styles, PSD open/save, offline use and installing, autosave and recovery.

Ideas for later: rulers, guides and snapping; Select ▸ Modify, Color Range and Quick Mask; Liquify and Content-Aware Fill; perspective and warp transforms; a Pen tool and vector shapes.

Known limitation: adjustment layers are recalculated when the image is redrawn, so dragging whole layers in very large images (tens of megapixels) with adjustment layers above them can feel slow.

## Development

```bash
npm ci                        # install the linter and test runner
npm run lint                  # ESLint
npx playwright install chromium   # once, if you don't have the browser
npm test                      # browser tests (Playwright)
```

Every push and pull request runs the same lint and browser tests automatically on GitHub Actions, in Chromium, Firefox and WebKit (Safari's engine).

## Project layout

```
index.html            page shell
css/                  theme and component styles
js/main.js            wires everything together
js/app.js             application state, documents, history, pointer input
js/actions.js         every menu command (also used by keyboard shortcuts)
js/shortcuts.js       keyboard handling
js/io.js              open, place, paste, export
js/actions-image.js   Image and Filter menu commands
js/actions-mask.js    layer mask commands
js/actions-layers.js  groups, adjustment layers and layer styles
js/project.js         .pfp project save/open
js/psd.js             Photoshop .psd reader and writer
js/autosave.js        autosave to the browser and recovery
sw.js                 service worker (offline use); manifest.webmanifest and icons/ for installing
tests/                Playwright browser tests
js/core/              document model: layers and groups, selection, history, viewport, renderer,
                      adjustments, filters, layer styles (effects.js), blend modes,
                      transforms and the live-preview engine
js/tools/             one file per tool family
js/ui/                menu bar, toolbar, options bar, panels, dialogs
```
