# YouBeU Studio

A browser sketchboard for fashion: draw a garment, fill it with colours and prints, start from editable templates, or upload a photo of a dress and restyle it. Built for shoppers and designers alike. It runs fully in the browser, with no server and nothing uploaded.

This is step 1 of **YouBeU**, which started as our team's Myntra HackerRamp project ("Sketch Your Style": draw what you want and find it). The full plan:

1. **Sketchboard** (this): draw, fill, template, edit photos. ✅
2. **Find it:** AI reads the design and finds real products on Myntra, Amazon, Flipkart, Meesho and AJIO that look like it. ✅
3. **Request it:** when nothing matches, turn the sketch into a design request for tailors and sellers.
4. **Weekly design challenges, badges and a leaderboard.**

## Features

- **Pen** (pressure-sensitive with a stylus) for clean lines, and a **paint brush** that colours under the lines
- **Fill** with solid colour or 16 procedural patterns (floral, polka, stripes, pinstripe, checks, plaid, chevron, paisley, leaves, ikat, denim, linen, knit, houndstooth, sequins), with adjustable pattern size and gap closing for outlines that aren't fully closed
- **Photo garment editing:** upload a photo and the garment is found automatically (Gemini locates it, the browser refines the exact pixels; fix it with Add/Remove brushes). Then recolour it or add a print (folds and shading kept), shorten or lengthen it (the hem shape is kept), or add short, elbow, 3/4 or full sleeves made from the garment's own fabric
- **Editable templates:** top, kurta, dress, skirt and trousers, with options for sleeves, neckline, length and silhouette; place them as lines or show them as a tracing guide
- **Select and move:** click a shape (or drag a box) to move, resize, flip, duplicate or delete it
- **Mirror mode** for symmetric garments, an eraser per layer, a colour picker, recent colours, and a second colour for pattern grounds
- **Layers** (lines, colour, photo) with show/hide, clearing and photo fade for tracing
- **Undo/redo** and keyboard shortcuts: V select · B pen · P paint · E eraser · G fill · I picker · M mirror · [ ] size · X swap colours

## Find it: how matching works

1. **Read the design:** Gemini looks at the sketch or edited photo, plus facts the studio recorded (fill colours and prints used), and returns the garment type, colours, print, sleeves, neckline, length, silhouette, details and a shopper-style search query.
2. **Search real stores:** a SerpAPI Google Images search restricted to myntra.com, amazon.in, flipkart.com, meesho.com and ajio.com returns real product pages and their photos. Category pages and other sites are filtered out.
3. **Compare looks:** Gemini scores each product photo against the design (garment type 35%, cut and length 25%, colour 20%, print 15%, details 5%), so results are ranked by visual similarity, not just keywords.

The API keys live only on the server (`api/find.js`), never in the page.

## Deploy (Vercel, free)

1. Import this repo at vercel.com (Add New → Project).
2. Add environment variables `GEMINI_API_KEY` and `SERPAPI_KEY` (optional: `GEMINI_MODEL`).
3. Deploy. The studio is at the root URL, and the search runs from `/api/find`.

## Run it

Open `index.html` in any modern browser to use the studio. Find it needs the deployed backend.

To change the code, edit `src/studio.html` (UI and tools) or `src/engine.js` (garment templates and sketch recognizer), then run `python3 build.py` to rebuild `index.html`.

## How the fill works

Lines are thresholded into a wall mask, small gaps are closed with a separable dilation, and a flood fill from the click gives the region. On photos, the region is grown by colour similarity instead. The new colour is applied scaled by each pixel's luminance relative to the region's average, which keeps the fabric's light and shadow.
