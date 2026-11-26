// YouBeU "Find it" backend (Vercel serverless function).
// 1) Gemini reads the sketch/photo and describes the garment.
// 2) SerpAPI Google Images search, restricted to Indian fashion stores, returns real product pages + photos.
// 3) Gemini compares each product photo with the sketch and scores how alike they look.
// Keys come from environment variables and never reach the browser: GEMINI_API_KEY, SERPAPI_KEY (optional GEMINI_MODEL).

const STORES = [
  { name: 'Myntra', host: 'myntra.com', product: /\/buy(\/|$|\?)/ },
  { name: 'Amazon', host: 'amazon.in', product: /\/(dp|gp\/product)\// },
  { name: 'Flipkart', host: 'flipkart.com', product: /\/p\/itm/ },
  { name: 'Meesho', host: 'meesho.com', product: /\/p\/[a-z0-9]+/i },
  { name: 'AJIO', host: 'ajio.com', product: /\/p\/[a-z0-9_]+/i },
];
const MAX_RERANK = 12;
const hits = new Map(); // light per-instance rate limit so a public demo can't drain the free quotas

function storeOf(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return STORES.find(s => h === s.host || h.endsWith('.' + s.host)) || null; } catch { return null; }
}

const { gemini, imgPart, splitDataUrl } = require('./_gemini.js');

async function analyse(key, img, hints) {
  const prompt = `You are an expert fashion merchandiser for Indian online stores (Myntra, Amazon, Flipkart, Meesho, AJIO).
The image is what a shopper made in a design app: a hand sketch (possibly rough), a filled flat sketch, or an edited photo of a garment. It shows the garment they want to buy.
App hints (facts recorded by the app, trust them for colours and prints): ${JSON.stringify(hints || {})}
Rules:
- Describe ONLY what is actually visible. Never invent a garment type, gender, sleeve or neckline that is not drawn.
- First decide if a garment shape (an outline or silhouette of clothing) is visible. If the image is only a filled area, a fabric swatch or a print with no garment outline (or the hints say print_only), set "garment_visible": false, "garment_type": "any", sleeve/neckline/length/silhouette to "n/a", and make search_query about the print and colours only, ending with the word "clothing" (e.g. "orange and white vertical striped clothing").
- Gender: use "unknown" and do NOT put women/men in search_query, unless the garment can only be for one gender (e.g. saree, lehenga, blouse, bra) or the hints say so.
Return JSON only:
{"garment_visible": true,
 "garment_type": "e.g. kurta, A-line dress, crop top, palazzo pants, saree blouse, or any",
 "gender": "women|men|unisex|kids|unknown",
 "colors": ["main colour names a shopper would use, e.g. maroon, mustard yellow"],
 "pattern": "solid | floral | polka dot | striped | checked | paisley | ikat | block print | embroidered | ...",
 "sleeve": "sleeveless | short | elbow | 3/4 | full | puff | bell | n/a",
 "neckline": "round | V-neck | high neck | mandarin collar | square | sweetheart | shirt collar | n/a",
 "length": "crop | regular | hip | knee | midi | ankle | floor | n/a",
 "silhouette": "straight | A-line | flared | fit and flare | bodycon | anarkali | wide-leg | relaxed | ...",
 "details": ["up to 4 visible design details, e.g. tiered hem, yoke print, side slits, belt"],
 "search_query": "5-10 words, how an Indian shopper would search for this on Myntra: colour, print, key cut and garment type (only the parts that are visible)",
 "summary": "one short sentence describing the design",
 "confidence": 0.0}`;
  return gemini(key, [{ text: prompt }, imgPart(img.mime, img.b64)]);
}

