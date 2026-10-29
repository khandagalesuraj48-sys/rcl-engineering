/* (29-10-2026) A USER'S REPORT ONLY OF TODAY OR YESTERDAY – Engineering through its own doors, on the local test rig (never the live databases):
 *   the Portal :3010 gives the tickets (as a person opens Engineering from it), Engineering :3040, its database rcl_eng (:3108).
 *   Test passwords only. The rig in plain mode (PORTAL=1 bash rig/all.sh).      timeout 300 node test/api.test.js
 *   (ENG_KML=<the 18B KML> to set the real road)
 * The test sets its own start: Engineering in the Portal's modules, access given, two test people, the Engineering tables emptied. */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
function client(base) {
  let cookie = '';
  const req = async (p, body, opt) => {
    opt = opt || {}; const h = { 'Content-Type': 'application/json' }; if (!opt.noHeader) h['X-RCL'] = '1'; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
async function ticketFor(portal, mod, site) { const r = await portal.req('/api/go?module=' + mod + '&site=' + site); return (r.loc.split('#sso=')[1] || ''); }
async function engAs(email, pw, site) {
  const p = client(P); let l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200 && email === 'sa@rcl.test') l = await p.req('/api/auth', { action: 'login', email: email, password: 'Super#Admin2041' });      // (the Portal's own test, run first on the rig, leaves his password so)
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(E), t = await ticketFor(p, 'engineering', site), r = await s.req('/api/sso', { ticket: t });
  return { p, s, t, r, eng: body => s.req('/api/eng', body) };
}
const SAPW = 'Super#Admin2040', PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const Y = add(TODAY, -1), Y2 = add(TODAY, -2);


// (29-10-2026) an Engineering User's report only of today or yesterday – run on the rig with the rule ON, after api.test.js (its people
// and works stay); the Engineering Admin and the Super Admin any day
(async () => {
  const AD = await engAs('sujit@rcl.test', PW, 'S1'), U1 = await engAs('eng1@rcl.test', VPW, 'S1');
  const RULE = /a user sends the report of today or yesterday only – a report of an earlier day is sent only by the Engineering Admin or the Super Admin/;
  const D4 = add(TODAY, -4), D5 = add(TODAY, -5);
  const rep = (c, day, email) => c.eng({ action: 'reportSave', day: day, report: { note: 'rig 29-10' }, ver: 0, email: email });
  let r = await rep(U1, D4);
  ok('a User: the report of 4 days back refused – said why', r.status === 400 && RULE.test(r.j.error || '') && r.j.code === 'date', r.j);
  r = await U1.eng({ action: 'reportSave', day: TODAY, report: { note: 'rig 29-10 today' }, ver: 0 });
  ok('a User: the report of today – not refused for its day', !RULE.test(r.j.error || ''), r.j);
  r = await AD.eng({ action: 'reportSave', day: D5, report: { note: 'rig 29-10 admin' }, ver: 0 });
  ok('the Engineering Admin: his report of 5 days back – not refused for its day', !RULE.test(r.j.error || ''), r.j);
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack); process.exit(1); });
