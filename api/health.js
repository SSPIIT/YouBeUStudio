// Self-check: confirms both keys are set and working, without revealing them.
// GET /api/health        -> key presence + a tiny Gemini call + SerpAPI account status (uses no search credits)
// GET /api/health?search=1 -> also runs one real store search (uses 1 SerpAPI search)
module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const out = { gemini_key_set: !!process.env.GEMINI_API_KEY, serpapi_key_set: !!process.env.SERPAPI_KEY };
  const gk = process.env.GEMINI_API_KEY, sk = process.env.SERPAPI_KEY;
  if (gk) {
    const models = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'].filter(Boolean);
    out.gemini = { tried: [] };
    for (const m of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': gk }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }] }) });
        const j = await r.json().catch(() => ({}));
        out.gemini.tried.push({ model: m, status: r.status, error: j.error?.message?.slice(0, 160) });
        if (r.ok) { out.gemini.ok = true; out.gemini.model = m; out.gemini.reply = (j.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().slice(0, 20); break; }
        if (![404, 429, 500, 503].includes(r.status)) break;
      } catch (e) { out.gemini.tried.push({ model: m, error: String(e.message).slice(0, 160) }); break; }
    }
  }
  if (sk) {
    try {
      const r = await fetch('https://serpapi.com/account.json?api_key=' + encodeURIComponent(sk)); const j = await r.json().catch(() => ({}));
      out.serpapi = r.ok && !j.error ? { ok: true, plan: j.plan_name, searches_left: j.total_searches_left ?? j.plan_searches_left, used_this_month: j.this_month_usage } : { ok: false, status: r.status, error: j.error };
    } catch (e) { out.serpapi = { ok: false, error: String(e.message).slice(0, 160) }; }
    if (req.query?.search === '1' || /[?&]search=1/.test(req.url || '')) {
      try {
        const q = 'maroon floral straight kurta women (site:myntra.com OR site:amazon.in OR site:flipkart.com OR site:meesho.com OR site:ajio.com)';
        const u = 'https://serpapi.com/search.json?' + new URLSearchParams({ engine: 'google_images', q, gl: 'in', hl: 'en', api_key: sk });
        const r = await fetch(u); const j = await r.json().catch(() => ({}));
        const items = (j.images_results || []).slice(0, 20).map(i => ({ title: (i.title || '').slice(0, 70), link: i.link }));
        out.sample_search = { ok: r.ok && !j.error, error: j.error, count: (j.images_results || []).length, first: items };
      } catch (e) { out.sample_search = { ok: false, error: String(e.message).slice(0, 160) }; }
    }
  }
  out.ready = !!(out.gemini?.ok && out.serpapi?.ok);
  res.status(200).json(out);
};