async function imageSearch(key, query) {
  const sites = STORES.map(s => 'site:' + s.host).join(' OR ');
  const u = new URL('https://serpapi.com/search.json');
  u.search = new URLSearchParams({ engine: 'google_images', q: `${query} (${sites})`, gl: 'in', hl: 'en', api_key: key }).toString();
  const r = await fetch(u); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Search: ${j.error || r.status}`);
  const seen = new Set(), items = [];
  for (const it of j.images_results || []) {
    const st = storeOf(it.link); if (!st || !it.link || seen.has(it.link)) continue;
    seen.add(it.link);
    items.push({ title: it.title || '', link: it.link, store: st.name, image: it.thumbnail || it.original, original: it.original, isProduct: st.product.test(new URL(it.link).pathname) || it.is_product === true });
  }
  // real product pages first; category/listing pages only if there aren't enough products
  const prods = items.filter(i => i.isProduct), rest = items.filter(i => !i.isProduct);
  return prods.length >= 8 ? prods : prods.concat(rest);
}

async function fetchImageB64(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 YouBeU' } }); clearTimeout(t);
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 1.5e6) return null;
    return { mime, b64: buf.toString('base64') };
  } catch { return null; }
}

async function rerank(key, img, analysis, items) {
  const cand = items.slice(0, MAX_RERANK);
  const pics = await Promise.all(cand.map(c => fetchImageB64(c.image)));
  const parts = [{ text: `Image 0 is a shopper's design (sketch or edited photo). Target: ${analysis.summary || analysis.search_query}.
The next images are store products, numbered 1..N in order. Score how closely each PRODUCT LOOKS like the design, 0-100, weighing:
${analysis.garment_visible === false || analysis.garment_type === 'any'
  ? 'The design is a PRINT/COLOUR only, with no garment shape: any garment type is fine. Weigh print/pattern 50%, colours 40%, overall look 10%.'
  : 'garment type 35%, silhouette/cut and length 25%, colour 20%, print/pattern 15%, details 5%.'} Judge the garment only, ignore models, backgrounds and photo style.
Return JSON only: {"scores":[{"i":1,"score":0,"reason":"max 12 words: what matches or differs"}]}` }, { text: 'Image 0 (design):' }, imgPart(img.mime, img.b64)];
  const idx = [];
  pics.forEach((p, k) => { if (p) { idx.push(k); parts.push({ text: `Image ${idx.length} (product):` }, imgPart(p.mime, p.b64)); } });
  if (!idx.length) return items;
  const out = await gemini(key, parts);
  for (const s of out.scores || []) { const k = idx[(s.i | 0) - 1]; if (k != null) { cand[k].score = Math.max(0, Math.min(100, Math.round(s.score))); cand[k].reason = String(s.reason || '').slice(0, 120); } }
  const scored = cand.filter(c => c.score != null).sort((a, b) => b.score - a.score);
  return scored.concat(cand.filter(c => c.score == null), items.slice(MAX_RERANK));
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { GEMINI_API_KEY: gk, SERPAPI_KEY: sk } = process.env;
  if (!gk || !sk) return res.status(501).json({ error: 'The search keys are not set up on the server yet.' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 3600e3); if (h.length >= 20) return res.status(429).json({ error: 'Too many searches this hour. Please try again later.' });
  h.push(now); hits.set(ip, h);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const img = splitDataUrl(body.image);
    if (!img) return res.status(400).json({ error: 'No image received.' });
    if (img.b64.length > 3e6) return res.status(413).json({ error: 'Image too large.' });
    const t0 = Date.now();
    const analysis = body.query ? { ...(body.analysis || {}), search_query: String(body.query).slice(0, 120) } : await analyse(gk, img, body.hints);
    const t1 = Date.now();
    let items = await imageSearch(sk, analysis.search_query);
    const t2 = Date.now();
    let reranked = false;
    if (items.length) { try { items = await rerank(gk, img, analysis, items); reranked = true; } catch (e) { /* keep search order if comparing fails */ } }
    res.status(200).json({ analysis, query: analysis.search_query, results: items.slice(0, 24), reranked, timing: { read: t1 - t0, search: t2 - t1, compare: Date.now() - t2 } });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
