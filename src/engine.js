// Sketch-to-Shop engine: parametric garment generator + on-device sketch recognizer + ranker + chat parser.
// Pure JS, no DOM, no network. Shared by the page and the node test harness.
const S2S = (() => {
  // ---------- seeded RNG ----------
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  const CATS = ['top', 'kurta', 'dress', 'skirt', 'trousers'];
  const UPPER = new Set(['top', 'kurta', 'dress']);
  const LABELS = {
    category: { top: 'Top', kurta: 'Kurta', dress: 'Dress', skirt: 'Skirt', trousers: 'Trousers' },
    sleeve: { none: 'Sleeveless', short: 'Short sleeve', three: '3/4 sleeve', full: 'Full sleeve' },
    neck: { v: 'V-neck', round: 'Round neck', high: 'High neck' },
    fit: { flared: 'Flared', straight: 'Straight' },
    pattern: { solid: 'Solid', printed: 'Printed' },
  };
  function lengthLabel(cat, v) {
    const m = {
      top: { short: 'Cropped', mid: 'Regular', long: 'Longline' },
      kurta: { short: 'Short', mid: 'Knee length', long: 'Calf length' },
      dress: { short: 'Mini', mid: 'Midi', long: 'Maxi' },
      skirt: { short: 'Mini', mid: 'Midi', long: 'Maxi' },
      trousers: { short: 'Shorts', mid: 'Cropped', long: 'Full length' },
    };
    return (m[cat] || m.dress)[v] || v;
  }
  function fitLabel(cat, v) { return cat === 'trousers' ? (v === 'flared' ? 'Wide-leg' : 'Slim') : (cat === 'kurta' && v === 'flared' ? 'Flared (Anarkali)' : LABELS.fit[v]); }

  // ---------- parametric garment generator ----------
  // returns {outline:[[x,y]...closed], extra:[[pts]...]} in garment units, y down
  function garment(spec, r) {
    const J = (a) => r ? 1 + (r() * 2 - 1) * a : 1; // multiplicative jitter
    const { category: cat } = spec;
    let right = [], extra = [];
    if (UPPER.has(cat)) {
      const nh = 0.17 * J(0.15);
      const nd = { high: 0.03, round: 0.16, v: 0.32 }[spec.neck] * J(0.2);
      // neckline, center -> neck corner
      const N = 10;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        if (spec.neck === 'v') right.push([nh * t, nd * (1 - t)]);
        else { const a = t * Math.PI / 2; right.push([nh * Math.sin(a), nd * Math.cos(a)]); }
      }
      const bx = 0.5;
      if (spec.sleeve === 'none') {
        right.push([0.4 * J(0.05), 0.06]);
        right.push([0.42, 0.18]); right.push([0.47, 0.27]); right.push([bx, 0.32]);
      } else {
        const sh = [0.56 * J(0.04), 0.08];
        const P = { short: [0.32, 35], three: [0.62, 58], full: [0.95, 68] }[spec.sleeve];
        const L = P[0] * J(0.12), th = (P[1] + (r ? (r() * 2 - 1) * 6 : 0)) * Math.PI / 180;
        const cw = 0.26 * J(0.1);
        const co = [sh[0] + L * Math.cos(th), sh[1] + L * Math.sin(th)];
        const ci = [co[0] - cw * Math.sin(th), co[1] + cw * Math.cos(th)];
        right.push(sh, co, ci, [bx, 0.30]);
      }
      let wy, wx, hy, hx;
      const len = spec.length;
      if (cat === 'top') { wy = 0.7; wx = 0.48; hy = { short: 0.85, mid: 1.25, long: 1.6 }[len]; hx = spec.fit === 'flared' ? 0.7 : 0.5; }
      else if (cat === 'kurta') { wy = 0.75; hy = { short: 1.9, mid: 2.4, long: 2.9 }[len]; if (spec.fit === 'flared') { wx = 0.44; hx = 0.95; } else { wx = 0.48; hx = 0.56; } }
      else { wy = 0.75; wx = 0.40; hy = { short: 1.6, mid: 2.2, long: 2.9 }[len]; hx = spec.fit === 'flared' ? 0.9 : 0.52; }
      wy = Math.min(wy, hy * 0.7);
      hy *= J(0.08); hx *= J(0.08); wx *= J(0.05);
      right.push([wx, wy], [hx, hy]);
      const dip = spec.fit === 'flared' && cat !== 'top' ? 0.05 : 0;
      right.push([hx * 0.5, hy + dip * 0.7], [0, hy + dip]);
    } else if (cat === 'skirt') {
      const w = 0.42 * J(0.05), L = { short: 0.7, mid: 1.2, long: 1.9 }[spec.length] * J(0.08);
      const hx = (spec.fit === 'flared' ? 0.42 + 0.35 * L : 0.46) * J(0.08);
      right.push([0, 0], [w, 0], [hx, L], [hx * 0.5, L + 0.03], [0, L + 0.03]);
      extra.push([[-w, 0.08], [w, 0.08]]);
    } else { // trousers
      const w = 0.5 * J(0.04), L = { short: 0.6, mid: 1.1, long: 1.7 }[spec.length] * J(0.08);
      const crotch = Math.min(0.42, 0.45 * L);
      const ox = (spec.fit === 'flared' ? 0.66 : 0.46) * J(0.06), lw = (spec.fit === 'flared' ? 0.5 : 0.24) * J(0.08);
      right.push([0, 0], [w, 0], [ox, L], [Math.max(0.05, ox - lw), L], [0, crotch]);
      extra.push([[-w, 0.07], [w, 0.07]]);
    }
    // mirror into closed loop
    const left = right.slice().reverse().map(([x, y]) => [-x, y]);
    let outline = right.concat(left.slice(1));
    if (spec.pattern === 'printed') {
      const rr = r || rng(7);
      const bb = bbox(outline);
      let tries = 0;
      while (extra.length < 14 && tries++ < 400) {
        const x = bb.x0 + rr() * (bb.x1 - bb.x0), y = bb.y0 + rr() * (bb.y1 - bb.y0);
        if (!pip([x, y], outline) || distToPoly([x, y], outline) < 0.12) continue;
        const k = 0.035, dot = [];
        for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI * 2; dot.push([x + k * Math.cos(a), y + k * Math.sin(a)]); }
        extra.push(dot);
      }
    }
    return { outline, extra };
  }

  function bbox(pts) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }
  function pip(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
  function distToPoly(p, poly) { let d = 1e9; for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, segDist(p, poly[i], poly[i + 1])); return d; }
  function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

  // turn a garment into hand-drawn-looking strokes (for samples and self-test)
  function sketchStrokes(spec, r) {
    const g = garment(spec, r);
    const out = [];
    const wob = (pts, amp) => {
      const dense = densify(pts, 0.025);
      const ph = r ? r() * 6.28 : 0, fr = r ? 3 + r() * 4 : 0;
      return dense.map(([x, y], i) => r ? [x + amp * (Math.sin(i / fr + ph) + (r() - 0.5) * 0.6), y + amp * (Math.cos(i / fr * 1.3 + ph) + (r() - 0.5) * 0.6)] : [x, y]);
    };
    let ol = wob(g.outline.concat([g.outline[0]]), r ? 0.008 : 0);
    if (r && r() < 0.35) { // leave a small gap, like a real sketch that doesn't close
      const i = Math.floor(r() * (ol.length - 4)); ol = ol.slice(i + 2).concat(ol.slice(0, i));
    }
    out.push(ol);
    for (const e of g.extra) out.push(wob(e, r ? 0.004 : 0));
    // random shear / scale / rotation
    if (r) {
      const sx = 1 + (r() - 0.5) * 0.16, sy = 1 + (r() - 0.5) * 0.16, rot = (r() - 0.5) * 0.08;
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const st of out) for (const p of st) { const x = p[0] * sx, y = p[1] * sy; p[0] = x * c - y * s; p[1] = x * s + y * c; }
    }
    return out;
  }
  function densify(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    return out;
  }

  // ---------- recognizer ----------
  const N = 96;
  function rasterize(strokes) {
    const all = strokes.flat();
    if (all.length < 2) return null;
    const bb = bbox(all);
    const W = bb.x1 - bb.x0, H = bb.y1 - bb.y0;
    if (Math.max(W, H) <= 0) return null;
    const sc = 82 / Math.max(W, H);
    const ox = (N - W * sc) / 2 - bb.x0 * sc, oy = (N - H * sc) / 2 - bb.y0 * sc;
    const ink = new Uint8Array(N * N);
    const plot = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (dx * dy) continue; const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) ink[Y * N + X] = 1; } };
    for (const st of strokes) {
      if (st.length === 1) { plot(st[0][0] * sc + ox, st[0][1] * sc + oy); continue; }
      for (let i = 1; i < st.length; i++) {
        const ax = st[i - 1][0] * sc + ox, ay = st[i - 1][1] * sc + oy, bx = st[i][0] * sc + ox, by = st[i][1] * sc + oy;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
        for (let k = 0; k <= n; k++) plot(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
      }
    }
    return ink;
  }
  function dilate(m, r) { const o = new Uint8Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && dx * dx + dy * dy <= r * r + r) o[Y * N + X] = 1; } return o; }
  function erode(m, r) { const inv = m.map(v => 1 - v); const d = dilate(inv, r); return d.map(v => 1 - v); }
  function floodOutside(block) {
    const out = new Uint8Array(N * N), q = [];
    for (let i = 0; i < N; i++) for (const p of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (!block[p] && !out[p]) { out[p] = 1; q.push(p); }
    while (q.length) { const p = q.pop(), x = p % N, y = (p / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue; const k = Y * N + X; if (!block[k] && !out[k]) { out[k] = 1; q.push(k); } } }
    return out;
  }
  const count = (m) => { let c = 0; for (const v of m) c += v; return c; };

  function silhouette(ink) {
    const inkC = count(ink);
    for (const d of [1, 2, 3]) {
      const blk = dilate(ink, d);
      const outside = floodOutside(blk);
      let mask = outside.map(v => 1 - v);
      mask = erode(mask, d);
      for (let i = 0; i < mask.length; i++) mask[i] |= ink[i];
      if (count(mask) > inkC * 2.2) return { mask, closed: d };
    }
    // fallback: fill between ink horizontally AND vertically
    const mask = new Uint8Array(N * N);
    const rowL = new Array(N).fill(N), rowR = new Array(N).fill(-1), colT = new Array(N).fill(N), colB = new Array(N).fill(-1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (ink[y * N + x]) { rowL[y] = Math.min(rowL[y], x); rowR[y] = Math.max(rowR[y], x); colT[x] = Math.min(colT[x], y); colB[x] = Math.max(colB[x], y); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x >= rowL[y] && x <= rowR[y] && y >= colT[x] && y <= colB[x]) mask[y * N + x] = 1;
    return { mask, closed: 0 };
  }

  const tconf = (x, ths, scale) => { let d = Infinity; for (const t of ths) d = Math.min(d, Math.abs(x - t)); return Math.min(0.98, 0.5 + 0.5 * Math.tanh(d / scale)); };
  const pick = (x, ths, vals) => { for (let i = 0; i < ths.length; i++) if (x < ths[i]) return vals[i]; return vals[vals.length - 1]; };

  function recognize(strokes, colors) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const ink = rasterize(strokes);
    if (!ink) return null;
    const { mask, closed } = silhouette(ink);
    // rows -> runs
    let y0 = N, y1 = -1, x0 = N, x1 = -1, mx = 0, mc = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mask[y * N + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); mx += x; mc++; }
    if (mc < 20) return null;
    const h = y1 - y0 + 1, w = x1 - x0 + 1, cx = Math.round(mx / mc);
    const runs = [];
    for (let y = 0; y < N; y++) { const rr = []; let s = -1; for (let x = 0; x <= N; x++) { const v = x < N && mask[y * N + x]; if (v && s < 0) s = x; if (!v && s >= 0) { rr.push([s, x - 1]); s = -1; } } runs.push(rr); }
    const span = (y) => runs[y].length ? runs[y][runs[y].length - 1][1] - runs[y][0][0] + 1 : 0;
    const centerRun = (y) => { let best = null, bd = 1e9; for (const r of runs[y]) { const d = cx < r[0] ? r[0] - cx : cx > r[1] ? cx - r[1] : 0; if (d < bd) { bd = d; best = r; } } return best ? best[1] - best[0] + 1 : 0; };
    const rowAt = (f) => Math.min(y1, Math.max(y0, Math.round(y0 + f * (h - 1))));
    const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

    // legs: rows near the bottom where the center column is empty and there is fabric on both sides
    let legRows = 0, legTot = 0, legW = [];
    for (let y = rowAt(0.65); y <= rowAt(0.98); y++) {
      legTot++;
      const rr = runs[y]; if (rr.length < 2) continue;
      const inside = rr.some(r => cx >= r[0] - 1 && cx <= r[1] + 1);
      const L = rr.some(r => r[1] < cx), R = rr.some(r => r[0] > cx);
      const gl = Math.max(...rr.filter(r => r[1] < cx).map(r => r[1])), gr = Math.min(...rr.filter(r => r[0] > cx).map(r => r[0]));
      if (!inside && L && R && gr - gl < 0.5 * w) { legRows++; if (y >= rowAt(0.88)) legW.push((rr[0][1] - rr[0][0] + 1 + rr[rr.length - 1][1] - rr[rr.length - 1][0] + 1) / 2); }
    }
    const legsFrac = legTot ? legRows / legTot : 0;

    // torso width, shoulder span, sleeve extent
    const tw = []; for (let y = rowAt(0.15); y <= rowAt(0.75); y++) tw.push(centerRun(y));
    tw.sort((p, q) => p - q);
    const torsoW = Math.max(1, tw[Math.floor(tw.length * 0.15)] || 1);
    let topSpan = 0, topSpanY = y0; for (let y = rowAt(0.02); y <= rowAt(0.4); y++) { const s = span(y); if (s > topSpan) { topSpan = s; topSpanY = y; } }
    const sleeveRatio = topSpan / torsoW;
    let ys = topSpanY; while (ys + 1 <= y1 && span(ys + 1) > 1.25 * torsoW) ys++;
    const sleeveLen = (ys - y0) / torsoW;

    // neckline from the top contour
    const half = Math.max(3, Math.round(0.36 * torsoW));
    const topY = []; for (let x = cx - half; x <= cx + half; x++) { let t = N; for (let y = y0; y <= y1; y++) if (x >= 0 && x < N && mask[y * N + x]) { t = y; break; } topY.push(t); }
    const shY = Math.min(...topY);
    const mid = topY.length >> 1;
    const cY = median([topY[mid - 1], topY[mid], topY[mid + 1]]);
    const depth = Math.max(0, cY - shY);
    let A = 0, D = 0; for (const t of topY) { const d = Math.min(t, cY) - shY; if (d > 1) { A += d; D++; } }
    const fillRatio = depth > 0 && D > 0 ? A / (D * depth) : 1;
    const dN = depth / torsoW;

    // widths
    const topW0 = () => Math.max(1, median([span(rowAt(0.03)), span(rowAt(0.05)), span(rowAt(0.07))]));
    const botW0 = () => Math.max(1, median([span(rowAt(0.93)), span(rowAt(0.95)), span(rowAt(0.97))]));
    const topW = topW0(), botW = botW0();
    const flare = botW / torsoW;
    const lenRatio = h / torsoW;

    // printed: ink well inside the silhouette
    const outside = mask.map(v => 1 - v);
    const band = dilate(outside, 4);
    const inn = new Uint8Array(N * N); for (let i = 0; i < ink.length; i++) if (ink[i] && !band[i]) inn[i] = 1;
    // count small separate marks (dots, motifs) — long lines like waistbands or seams don't count
    let marks = 0; const seen = new Uint8Array(N * N);
    for (let i = 0; i < inn.length; i++) if (inn[i] && !seen[i]) {
      const q = [i]; seen[i] = 1; let a = N, b = -1, c = N, d = -1;
      while (q.length) { const p = q.pop(), x = p % N, y = (p / N) | 0; a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue; const k = Y * N + X; if (inn[k] && !seen[k]) { seen[k] = 1; q.push(k); } } }
      if (Math.max(b - a, d - c) <= 9) marks++;
    }
    const innerFrac = marks;
    const conv = (span(rowAt(0.25)) - (topW0() + (botW0() - topW0()) * 0.222)) / Math.max(1, botW0());

    // ---------- decisions ----------
    const f = {};
    const res = { features: f, attrs: {}, mask, ink, closed };
    Object.assign(f, { conv, legsFrac, torsoW, sleeveRatio, sleeveLen, dN, fillRatio, flare, lenRatio, topW, botW, innerFrac, aspect: h / w });

    let cat, catConf;
    const skirtLike = sleeveRatio < 1.3 && dN < 0.07 && topW / botW < 1.02 && conv < 0.045 && h / w < 2.6;
    if (legsFrac > 0.35) { cat = 'trousers'; catConf = tconf(legsFrac, [0.35], 0.2); }
    else if (skirtLike) { cat = 'skirt'; catConf = Math.min(tconf(dN, [0.07], 0.04), tconf(sleeveRatio, [1.3], 0.15)); }
    else if (lenRatio < 1.5) { cat = 'top'; catConf = tconf(lenRatio, [1.5], 0.2); }
    else {
      // straight, column-like silhouettes read as kurtas; a waist that flares out reads as a dress.
      // A flared kurta (Anarkali) and an A-line dress look alike in outline, so confidence stays modest there.
      cat = flare > 1.17 ? 'dress' : 'kurta';
      catConf = Math.min(flare > 1.5 ? 0.6 : 0.85, tconf(flare, [1.17], 0.08), tconf(lenRatio, [1.5], 0.2));
    }
    res.attrs.category = { v: cat, c: catConf };

    if (UPPER.has(cat)) {
      let sl, sc;
      if (sleeveRatio < 1.3) { sl = 'none'; sc = tconf(sleeveRatio, [1.3], 0.1); }
      else { sl = pick(sleeveLen, [0.64, 0.88], ['short', 'three', 'full']); sc = Math.min(tconf(sleeveLen, [0.64, 0.88], 0.1), tconf(sleeveRatio, [1.3], 0.1)); }
      res.attrs.sleeve = { v: sl, c: sc };
      let nk, nc;
      if (dN < 0.075) { nk = 'high'; nc = tconf(dN, [0.075], 0.025); }
      else { const vScore = (dN - 0.18) * 10 + (0.67 - fillRatio) * 5; nk = vScore > 0 ? 'v' : 'round'; nc = Math.min(tconf(vScore, [0], 0.4), tconf(dN, [0.075], 0.03)); }
      res.attrs.neck = { v: nk, c: nc };
    }
    const LT = { top: [1.05, 1.6], kurta: [2.05, 2.62], dress: [2.05, 2.8] };
    let lv, lc;
    if (UPPER.has(cat)) { lv = pick(lenRatio, LT[cat], ['short', 'mid', 'long']); lc = tconf(lenRatio, LT[cat], 0.15); }
    else if (cat === 'skirt') { const r = h / topW; f.lenW = r; lv = pick(r, [1.1, 1.75], ['short', 'mid', 'long']); lc = tconf(r, [1.1, 1.75], 0.15); }
    else { const r = h / topW; f.lenW = r; lv = pick(r, [0.93, 1.33], ['short', 'mid', 'long']); lc = tconf(r, [0.93, 1.33], 0.1); }
    res.attrs.length = { v: lv, c: lc };

    let fv, fc;
    if (cat === 'trousers') { const lr = (legW.length ? median(legW) : torsoW / 2) / (topW / 2); f.legRatio = lr; fv = lr > 0.72 ? 'flared' : 'straight'; fc = tconf(lr, [0.72], 0.12); }
    else if (cat === 'skirt') { const r = botW / topW; fv = r > 1.35 ? 'flared' : 'straight'; fc = tconf(r, [1.35], 0.15); }
    else { const th = cat === 'top' ? 1.2 : 1.5; fv = flare > th ? 'flared' : 'straight'; fc = tconf(flare, [th], 0.15); }
    res.attrs.fit = { v: fv, c: fc };
    res.attrs.pattern = { v: innerFrac >= 3 ? 'printed' : 'solid', c: tconf(innerFrac, [2.5], 1.5) };

    // colour: dominant by stroke length among non-ink colours
    if (colors && colors.length) {
      const tally = {};
      strokes.forEach((st, i) => { const c = colors[i]; if (!c || c === 'ink') return; let L = 0; for (let k = 1; k < st.length; k++) L += Math.hypot(st[k][0] - st[k - 1][0], st[k][1] - st[k - 1][1]); tally[c] = (tally[c] || 0) + L; });
      const tot = Object.values(tally).reduce((a, b) => a + b, 0);
      const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (best) res.attrs.color = { v: best[0], c: Math.min(0.98, best[1] / tot) };
    }
    res.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    return res;
  }

  // ---------- catalog ----------
  const COLORS = {
    maroon: ['Maroon', '#7a1f2b'], red: ['Red', '#d23a3a'], pink: ['Pink', '#e77aa0'], mustard: ['Mustard', '#d9a21b'],
    green: ['Green', '#2f8a57'], teal: ['Teal', '#1f8a8a'], navy: ['Navy', '#1f2f5c'], blue: ['Blue', '#3a74d2'],
    lavender: ['Lavender', '#9b86d1'], black: ['Black', '#222326'], white: ['Ivory', '#efe9dc'],
  };
  const BRANDS = ['Saanjh', 'Loomwell', 'Indigo Lane', 'Kaveri Studio', 'Thread & Tide', 'Neel', 'Arka', 'Mulmul Co.'];
  function makeCatalog() {
    const r = rng(2026);
    const items = [];
    const add = (spec, occ, base) => {
      const id = 'p' + items.length;
      const brand = BRANDS[Math.floor(r() * BRANDS.length)];
      const price = Math.round((base * (0.7 + r() * 0.8)) / 50) * 50 - 1;
      items.push({ id, ...spec, occasion: occ, brand, price, name: productName(spec) });
    };
    const P = (a) => a[Math.floor(r() * a.length)];
    const combos = [
      // kurtas
      ['kurta', 'three', 'round', 'mid', 'straight', 'printed', 'mustard', 'festive', 1600], ['kurta', 'full', 'v', 'long', 'flared', 'solid', 'maroon', 'festive', 2600],
      ['kurta', 'three', 'v', 'long', 'flared', 'printed', 'pink', 'festive', 2400], ['kurta', 'short', 'round', 'short', 'straight', 'printed', 'blue', 'casual', 900],
      ['kurta', 'none', 'high', 'mid', 'straight', 'solid', 'white', 'office', 1300], ['kurta', 'full', 'high', 'mid', 'straight', 'solid', 'navy', 'office', 1500],
      ['kurta', 'three', 'round', 'long', 'flared', 'solid', 'green', 'festive', 2200], ['kurta', 'short', 'v', 'mid', 'straight', 'solid', 'teal', 'casual', 1100],
      ['kurta', 'three', 'high', 'mid', 'straight', 'printed', 'maroon', 'festive', 1800], ['kurta', 'full', 'round', 'short', 'straight', 'printed', 'lavender', 'casual', 1000],
      ['kurta', 'none', 'v', 'long', 'flared', 'printed', 'red', 'festive', 2100], ['kurta', 'three', 'round', 'mid', 'straight', 'printed', 'maroon', 'festive', 1400], ['kurta', 'full', 'v', 'mid', 'straight', 'solid', 'navy', 'office', 1200], ['kurta', 'three', 'v', 'mid', 'straight', 'solid', 'black', 'office', 1400],
      // dresses
      ['dress', 'none', 'v', 'mid', 'flared', 'printed', 'green', 'casual', 1700], ['dress', 'short', 'round', 'short', 'flared', 'solid', 'red', 'party', 1900],
      ['dress', 'full', 'high', 'long', 'flared', 'solid', 'maroon', 'festive', 3200], ['dress', 'none', 'round', 'short', 'straight', 'solid', 'black', 'party', 2200],
      ['dress', 'three', 'v', 'long', 'flared', 'printed', 'mustard', 'festive', 2800], ['dress', 'short', 'v', 'mid', 'straight', 'solid', 'navy', 'office', 2000],
      ['dress', 'none', 'high', 'long', 'flared', 'solid', 'lavender', 'party', 2600], ['dress', 'short', 'round', 'mid', 'flared', 'printed', 'blue', 'casual', 1500],
      ['dress', 'full', 'v', 'mid', 'flared', 'solid', 'pink', 'party', 2400], ['dress', 'three', 'round', 'short', 'straight', 'printed', 'white', 'casual', 1300],
      // tops
      ['top', 'short', 'round', 'mid', 'straight', 'solid', 'white', 'casual', 600], ['top', 'short', 'v', 'mid', 'straight', 'printed', 'teal', 'casual', 700],
      ['top', 'full', 'high', 'mid', 'straight', 'solid', 'navy', 'office', 1100], ['top', 'none', 'v', 'short', 'straight', 'solid', 'black', 'party', 800],
      ['top', 'three', 'round', 'mid', 'flared', 'printed', 'pink', 'casual', 900], ['top', 'full', 'v', 'mid', 'straight', 'solid', 'maroon', 'office', 1000],
      ['top', 'none', 'round', 'mid', 'straight', 'printed', 'mustard', 'casual', 650], ['top', 'short', 'high', 'short', 'straight', 'solid', 'red', 'party', 750],
      ['top', 'three', 'v', 'mid', 'straight', 'solid', 'lavender', 'office', 950], ['top', 'full', 'round', 'mid', 'flared', 'printed', 'green', 'festive', 1200],
      // skirts
      ['skirt', null, null, 'long', 'flared', 'printed', 'mustard', 'festive', 1800], ['skirt', null, null, 'mid', 'straight', 'solid', 'black', 'office', 1100],
      ['skirt', null, null, 'short', 'flared', 'solid', 'pink', 'party', 900], ['skirt', null, null, 'long', 'flared', 'solid', 'maroon', 'festive', 2000],
      ['skirt', null, null, 'mid', 'flared', 'printed', 'blue', 'casual', 1000], ['skirt', null, null, 'short', 'straight', 'solid', 'navy', 'office', 950],
      ['skirt', null, null, 'long', 'straight', 'printed', 'green', 'casual', 1200], ['skirt', null, null, 'mid', 'straight', 'printed', 'red', 'party', 1050],
      // trousers
      ['trousers', null, null, 'long', 'flared', 'solid', 'white', 'festive', 1100], ['trousers', null, null, 'long', 'straight', 'solid', 'black', 'office', 1300],
      ['trousers', null, null, 'long', 'flared', 'printed', 'mustard', 'casual', 1000], ['trousers', null, null, 'mid', 'straight', 'solid', 'navy', 'office', 1200],
      ['trousers', null, null, 'short', 'straight', 'solid', 'blue', 'casual', 700], ['trousers', null, null, 'long', 'straight', 'solid', 'green', 'casual', 1150],
      ['trousers', null, null, 'mid', 'flared', 'solid', 'maroon', 'festive', 1250], ['trousers', null, null, 'short', 'flared', 'printed', 'pink', 'casual', 650],
    ];
    for (const c of combos) add({ category: c[0], sleeve: c[1], neck: c[2], length: c[3], fit: c[4], pattern: c[5], color: c[6] }, c[7], c[8]);
    return items;
  }
  function productName(s) {
    const col = COLORS[s.color][0];
    const pr = s.pattern === 'printed' ? (s.category === 'kurta' || s.category === 'skirt' ? 'Block-print ' : 'Floral ') : '';
    const n = { top: s.fit === 'flared' ? 'Peplum Top' : 'Top', kurta: s.fit === 'flared' ? 'Anarkali Kurta' : 'Straight Kurta', dress: s.fit === 'flared' ? 'A-line Dress' : 'Sheath Dress', skirt: s.fit === 'flared' ? 'Flared Skirt' : 'Pencil Skirt', trousers: s.fit === 'flared' ? 'Palazzo Pants' : 'Slim Trousers' }[s.category];
    const ln = (s.category === 'dress' || s.category === 'skirt') ? lengthLabel(s.category, s.length) + ' ' : s.category === 'trousers' && s.length === 'short' ? '' : '';
    const nm = s.category === 'trousers' && s.length === 'short' ? (s.fit === 'flared' ? 'Wide Shorts' : 'Shorts') : n;
    const nk = UPPER.has(s.category) ? LABELS.neck[s.neck] + ' ' : '';
    return `${col} ${pr}${nk}${ln}${nm}`.replace(/\s+/g, ' ');
  }

  // ---------- ranking ----------
  const W = { category: 6, sleeve: 2, neck: 2, length: 1.5, fit: 1.5, pattern: 1, color: 3, occasion: 1.5 };
  const ORD = { sleeve: ['none', 'short', 'three', 'full'], length: ['short', 'mid', 'long'] };
  const CATSIM = { 'kurta|dress': 0.5, 'dress|kurta': 0.5, 'top|kurta': 0.3, 'kurta|top': 0.3, 'top|dress': 0.2, 'dress|top': 0.2, 'skirt|trousers': 0.15, 'trousers|skirt': 0.15, 'dress|skirt': 0.15, 'skirt|dress': 0.15 };
  function simFor(k, a, b) {
    if (a === b) return 1;
    if (k === 'category') return CATSIM[a + '|' + b] || 0;
    if (ORD[k]) { const d = Math.abs(ORD[k].indexOf(a) - ORD[k].indexOf(b)); return d === 1 ? 0.45 : 0; }
    return 0;
  }
  // query: {attr: {v, c}} ; constraints: {priceMax, occasion}
  function rank(catalog, query, cons) {
    const out = [];
    for (const p of catalog) {
      if (cons.priceMax && p.price > cons.priceMax) continue;
      let s = 0, t = 0; const why = [];
      for (const k of ['category', 'sleeve', 'neck', 'length', 'fit', 'pattern', 'color']) {
        const q = query[k]; if (!q || q.v == null) continue;
        if ((k === 'sleeve' || k === 'neck') && !UPPER.has(p.category)) continue;
        if (k === 'length' && p.category !== query.category?.v && !(UPPER.has(p.category) && UPPER.has(query.category?.v))) continue;
        const m = simFor(k, q.v, p[k]);
        const wt = W[k] * q.c * (q.locked ? 2 : 1); // what the user asked for explicitly outweighs what the model guessed
        s += wt * m; t += wt;
        why.push({ k, m, label: attrLabel(k, p[k], p.category) });
      }
      if (cons.occasion) { const m = p.occasion === cons.occasion ? 1 : 0; s += W.occasion * m; t += W.occasion; why.push({ k: 'occasion', m, label: OCC[p.occasion] }); }
      out.push({ p, score: t ? s / t : 0, why });
    }
    out.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
    return out;
  }
  const OCC = { festive: 'Festive', office: 'Office', casual: 'Casual', party: 'Party' };
  function attrLabel(k, v, cat) {
    if (v == null) return '';
    if (k === 'length') return lengthLabel(cat, v);
    if (k === 'fit') return fitLabel(cat, v);
    if (k === 'color') return COLORS[v] ? COLORS[v][0] : v;
    return (LABELS[k] && LABELS[k][v]) || v;
  }

  // ---------- offline chat intent parser ----------
  const COLOR_WORDS = [['maroon', 'maroon'], ['wine', 'maroon'], ['burgundy', 'maroon'], ['red', 'red'], ['pink', 'pink'], ['rose', 'pink'], ['mustard', 'mustard'], ['yellow', 'mustard'], ['haldi', 'mustard'],
    ['green', 'green'], ['olive', 'green'], ['teal', 'teal'], ['navy', 'navy'], ['blue', 'blue'], ['indigo', 'navy'], ['lavender', 'lavender'], ['purple', 'lavender'], ['lilac', 'lavender'], ['black', 'black'], ['white', 'white'], ['ivory', 'white'], ['cream', 'white'], ['off-white', 'white']];
  function parseChat(text, state) {
    // state: {attrs (current effective query), cons}
    let t = ' ' + text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ') + ' ';
    const ch = [];
    const set = (k, v, how) => ch.push({ k, v, how });
    const cut = (re) => { const m = t.match(re); if (m) t = t.replace(re, ' '); return m; };
    if (cut(/\b(reset|start over|clear (all|everything)|from scratch)\b/)) return [{ k: '__reset' }];
    if (cut(/\bundo\b/)) return [{ k: '__undo' }];
    // price
    let m = cut(/(under|below|less than|within|max|upto|up to|budget( of)?|cheaper than|<)\s*(₹|rs\.?|inr)?\s*(\d[\d,]*(\.\d+)?)\s*(k|thousand)?/);
    if (m) { let n = parseFloat(m[4].replace(/,/g, '')); if (m[6]) n *= 1000; set('priceMax', Math.round(n), 'price'); }
    else if (cut(/\b(cheaper|less expensive|lower price|affordable|budget)\b/)) set('priceMax', '__cheaper');
    if (cut(/\b(any price|no budget|price doesnt matter)\b/)) set('priceMax', null);
    // sleeves
    if (cut(/\b(sleeveless|no sleeves?|without sleeves?|strappy)\b/)) set('sleeve', 'none');
    else if (cut(/\b(short|half|cap) ?sleeves?d?\b/)) set('sleeve', 'short');
    else if (cut(/\b(3\/4|three ?quarter|elbow)( length)? ?sleeves?\b/) || cut(/\b(3\/4|three ?quarter)\b/)) set('sleeve', 'three');
    else if (cut(/\b(full|long) ?sleeves?d?\b/)) set('sleeve', 'full');
    else if (cut(/\blonger sleeves?\b/)) set('sleeve', '__up');
    else if (cut(/\bshorter sleeves?\b/)) set('sleeve', '__down');
    // neck
    if (cut(/\bv[ -]?neck(line)?\b/)) set('neck', 'v');
    else if (cut(/\b(round|crew|scoop) ?neck(line)?\b/)) set('neck', 'round');
    else if (cut(/\b(high|mandarin|band|collar(ed)?|turtle) ?(neck|collar)?\b/)) set('neck', 'high');
    // category
    if (cut(/\b(kurtas?|kurtis?|anarkali)\b/)) { set('category', 'kurta'); if (/anarkali/.test(text.toLowerCase())) set('fit', 'flared'); }
    else if (cut(/\b(dress(es)?|gowns?|frocks?)\b/)) set('category', 'dress');
    else if (cut(/\b(skirts?|lehenga)\b/)) set('category', 'skirt');
    else if (cut(/\b(trousers?|pants?|palazzos?|jeans|shorts)\b/)) { set('category', 'trousers'); if (/palazzo/.test(text.toLowerCase())) set('fit', 'flared'); if (/\bshorts\b/.test(text.toLowerCase())) set('length', 'short'); }
    else if (cut(/\b(tops?|shirts?|tees?|t-shirts?|tshirts?|blouses?|tunics?)\b/)) set('category', 'top');
    // fit
    if (cut(/\b(flared|flare|a-line|aline|flowy|wide[ -]leg|umbrella)\b/)) set('fit', 'flared');
    else if (cut(/\b(straight|fitted|slim|bodycon|pencil|sheath)\b/)) set('fit', 'straight');
    // length
    if (cut(/\b(mini|knee length|above knee)\b/) && !ch.some(c => c.k === 'length')) set('length', 'short');
    else if (cut(/\b(midi|calf length|mid length)\b/)) set('length', 'mid');
    else if (cut(/\b(maxi|floor length|ankle length|full length)\b/)) set('length', 'long');
    else if (cut(/\bshorter\b/)) set('length', '__down');
    else if (cut(/\blonger\b/)) set('length', '__up');
    // pattern
    if (cut(/\b(not printed|no prints?|plain|solid)\b/)) set('pattern', 'solid');
    else if (cut(/\b(printed|prints?|floral|pattern(ed)?|block[ -]print|bandhani|ikat|stripes?|striped|polka)\b/)) set('pattern', 'printed');
    // occasion
    if (cut(/\b(wedding|festive|diwali|sangeet|haldi|mehendi|mehndi|puja|pooja|eid|function)\b/)) set('occasion', 'festive');
    else if (cut(/\b(office|work|formal|interview|meeting)\b/)) set('occasion', 'office');
    else if (cut(/\b(party|night out|date|cocktail|club)\b/)) set('occasion', 'party');
    else if (cut(/\b(casual|everyday|college|daily|weekend)\b/)) set('occasion', 'casual');
    if (cut(/\b(any occasion)\b/)) set('occasion', null);
    // colour (last, so "navy" etc. aren't eaten earlier)
    if (cut(/\b(any colou?r)\b/)) set('color', null);
    for (const [w, c] of COLOR_WORDS) { if (new RegExp('\\b' + w + '\\b').test(t)) { set('color', c); break; } }
    return ch;
  }

  return { garment, sketchStrokes, recognize, rasterize, makeCatalog, rank, parseChat, rng, COLORS, LABELS, OCC, UPPER, ORD, lengthLabel, fitLabel, attrLabel, N, CATS };
})();
if (typeof module !== 'undefined') module.exports = S2S;
