# PhotoForge

A Photoshop-style photo editor that runs entirely in the browser. There is no server and no build step: images are processed locally and never uploaded.

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

## Features

**Documents**
- New document with presets (HD, 4K, square post, story, A4, Letter…), or open PNG, JPEG, WebP, GIF, BMP and SVG files
- Several documents open at once, in tabs
- Drag and drop images onto the window, or paste them with Ctrl+V
- Export as PNG, JPEG or WebP with quality and scale options

**Layers**
- Add, duplicate, delete, rename (double-click), reorder (drag), hide and lock
- Opacity and 16 blend modes (Multiply, Screen, Overlay, Soft Light, Color, Luminosity, …)
- Layer via Copy / Cut, Merge Down, Merge Visible, Flatten Image
- Ctrl-click a thumbnail to select the layer's pixels

**Tools**

| Tool | Key | Notes |
|---|---|---|
| Move | V | Moves the layer, or only the selected pixels; Alt-drag moves a copy; arrow keys nudge |
| Rectangular / Elliptical Marquee | M | New / add / subtract / intersect, feather, drag a selection to move it |
| Crop | C | Handles, aspect-ratio presets, rule-of-thirds guides, can extend the canvas; Enter or double-click to crop |
| Eyedropper | I | Point or averaged sample, current layer or all layers |
| Brush / Pencil | B | Size, hardness, opacity, flow, pen pressure, Shift-click straight lines |
| Eraser | E | Soft or hard erasing to transparency |
| Gradient / Paint Bucket | G | Linear, radial, angle and reflected gradients; fill with tolerance and contiguous options |
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

**Editing**
- Undo/redo (last 60 steps) and a History panel to jump to any step
- Edit ▸ Transform: flip or rotate the active layer
- Cut, copy, copy merged, paste (in place when pasting your own copy), clear and fill
- Select all, deselect, reselect, inverse
- Color panel with HSV picker, hex/RGB input and swatches

Press **?** inside the app for the full list of keyboard shortcuts. On a Mac, use ⌘ wherever Ctrl is mentioned.

## Roadmap

- **Phase 1 (done):** documents, layers, selections, painting, fills, gradients, history, export.
- **Phase 2 (done):** adjustments, filters, crop, image and canvas size, rotation and flips.
- **Phase 3: pro tools.** Lasso, Magic Wand, Clone Stamp, Healing Brush, Dodge/Burn, Blur/Smudge brushes, Text, Shapes, layer masks, and saving projects with their layers.

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
js/core/              document model: layers, selection, history, viewport, renderer,
                      adjustments, filters, transforms and the live-preview engine
js/tools/             one file per tool family
js/ui/                menu bar, toolbar, options bar, panels, dialogs
```
