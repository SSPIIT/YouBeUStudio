// YouBeU garment detection for uploaded photos (Vercel serverless function).
// Gemini finds the main garment: its box, shoulders, waist, hem, sleeves, and (when the model can) a segmentation mask.
// The browser then refines the exact garment pixels and does all the editing locally.
const { gemini, imgPart, splitDataUrl } = require('./_gemini.js');

const BASE = `You are a fashion image analyst. The image is a photo uploaded by a shopper who wants to edit the clothing in it.
Find the MAIN garment (the most prominent clothing item, e.g. dress, kurta, top, shirt, skirt, jumpsuit). If a person wears a full outfit, choose the dress/kurta/top that covers the torso.
Coordinates are normalized 0-1000 as [y, x] with (0,0) at the top-left of the image. "left"/"right" mean the left/right side OF THE IMAGE.
Return JSON only:
{"label": "short garment name, e.g. sleeveless A-line midi dress",
 "box_2d": [ymin, xmin, ymax, xmax],
 "shoulders": {"left": [y, x], "right": [y, x]} or null,
 "waist_y": number or null,
 "hem_y": number or null,
 "sleeves": "none|short|elbow|3/4|full",
 "worn_by_person": true or false,
 "background": "plain|scene"`;
const WITH_MASK = `,
 "mask": "segmentation mask of the garment inside box_2d as a base64 PNG data URL (probability 0-255 per pixel), or null"}`;

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const gk = process.env.GEMINI_API_KEY;
  if (!gk) return res.status(501).json({ error: 'The AI key is not set up on the server yet.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const img = splitDataUrl(body.image);
    if (!img) return res.status(400).json({ error: 'No image received.' });
    if (img.b64.length > 3e6) return res.status(413).json({ error: 'Image too large.' });
    let out;
    try { out = await gemini(gk, [{ text: BASE + WITH_MASK }, imgPart(img.mime, img.b64)]); }
    catch (e) { if (!/not JSON/.test(e.message)) throw e; out = await gemini(gk, [{ text: BASE + '}' }, imgPart(img.mime, img.b64)]); }
    if (!Array.isArray(out.box_2d) || out.box_2d.length !== 4) return res.status(422).json({ error: 'No garment found in this photo.' });
    if (out.mask && !/^data:image\/png;base64,/.test(out.mask)) out.mask = null;
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
