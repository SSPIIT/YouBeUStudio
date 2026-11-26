// YouBeU weekly design challenge: entries, votes, points, badges, leaderboard, hall of fame.
// Storage: Upstash Redis (env set by Vercel's Upstash integration). Images are stored once and served from ?a=img.
const { pipe, cmd, configured } = require('./_store.js');
const { gemini, imgPart, splitDataUrl } = require('./_gemini.js');

const THEMES = [
  ['Monsoon Ready', 'Light, quick-dry and cheerful: a rainy-day outfit you would actually wear.'],
  ['Diwali Glow', 'A festive look for Diwali night: rich colours, a little sparkle.'],
  ['Office, Reimagined', 'Workwear that is comfortable, smart and still has personality.'],
  ['Block Print Love', 'Celebrate Indian block prints in a modern silhouette.'],
  ['Wedding Guest', 'Stand out at a friend\'s sangeet without upstaging the bride.'],
  ['Campus Casual', 'An everyday college outfit: easy, fresh, budget-friendly.'],
  ['Summer Whites', 'Breezy whites and pastels for 40°C days.'],
  ['Upcycle It', 'Restyle an old garment: change the length, sleeves, colour or print.'],
  ['Street Style Mumbai', 'Bold, urban and made for the local train.'],
  ['Handloom Heritage', 'Ikat, khadi, chanderi: handloom, styled for today.'],
  ['Date Night', 'Elegant evening wear for a dinner out.'],
  ['Travel Light', 'One outfit that works from airport to sightseeing to dinner.'],
];
const IST = 5.5 * 3600e3, DAY = 86400e3, EPOCH = Date.UTC(2026, 0, 5); // a Monday
function weekOf(t = Date.now()) { // weeks run Monday 00:00 to Sunday 23:59 India time
  const ist = t + IST, d = new Date(ist), dow = (d.getUTCDay() + 6) % 7;
  const monIst = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY;
  const id = new Date(monIst).toISOString().slice(0, 10), n = Math.round((monIst - EPOCH) / (7 * DAY));
  const th = THEMES[((n % THEMES.length) + THEMES.length) % THEMES.length];
  return { id, theme: th[0], brief: th[1], startsAt: monIst - IST, endsAt: monIst - IST + 7 * DAY };
}
const prevWeek = (w) => weekOf(w.startsAt - 1000);
const BADGES = [
  ['challenger', 'Challenger', 'Enter your first challenge'],
  ['voter', 'Fair Judge', 'Vote on 20 designs'],
  ['crowd', 'Crowd Favourite', 'Get 10 votes on one design'],
  ['streak', 'On a Roll', 'Enter 3 weeks in a row'],
  ['star', 'Rising Star', 'Reach 100 points'],
  ['trend', 'Trendsetter', 'Finish in the top 3 of a week'],
  ['champ', 'Champion', 'Win a weekly challenge'],
];
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const okUid = (u) => /^[a-z0-9]{12,40}$/i.test(u || '');
const imgUrl = (id, kind) => `api/challenge?a=img&id=${id}&k=${kind}`;

