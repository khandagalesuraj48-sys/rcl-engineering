/* THE ENGINEERING DATABASE – one Supabase project for EVERY site (every row carries its site; this server only reads and writes
 * the site of the person's sign-in). Its address and secret key are Vercel settings, never in a file:
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   – the Engineering project's (rcl-engineering) */
'use strict';
const { fail } = require('./http');
const { guard } = require('./preview');      // (21-10-2026) a Preview works only with the test database
const sleep = ms => new Promise(r => setTimeout(r, ms));
function conf() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(process.env.SUPABASE_SECRET_KEY || '');
  if (!url || !key) throw fail(500, 'The Engineering server is not set up: add SUPABASE_URL and SUPABASE_SECRET_KEY (the rcl-engineering Supabase project\'s) in Vercel → Environment Variables, then Redeploy.', 'setup');
  return { url, key };
}
const enc = v => encodeURIComponent(String(v === undefined || v === null ? '' : v));
// one REST call (3 tries on a network fault or a busy database); the answer's rows, or null
async function db(method, path, body, prefer) {
  const c = conf();
  await guard(c);
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch (e) { last = String((e && e.message) || e); await sleep(300 * (i + 1)); continue; }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status >= 500 || r.status === 429) { await sleep(400 * (i + 1)); continue; }
    if ((r.status === 404 || r.status === 400) && /PGRST205|42P01|Could not find the table/i.test(t)) throw fail(500, 'The Engineering database is not set up yet: the Super Admin runs sql/eng_step1.sql once in the rcl-engineering Supabase → SQL Editor.', 'notinstalled');
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    if (r.status === 401 || r.status === 403) throw fail(500, 'The Engineering database refused the key – check SUPABASE_SECRET_KEY in Vercel.', 'key');
    throw fail(500, 'Database: ' + last);
  }
  throw fail(503, 'Could not reach the Engineering database – please try again in a moment.', 'net');
}
module.exports = { db, enc };
