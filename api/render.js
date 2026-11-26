// YouBeU "See it on a model": turns a design into a realistic photo of a model wearing it.
// 1) Gemini (free) studies the design and writes a precise garment description.
// 2) FLUX.2 on Cloudflare Workers AI (free daily allowance) generates the photo, using the design itself as a reference image.
// Keys: GEMINI_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN (server-side only).
const { gemini, imgPart, splitDataUrl } = require('./_gemini.js');

const MODELS = ['@cf/black-forest-labs/flux-2-klein-4b', '@cf/black-forest-labs/flux-2-klein-9b', '@cf/black-forest-labs/flux-2-dev'];
const SKIN = { light: 'fair', wheatish: 'wheatish', medium: 'medium brown', deep: 'deep brown' };
const POSE = { front: 'standing facing the camera, full length, arms relaxed', walk: 'walking towards the camera, full length, natural stride', three: 'standing at a three-quarter angle, full length, one hand on hip' };
const SET = { studio: 'plain light-grey photo studio background, soft even studio lighting', street: 'a sunny city street with soft background blur', festive: 'an elegant festive venue with warm fairy lights and soft background blur', garden: 'a green garden with soft natural daylight and background blur' };
const hits = new Map();

async function describe(gk, img, hints) {
  return gemini(gk, [{ text: `You are a fashion designer writing a brief for a photographer. The image is a shopper's garment design (a sketch, a filled flat sketch, or an edited photo). App hints: ${JSON.stringify(hints || {})}
Describe ONLY what is visible, precisely enough that a model can be dressed in exactly this garment. Return JSON only:
{"garment": "one detailed sentence: garment type, silhouette, length, sleeves, neckline, exact colours, print (motif, size, colour on what background), and any visible details",
 "category": "upper | dress | bottom | full outfit",
 "pairing": "what simple plain item to pair it with so the outfit is complete, e.g. 'plain white straight trousers' (empty string if the garment is a full dress or outfit)"}` }, imgPart(img.mime, img.b64)]);
}

async function flux(acct, token, prompt, ref) {
  const errs = [];
  for (const model of MODELS) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', '768'); form.append('height', '1024');
    if (ref) form.append('input_image_0', new Blob([Buffer.from(ref.b64, 'base64')], { type: ref.mime }), 'design.' + (ref.mime.split('/')[1] || 'jpg'));
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form });
    const j = await r.json().catch(() => ({}));
    const image = j.result?.image || j.image;
    if (r.ok && image) return { image: 'data:image/jpeg;base64,' + image.replace(/^data:image\/\w+;base64,/, ''), model };
    const msg = (j.errors || []).map(e => e.message).join('; ') || ('HTTP ' + r.status);
    errs.push(`${model.split('/').pop()}: ${msg.slice(0, 120)}`);
    if (r.status === 401 || r.status === 403) throw new Error('Cloudflare refused the token. Check CF_ACCOUNT_ID and CF_API_TOKEN in Vercel.');
    if (/daily|limit|quota|neuron/i.test(msg)) throw new Error("Today's free image allowance is used up. It resets daily, so please try again tomorrow.");
  }
  throw new Error('Image generation failed (' + errs.join(' | ') + ')');
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { GEMINI_API_KEY: gk, CF_ACCOUNT_ID: acct, CF_API_TOKEN: token } = process.env;
  if (!gk || !acct || !token) return res.status(501).json({ error: 'Image generation is not set up on the server yet (Cloudflare keys missing).' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 3600e3); if (h.length >= 15) return res.status(429).json({ error: 'Too many images this hour. Please try again later.' });
  h.push(now); hits.set(ip, h);
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const img = splitDataUrl(body.image), ref = splitDataUrl(body.ref || body.image);
    if (!img) return res.status(400).json({ error: 'No design received.' });
    if (img.b64.length > 3e6) return res.status(413).json({ error: 'Image too large.' });
    const o = body.options || {};
    const who = o.model === 'man' ? 'an adult Indian man' : 'an adult Indian woman';
    const d = body.desc || await describe(gk, img, body.hints);
    const prompt = `Photorealistic full-length fashion catalogue photograph of ${who} with ${SKIN[o.skin] || 'wheatish'} skin, ${POSE[o.pose] || POSE.front}, wearing ${d.garment}${d.pairing ? ', paired with ' + d.pairing : ''}. ` +
      `The garment must match the design in the reference image exactly: same garment type, silhouette, length, sleeves, neckline, colours and print. Realistic fabric with natural folds and texture. ` +
      `${SET[o.setting] || SET.studio}. Sharp focus, high detail, professional e-commerce photo, face fully visible, modest and tasteful.`;
    const out = await flux(acct, token, prompt, ref);
    res.status(200).json({ image: out.image, model: out.model, desc: d, prompt });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