async function finalize(week) { // award the top 3 of a finished week, once
  const got = await cmd('SET', `fin:${week.id}`, '1', 'NX'); if (got !== 'OK') return;
  const top = await cmd('ZREVRANGE', `wk:${week.id}`, '0', '2', 'WITHSCORES');
  const winners = [];
  for (let i = 0; i < top.length; i += 2) {
    const votes = +top[i + 1]; if (votes <= 0) break;
    const e = JSON.parse(await cmd('GET', `e:${top[i]}`) || 'null'); if (!e) continue;
    winners.push({ id: e.id, title: e.title, name: e.name, votes, place: winners.length + 1 });
    const pts = winners.length === 1 ? 100 : 50;
    await pipe([['ZINCRBY', 'lb:all', String(pts), e.uid], ['ZINCRBY', `lb:${week.id}`, String(pts), e.uid], ['HINCRBY', `us:${e.uid}`, winners.length === 1 ? 'wins' : 'top3', '1'], ...(winners.length === 1 ? [['HINCRBY', `us:${e.uid}`, 'top3', '1']] : [])]);
  }
  if (winners.length) await cmd('LPUSH', 'hof', JSON.stringify({ week: week.id, theme: week.theme, winners }));
}
function streakOf(weeks) { const set = new Set(weeks); let w = weekOf(), n = 0; if (!set.has(w.id)) w = prevWeek(w); while (set.has(w.id)) { n++; w = prevWeek(w); } return n; }
async function profile(uid) {
  const [name, pts, st, weeks, mine] = await pipe([['GET', `un:${uid}`], ['ZSCORE', 'lb:all', uid], ['HGETALL', `us:${uid}`], ['SMEMBERS', `uw:${uid}`], ['LRANGE', `ue:${uid}`, '0', '49']]);
  const s = {}; for (let i = 0; i < (st || []).length; i += 2) s[st[i]] = +st[i + 1];
  const points = +(pts || 0), streak = streakOf(weeks || []);
  const has = { challenger: (s.entries || 0) >= 1, voter: (s.votesGiven || 0) >= 20, crowd: (s.crowd || 0) >= 1, streak: streak >= 3, star: points >= 100, trend: (s.top3 || 0) >= 1, champ: (s.wins || 0) >= 1 };
  return { uid, name, points, streak, stats: s, badges: BADGES.map(([id, n, how]) => ({ id, name: n, how, earned: !!has[id] })), entryIds: mine || [] };
}
async function entriesByIds(ids, uid) {
  if (!ids.length) return [];
  const raw = await pipe(ids.map(id => ['GET', `e:${id}`]));
  const extra = await pipe(ids.flatMap(id => [['SCARD', `v:${id}`], ['SISMEMBER', `v:${id}`, uid || '-']]));
  return raw.map((r, i) => { const e = r && JSON.parse(r); if (!e) return null; return { id: e.id, week: e.week, title: e.title, name: e.name, note: e.note, fit: e.fit, created: e.created, photo: imgUrl(e.id, 'p'), design: imgUrl(e.id, 'd'), votes: +extra[i * 2], votedByMe: !!extra[i * 2 + 1], mine: e.uid === uid }; }).filter(Boolean);
}
async function stylist(gk, photo, week) {
  const timeout = new Promise(r => setTimeout(() => r(null), 15000)); // never hold up a submission for the note
  const ask = gemini(gk, [{ text: `You are a warm, encouraging fashion stylist judging a weekly design challenge. Theme: "${week.theme}": ${week.brief}
The image shows a shopper's design on a model. Return JSON only: {"fit": 0-100 (how well it fits the theme), "note": "one or two short, specific, friendly sentences about the design and how it fits the theme"}` }, imgPart(photo.mime, photo.b64)], { models: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'] }).catch(() => null);
  return Promise.race([ask, timeout]);
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!configured()) return res.status(501).json({ error: 'The challenge database is not connected yet.' });
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
  const a = q.a || body.a, uid = okUid(body.uid || q.uid) ? (body.uid || q.uid) : null;
  try {
    const week = weekOf(); await finalize(prevWeek(week)).catch(() => {});

    if (a === 'img') { // serve a stored image
      const b64 = await cmd('GET', `${q.k === 'd' ? 'dsg' : 'img'}:${clean(q.id, 40)}`);
      if (!b64) return res.status(404).end();
      res.setHeader('content-type', 'image/jpeg'); res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      return res.status(200).end(Buffer.from(b64, 'base64'));
    }
    if (a === 'week') {
      const ids = await cmd('ZREVRANGE', `wk:${week.id}`, '0', '59');
      const entries = (await entriesByIds(ids, uid)).sort((x, y) => y.votes - x.votes || x.created - y.created);
      return res.json({ week, entries, me: uid ? await profile(uid) : null });
    }
    if (a === 'leaderboard') {
      const key = q.scope === 'week' ? `lb:${week.id}` : 'lb:all';
      const top = await cmd('ZREVRANGE', key, '0', '19', 'WITHSCORES'); const rows = [];
      for (let i = 0; i < top.length; i += 2) rows.push({ uid: top[i], points: +top[i + 1] });
      const names = rows.length ? await pipe(rows.map(r => ['GET', `un:${r.uid}`])) : [];
      const counts = rows.length ? await pipe(rows.map(r => ['HGET', `us:${r.uid}`, 'entries'])) : [];
      return res.json({ scope: q.scope === 'week' ? 'week' : 'all', week, rows: rows.map((r, i) => ({ name: names[i] || 'Designer', points: r.points, entries: +(counts[i] || 0), me: r.uid === uid })).filter(r => r.points > 0) });
    }
    if (a === 'hof') {
      const list = (await cmd('LRANGE', 'hof', '0', '19')).map(s => JSON.parse(s));
      for (const w of list) for (const x of w.winners) { x.photo = imgUrl(x.id, 'p'); x.design = imgUrl(x.id, 'd'); }
      return res.json({ weeks: list });
    }
    if (a === 'me') {
      if (!uid) return res.status(400).json({ error: 'Missing user.' });
      const p = await profile(uid); p.entries = await entriesByIds(p.entryIds, uid); delete p.entryIds; return res.json(p);
    }
    if (req.method !== 'POST') return res.status(400).json({ error: 'Unknown request.' });
    if (!uid) return res.status(400).json({ error: 'Missing user.' });

    if (a === 'name') {
      const name = clean(body.name, 24); if (name.length < 2) return res.status(400).json({ error: 'Please choose a nickname of at least 2 characters.' });
      await cmd('SET', `un:${uid}`, name); return res.json({ ok: true, name });
    }
    if (a === 'submit') {
      const photo = splitDataUrl(body.photo), design = splitDataUrl(body.design), title = clean(body.title, 60), name = clean(body.name, 24);
      if (!photo || !design) return res.status(400).json({ error: 'The photo or the design is missing.' });
      if (photo.b64.length > 600e3 || design.b64.length > 300e3) return res.status(413).json({ error: 'Images too large.' });
      if (!title) return res.status(400).json({ error: 'Please give your design a title.' });
      if (name.length >= 2) await cmd('SET', `un:${uid}`, name);
      const myName = await cmd('GET', `un:${uid}`); if (!myName) return res.status(400).json({ error: 'Please choose a nickname first.' });
      const n = await cmd('INCR', `sub:${uid}:${week.id}`); await cmd('EXPIRE', `sub:${uid}:${week.id}`, String(8 * 86400));
      if (n > 3) return res.status(429).json({ error: 'You can enter up to 3 designs per week.' });
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const e = { id, week: week.id, uid, name: myName, title, created: Date.now(), fit: null, note: '' };
      await pipe([['SET', `e:${id}`, JSON.stringify(e)], ['SET', `img:${id}`, photo.b64], ['SET', `dsg:${id}`, design.b64], ['ZADD', `wk:${week.id}`, '0', id], ['LPUSH', `ue:${uid}`, id],
        ['HINCRBY', `us:${uid}`, 'entries', '1'], ['SADD', `uw:${uid}`, week.id], ['ZINCRBY', 'lb:all', '20', uid], ['ZINCRBY', `lb:${week.id}`, '20', uid]]);
      const st = process.env.GEMINI_API_KEY ? await stylist(process.env.GEMINI_API_KEY, photo, week) : null;
      if (st) { e.fit = Number.isFinite(+st.fit) ? Math.max(0, Math.min(100, Math.round(+st.fit))) : null; e.note = clean(st.note, 280); await cmd('SET', `e:${id}`, JSON.stringify(e)); }
      return res.json({ ok: true, entry: (await entriesByIds([id], uid))[0], week });
    }
    if (a === 'vote') {
      const id = clean(body.id, 40), e = JSON.parse(await cmd('GET', `e:${id}`) || 'null');
      if (!e) return res.status(404).json({ error: 'That design no longer exists.' });
      if (e.week !== week.id) return res.status(400).json({ error: 'Voting for that week has closed.' });
      if (e.uid === uid) return res.status(400).json({ error: "You can't vote for your own design." });
      const had = await cmd('SISMEMBER', `v:${id}`, uid);
      if (had) { // take the vote back
        await pipe([['SREM', `v:${id}`, uid], ['ZINCRBY', `wk:${week.id}`, '-1', id], ['ZINCRBY', 'lb:all', '-5', e.uid], ['ZINCRBY', `lb:${week.id}`, '-5', e.uid]]);
      } else {
        const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
        const [, votes, , , given] = await pipe([['SADD', `v:${id}`, uid], ['ZINCRBY', `wk:${week.id}`, '1', id], ['ZINCRBY', 'lb:all', '5', e.uid], ['ZINCRBY', `lb:${week.id}`, '5', e.uid], ['INCR', `vd:${uid}:${today}`], ['EXPIRE', `vd:${uid}:${today}`, '172800'], ['HINCRBY', `us:${uid}`, 'votesGiven', '1']]);
        if (+given <= 10) await pipe([['ZINCRBY', 'lb:all', '1', uid], ['ZINCRBY', `lb:${week.id}`, '1', uid]]);
        if (+votes >= 10) await cmd('HSET', `us:${e.uid}`, 'crowd', '1');
      }
      const votes = await cmd('SCARD', `v:${id}`);
      return res.json({ ok: true, id, votes: +votes, votedByMe: !had });
    }
    return res.status(400).json({ error: 'Unknown request.' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
module.exports.weekOf = weekOf;
