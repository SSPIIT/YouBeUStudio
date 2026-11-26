// Tiny Upstash Redis REST client (no dependencies). Works with the env names Vercel's Upstash/KV integration creates.
const URL_ = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const configured = () => !!(URL_() && TOKEN());

async function pipe(cmds) {
  const r = await fetch(URL_() + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN(), 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('Database error: ' + (j && j.error || r.status));
  return j.map(x => { if (x.error) throw new Error('Database error: ' + x.error); return x.result; });
}
const cmd = async (...c) => (await pipe([c]))[0];
module.exports = { pipe, cmd, configured };
