# YouBeU Studio

A browser sketchboard for fashion: draw a garment, fill it with colours and prints, start from editable templates, or upload a photo of a dress and restyle it. Built for shoppers and designers alike. It runs fully in the browser, with no server and nothing uploaded.

This is step 1 of **YouBeU**, which started as our team's Myntra HackerRamp project ("Sketch Your Style": draw what you want and find it). The full plan:

1. **Sketchboard** (this): draw, fill, template, edit photos. ✅
2. **Find it:** understand the sketch and match it to products.
3. **Request it:** when nothing matches, turn the sketch into a design request for tailors and sellers.
4. **Weekly design challenges, badges and a leaderboard.**

## Features

- **Pen** (pressure-sensitive with a stylus) for clean lines, and a **paint brush** that colours under the lines
- **Fill** with solid colour or 16 procedural patterns (floral, polka, stripes, pinstripe, checks, plaid, chevron, paisley, leaves, ikat, denim, linen, knit, houndstooth, sequins), with adjustable pattern size and gap closing for outlines that aren't fully closed
- **Photo editing:** upload or drop a garment photo, then recolour it or add a print while keeping its folds and shading
- **Editable templates:** top, kurta, dress, skirt and trousers, with options for sleeves, neckline, length and silhouette; place them as lines or show them as a tracing guide
- **Select and move:** click a shape (or drag a box) to move, resize, flip, duplicate or delete it
- **Mirror mode** for symmetric garments, an eraser per layer, a colour picker, recent colours, and a second colour for pattern grounds
- **Layers** (lines, colour, photo) with show/hide, clearing and photo fade for tracing
- **Undo/redo** and keyboard shortcuts: V select · B pen · P paint · E eraser · G fill · I picker · M mirror · [ ] size · X swap colours

## Run it

Open `index.html` in any modern browser. That's it.

To change the code, edit `src/studio.html` (UI and tools) or `src/engine.js` (garment templates and sketch recognizer), then run `python3 build.py` to rebuild `index.html`.

## How the fill works

Lines are thresholded into a wall mask, small gaps are closed with a separable dilation, and a flood fill from the click gives the region. On photos, the region is grown by colour similarity instead. The new colour is applied scaled by each pixel's luminance relative to the region's average, which keeps the fabric's light and shadow.
