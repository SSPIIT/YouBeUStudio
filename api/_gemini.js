// Shared Gemini helper: tries current models in order and falls back when one is busy, rate-limited or retired.
let goodModel = null; // remember which model name works so later calls skip the failures
const MODELS = () => [goodModel, process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'].filter((m, i, a) => m && a.indexOf(m) === i);
async function gemini(key, parts, opts = {}) {
  const errs = [];
  // Busy (503), rate-limited (429) or missing (404) models fall through to the next model; each gets one retry when busy.
  const list = opts.models ? opts.models.concat(MODELS().filter(m => !opts.models.includes(m))) : MODELS();
  for (const model of list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        goodModel = model;
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        try { return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new Error('Gemini returned something that is not JSON'); }
      }
      errs.push(`${model}: ${r.status} ${(j.error?.message || '').slice(0, 80)}`);
      if (goodModel === model) goodModel = null;
      if (r.status === 503 && attempt === 0) { await new Promise(s => setTimeout(s, 1200)); continue; }
      if ([404, 429, 500, 503].includes(r.status)) break; // try the next model
      throw new Error(`Gemini ${r.status}: ${j.error?.message || 'request failed'}`);
    }
  }
  throw new Error('Gemini is busy right now. Please try again in a minute. (' + errs.slice(-2).join(' | ') + ')');
}

const imgPart = (mime, b64) => ({ inline_data: { mime_type: mime, data: b64 } });
function splitDataUrl(d) { const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(d || ''); return m ? { mime: m[1], b64: m[2] } : null; }

module.exports = { gemini, imgPart, splitDataUrl };
