/* (24-10-2026, Mechanical's update-155 – the audit's R3 and P6) on the local test rig only (never a live database):
 *   – what the site has set up (masters, road, who does which work, people) is read once for several looks within 15 seconds,
 *     never for a save: a save – and the first look after it – reads it afresh;
 *   – a site's copy is never used for another site;
 *   – a write whose answer is lost (the database DID it) is not sent a second time: one master, and the person is told to look.
 * It starts an Engineering of its own (the tree in SRC, default this one) on :3041 against the rig (Portal :3010, rcl_eng on :3108).
 *   SRC=<engineering tree> node test/cache155.test.js */
'use strict';
const { execSync, spawn } = require('child_process'), path = require('path');
const SRC = process.env.SRC || path.join(__dirname, '..');
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3041', DOOR = 'http://127.0.0.1:3108';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function engAs(email, pw, site) {
  const p = client(P); const l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(E), t = ((await p.req('/api/go?module=engineering&site=' + site)).loc.split('#sso=')[1] || ''), r = await s.req('/api/sso', { ticket: t });
  return { r, eng: body => s.req('/api/eng', body) };
}
const meter = async reset => { const j = await (await fetch(DOOR + '/__meter')).json(); if (reset) await fetch(DOOR + '/__meter', { method: 'POST' }); return j; };
const reads = (m, t) => m.rows.filter(x => x.kind.indexOf('GET other ' + t + ' ') === 0).reduce((s, x) => s + x.calls, 0);
const fault = b => fetch(DOOR + '/__fault', { method: 'POST', body: JSON.stringify(b) });
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
(async () => {
  const srv = spawn('node', ['dev.js'], { cwd: SRC, env: Object.assign({}, process.env, { SUPABASE_URL: DOOR, SUPABASE_SECRET_KEY: 'sb_secret_rigkey', PORTAL_URL: P, PORT: '3041' }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(E + '/', { signal: AbortSignal.timeout(2000) })).status === 200) break; } catch (e) { /* starting */ } await wait(300); }
    sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('engineering', 'Engineering', 'http://127.0.0.1:3041', 'live', 3) on conflict (key) do update set url = excluded.url, status = 'live'; " +
      "delete from access where module = 'engineering'; insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'engineering', 'admin', 'test'), ('sujit@rcl.test', 'T2', 'engineering', 'admin', 'test');");
    sql('rcl_eng', 'truncate public.eng_roads, public.eng_masters, public.eng_assign, public.eng_people, public.eng_days, public.eng_reasons, public.eng_sessions, public.eng_tickets, public.eng_activity; alter sequence public.eng_masters_id_seq restart;');
    const SA = await engAs('sa@rcl.test', 'Super#Admin2040', 'S1'), AD = await engAs('sujit@rcl.test', 'Nashik#Road848!', 'S1'), AT = await engAs('sujit@rcl.test', 'Nashik#Road848!', 'T2');
    ok('signed in: the Super Admin and sujit on S1, sujit on T2', SA.r.status === 200 && AD.r.status === 200 && AT.r.status === 200, [SA.r.j.site, AD.r.j.site, AT.r.j.site]);
    const w = await SA.eng({ action: 'masterSave', kind: 'work', mode: 'new', valid_from: TODAY, data: { name: 'GSB', sort: 40, layers: [{ name: 'Layer 1', mm: 100 }] } });
    ok('a work saved on S1 (GSB)', w.status === 200 && w.j.item === 'W-001', w.j);
    await meter(true);
    const looks = []; for (let k = 0; k < 5; k++) looks.push(await AD.eng({ action: 'init' }));
    const m1 = await meter(true);
    ok('5 looks at S1 within 15 seconds: what the site has set up is read once (was 5 times)', looks.every(x => x.status === 200) && reads(m1, 'eng_masters') === 1 && reads(m1, 'eng_assign') === 1, { masters: reads(m1, 'eng_masters'), assign: reads(m1, 'eng_assign') });
    ok('   and every look has the work', looks.every(x => (x.j.masters || []).some(mm => mm.item === 'W-001')));
    const t2 = await AT.eng({ action: 'init' });
    ok('T2 is asked for its own: it does not get S1\'s work', t2.status === 200 && !(t2.j.masters || []).length, (t2.j.masters || []).map(mm => mm.item));
    await meter(true);
    const w2 = await SA.eng({ action: 'masterSave', kind: 'work', mode: 'new', valid_from: TODAY, data: { name: 'WMM', sort: 50, layers: [{ name: 'Layer 1', mm: 150 }] } });
    const m2 = await meter(true);
    ok('a save reads what the site has set up afresh (not the copy)', w2.status === 200 && w2.j.item === 'W-002' && reads(m2, 'eng_masters') === 1, { item: w2.j.item, reads: reads(m2, 'eng_masters') });
    const after = await AD.eng({ action: 'init' });
    ok('   the first look after the save shows it at once', (after.j.masters || []).some(mm => mm.item === 'W-002'), (after.j.masters || []).map(mm => mm.item));
    // a change straight in the database (another server's save): seen within 15 seconds
    sql('rcl_eng', "update eng_masters set data = jsonb_set(data, '{name}', '\"WMM Changed\"') where item = 'W-002'");
    await wait(15500);
    const later = await AD.eng({ action: 'init' });
    ok('a change made by another server: seen within 15 seconds', (later.j.masters || []).some(mm => mm.item === 'W-002' && mm.data.name === 'WMM Changed'), (later.j.masters || []).map(mm => mm.data && mm.data.name));
    // a write whose answer is lost: the database DID it – not sent again
    await fault({ match: '^POST /rest/v1/eng_masters', after: true, drop: true, n: 1 });
    const lost = await SA.eng({ action: 'masterSave', kind: 'work', mode: 'new', valid_from: TODAY, data: { name: 'Lost Answer Work', sort: 60 } });
    await fault({});
    const n = Number(sql('rcl_eng', "select count(*) from eng_masters where data->>'name' = 'Lost Answer Work'"));
    ok('a new work whose answer was lost on the way back (it WAS saved): saved once, and he is told to look first', n === 1 && lost.status === 503 && /may or may not have been saved/.test(String(lost.j.error || '')), { rows: n, status: lost.status, said: lost.j.error });
    await fault({ match: '^GET /rest/v1/eng_masters', drop: true, n: 1 });
    await wait(15500);
    const again = await AD.eng({ action: 'init' }); await fault({});
    ok('a look whose first read was lost: asked again by itself', again.status === 200 && (again.j.masters || []).length >= 3, { status: again.status, n: (again.j.masters || []).length });
  } catch (e) { ok('no crash', false, String(e && e.stack || e)); }
  finally { try { srv.kill(); } catch (e) {} try { await fault({}); } catch (e) {} }
  try { sql('rcl_portal', "update modules set url = 'http://127.0.0.1:3040' where key = 'engineering'"); } catch (e) {}
  out.forEach(x => console.log(x)); console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
