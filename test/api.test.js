/* Engineering through its own doors, on the local test rig (never the live databases):
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

(async () => {
  // ---- the start ----
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('engineering', 'Engineering', 'http://127.0.0.1:3040', 'live', 3) on conflict (key) do update set url = excluded.url, status = 'live'; " +
    "insert into users (email, name, password_hash) select 'eng1@rcl.test', 'Engineer One', password_hash from users where email = 'view@rcl.test' on conflict (email) do update set password_hash = excluded.password_hash, name = excluded.name; " +
    "insert into users (email, name, password_hash) select 'eng2@rcl.test', 'Engineer Two', password_hash from users where email = 'view@rcl.test' on conflict (email) do update set password_hash = excluded.password_hash, name = excluded.name; " +
    "delete from access where module = 'engineering'; insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'engineering', 'admin', 'test'), ('sujit@rcl.test', 'T2', 'engineering', 'user', 'test'), ('eng1@rcl.test', 'S1', 'engineering', 'user', 'test'), ('eng2@rcl.test', 'S1', 'engineering', 'user', 'test'); delete from counters;");
  sql('rcl_eng', 'truncate public.eng_roads, public.eng_masters, public.eng_assign, public.eng_people, public.eng_days, public.eng_reasons, public.eng_sessions, public.eng_tickets, public.eng_activity; alter sequence public.eng_masters_id_seq restart;');

  // ---- sign-in through the Portal ----
  const SA = await engAs('sa@rcl.test', SAPW, 'S1'), AD = await engAs('sujit@rcl.test', PW, 'S1'), U1 = await engAs('eng1@rcl.test', VPW, 'S1'), U2 = await engAs('eng2@rcl.test', VPW, 'S1');
  ok('the Super Admin opens Engineering on S1 from the Portal: role "super"', SA.r.status === 200 && SA.r.j.user.role === 'super' && SA.r.j.site === 'S1', SA.r.j);
  ok('sujit: Engineering Admin of S1; eng1 and eng2: Users', AD.r.j.user.role === 'admin' && U1.r.j.user.role === 'user' && U2.r.j.user.role === 'user', [AD.r.j, U1.r.j]);
  ok('   only a fingerprint of each sign-in is kept; the cookie cannot be read by page scripts', sql('rcl_eng', "select count(*) from eng_sessions where length(id_hash) = 64") === '4' && /^rcl_eng=/.test(U1.s.cookie));
  ok('   everyone who signed in is on the site\'s list of people (name from the Portal)', sql('rcl_eng', "select string_agg(email || ':' || name || ':' || role, ',' order by email) from eng_people where site = 'S1'") === 'eng1@rcl.test:Engineer One:user,eng2@rcl.test:Engineer Two:user,sa@rcl.test:Owner:super,sujit@rcl.test:Sujit:admin');
  let r = await client(E).req('/api/sso', { ticket: U1.t });
  ok('the same ticket again: refused (a ticket opens Engineering once)', r.status === 401 && /already used/.test(r.j.error), r.j);
  r = await client(E).req('/api/sso', { ticket: await ticketFor(U1.p, 'mechanical', 'S1') });
  ok('a ticket made for another module: refused', r.status === 401 && /another module|no access|not/i.test(r.j.error || ''), r);
  r = await client(E).req('/api/sso', { ticket: await ticketFor(U1.p, 'engineering', 'S1') }, { noHeader: true });
  ok('a request not from the Engineering page (no header): refused', r.status === 403, r.j);
  r = await client(E).req('/api/eng', { action: 'init' });
  ok('no sign-in: every action is refused (SESSION_EXPIRED)', r.status === 401 && r.j.code === 'session', r.j);
  r = await U1.s.req('/api/me');
  ok('/api/me: who, which site, which role', r.j.signedIn && r.j.site === 'S1' && r.j.user.role === 'user' && r.j.portal === P, r.j);
  // ---- the menu for the screen around it ----
  const menu = async c => ((await c.req('/menu.json')).j.pages || []).map(p => p.key).join(',');
  ok('menu.json: a User sees My work and the Strip chart', await menu(U1.s) === 'mywork,strip');
  ok('   the Admin also the dashboard, reports and performance; the Super Admin also the set-up', await menu(AD.s) === 'mywork,dashboard,strip,allreports,reports,perf' && await menu(SA.s) === 'mywork,dashboard,strip,allreports,reports,perf,setup');
  ok('   nobody signed in yet: every page (the page opens only what he has)', await menu(client(E)) === 'mywork,dashboard,strip,allreports,reports,perf,setup');

  // ---- SET-UP: only the Super Admin ----
  let stations = [];
  if (process.env.ENG_KML && fs.existsSync(process.env.ENG_KML)) stations = require('../public/kml.js').parse(fs.readFileSync(process.env.ENG_KML, 'utf8')).stations;
  else for (let c = 8000; c <= 61055; c += 20) stations.push([c, 74 - (c - 8000) / 300000, 16.69 - (c - 8000) / 200000]);
  if (stations[stations.length - 1][0] !== 61055) stations.push([61055, 73.96, 16.41]);
  r = await AD.eng({ action: 'roadSave', name: 'NH 18B', stations: stations });
  ok('the Admin cannot set the road (Super Admin only)', r.status === 403 && r.j.code === 'access', r.j);
  r = await SA.eng({ action: 'roadSave', name: 'Package 18B', stations: stations, source: 'ACAD-PN-II-18B_WITH_CHAINAGES.kml' });
  ok('the Super Admin sets the road from the KML: 8+000 to 61+055', r.status === 200 && r.j.road.ch_from === 8000 && r.j.road.ch_to === 61055 && r.j.points === stations.length, r.j);
  r = await SA.eng({ action: 'roadSave', stations: [[8000, 74, 16], [7990, 74, 16.1]] });
  ok('   chainages that do not go one way: refused', r.status === 400 && /one way/.test(r.j.error), r.j);
  const ms = (who, x) => who.eng(Object.assign({ action: 'masterSave' }, x));
  const F0 = add(TODAY, -40);
  for (const [n, w] of [['LHS', 7.5], ['Median', 2], ['RHS', 7.5]]) { r = await ms(SA, { kind: 'side', mode: 'new', valid_from: F0, data: { name: n, from: 8000, to: 61055, width: w } }); ok('a side: ' + n + ' 8+000–61+055, width ' + w + ' m (from ' + F0 + ')', r.status === 200 && /^S-00\d$/.test(r.j.item), r.j); }
  r = await ms(SA, { kind: 'side', mode: 'new', valid_from: F0, data: { name: 'LHS', from: 20000, to: 30000, width: 8 } });
  ok('   a second width of LHS on the same place in the same period: refused', r.status === 409 && /already has a width/.test(r.j.error), r.j);
  r = await ms(SA, { kind: 'side', mode: 'new', valid_from: F0, data: { name: 'RHS', from: 60000, to: 62000, width: 8 } });
  ok('   a stretch outside the road: refused', r.status === 400 && /road runs from 8\+000 to 61\+055/.test(r.j.error), r.j);
  const work = async (name, data) => { const x = await ms(SA, { kind: 'work', mode: 'new', valid_from: F0, data: Object.assign({ name: name }, data) }); return x.j.item; };
  const EMB = await work('Embankment', { sort: 20, layers: [{ name: 'Layer 1', mm: 200 }, { name: 'Top', mm: 200 }] });
  const SUB = await work('Subgrade', { sort: 30, layers: [{ name: 'Layer 1', mm: 250 }, { name: 'Top / final', mm: 250 }] });
  const GSB = await work('GSB', { sort: 40, layers: [{ name: 'Layer 1', mm: 100 }] });
  const CUL = await work('Culvert', { unit: 'Nos', strip: false, sort: 90 });
  ok('works with their layers and thickness: Embankment, Subgrade, GSB, Culvert (Nos)', [EMB, SUB, GSB, CUL].join() === 'W-001,W-002,W-003,W-004' && sql('rcl_eng', "select data->'layers'->1->>'name' || '/' || (data->'layers'->1->>'mm') from eng_masters where item = 'W-001'") === 'Top/200', [EMB, SUB, GSB, CUL]);
  r = await ms(SA, { kind: 'work', mode: 'new', valid_from: F0, data: { name: 'gsb' } });
  ok('   the same work name again: refused', r.status === 409 && /already there \(W-003\)/.test(r.j.error), r.j);
  r = await ms(AD, { kind: 'work', mode: 'new', valid_from: F0, data: { name: 'Kerb' } });
  ok('   the Admin cannot add a work', r.status === 403, r.j);
  // a new period: GSB gets a second layer from today; the period before ends yesterday – the past keeps its one layer
  const gsbRow = Number(sql('rcl_eng', "select id from eng_masters where item = 'W-003'"));
  r = await ms(SA, { kind: 'work', mode: 'period', item: GSB, valid_from: TODAY, data: { name: 'GSB', sort: 40, layers: [{ key: 'L1', name: 'Layer 1', mm: 100 }, { name: 'Layer 2', mm: 100 }] } });
  ok('a new period of GSB from today: the one before ends yesterday, nothing before it changes', r.status === 200 && sql('rcl_eng', "select string_agg(valid_from || '..' || coalesce(valid_to::text, '') || ':' || jsonb_array_length(data->'layers'), ',' order by valid_from) from eng_masters where item = 'W-003'") === F0 + '..' + Y + ':1,' + TODAY + '..:2', r.j);
  r = await ms(SA, { kind: 'work', mode: 'edit', id: gsbRow, valid_from: F0, valid_to: TODAY, data: { name: 'GSB', layers: [{ key: 'L1', name: 'Layer 1' }] } });
  ok('   an edit that would overlap the next period: refused', r.status === 409 && /overlaps/.test(r.j.error), r.j);
  r = await ms(SA, { kind: 'mix', mode: 'new', valid_from: TODAY, data: { name: 'PQC M40', grade: 'M40', per: 'per cum', rows: [{ label: 'Cement', value: '420', unit: 'kg' }, { label: 'Water', value: '155', unit: 'ltr' }] } });
  ok('a mix design (filled by the Super Admin, applies from its date)', r.status === 200 && r.j.item === 'M-001' && r.j.saved.data.rows.length === 2, r.j);
  r = await ms(SA, { kind: 'design', mode: 'new', valid_from: TODAY, data: { name: 'Dowel bar', rows: [{ label: 'Dia', value: '32', unit: 'mm' }] } });
  ok('a design', r.status === 200 && r.j.item === 'D-001', r.j);
  const cul = Number(sql('rcl_eng', "select id from eng_masters where item = 'W-004'"));
  r = await SA.eng({ action: 'masterActive', id: cul, active: false });
  ok('a work made Inactive (like machinery) – and Active again', r.status === 200 && sql('rcl_eng', 'select active from eng_masters where id = ' + cul) === 'f' && (await SA.eng({ action: 'masterActive', id: cul, active: true })).status === 200);
  // ---- people and their works ----
  r = await SA.eng({ action: 'personAdd', email: 'new.engineer@rcl.test', name: 'New Engineer' });
  ok('a person added before his first sign-in', r.status === 200 && sql('rcl_eng', "select added_by from eng_people where email = 'new.engineer@rcl.test'") === 'sa@rcl.test', r.j);
  r = await SA.eng({ action: 'assignSave', email: 'eng1@rcl.test', works: [EMB, SUB, CUL] });
  ok('eng1 is given three works (more than one is fine)', r.status === 200 && r.j.changed.length === 3, r.j);
  r = await SA.eng({ action: 'assignSave', email: 'eng2@rcl.test', works: [GSB] });
  ok('eng2 is given GSB', r.status === 200, r.j);
  r = await AD.eng({ action: 'assignSave', email: 'eng2@rcl.test', works: [GSB, EMB] });
  ok('   the Admin cannot give works', r.status === 403, r.j);
  sql('rcl_eng', "update eng_assign set created_at = now() - interval '30 days'");      // (given a month ago – the days before today count)

  // ---- A PERSON'S DAY: the plan ----
  const plan = (c, day, lines, ver, email) => c.eng({ action: 'planSave', day: day, lines: lines, ver: ver || 0, email: email });
  r = await plan(U1, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: '50+310', to: '51+010' }, { work: CUL, qty: 1 }]);
  ok('eng1 makes his plan for today: Embankment Layer 1 RHS 50+310 → 51+010 (700 m), 1 culvert', r.status === 200 && r.j.doc.plan.length === 2 && r.j.doc.plan[0].qty === 700 && r.j.doc.ver === 1, r.j);
  const v1 = r.j.doc.ver;
  r = await plan(U1, TODAY, [{ work: GSB, layer: 'L1', side: 'LHS', from: 9000, to: 9200 }], v1);
  ok('   a work not given to him: refused', r.status === 403 && /not given to you/.test(r.j.error), r.j);
  r = await plan(U1, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: 51010, to: 50310 }], v1);
  ok('   "to" before "from": refused', r.status === 400 && /must be after/.test(r.j.error), r.j);
  r = await plan(U1, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: 61000, to: 62000 }], v1);
  ok('   outside the road: refused', r.status === 400 && /road runs/.test(r.j.error), r.j);
  r = await plan(U1, Y, [{ work: EMB, layer: 'L1', side: 'RHS', from: 50000, to: 50100 }]);
  ok('   a plan for a day gone by: refused (report it outside the plan instead)', r.status === 400 && /today or for the next days/.test(r.j.error), r.j);
  r = await plan(U1, add(TODAY, 8), [{ work: EMB, layer: 'L1', side: 'RHS', from: 50000, to: 50100 }]);
  ok('   more than 7 days ahead: refused', r.status === 400, r.j);
  r = await plan(U1, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: 50310, to: 51010 }], 0);
  ok('   saved over an older copy (another phone saved meanwhile): refused, nothing lost', r.status === 409 && r.j.code === 'changed', r.j);
  r = await plan(U1, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: '50+310', to: '51+010' }, { work: EMB, layer: 'L2', side: 'Both', from: '55+270', to: '55+370' }, { work: CUL, qty: 1 }], v1);
  ok('   he changes his plan (Both = LHS + RHS); the earlier plan is kept in the history', r.status === 200 && r.j.doc.plan.length === 3 && r.j.doc.history.length === 1 && r.j.doc.history[0].what === 'plan', r.j);
  r = await plan(AD, TODAY, [{ work: EMB, layer: 'L1', side: 'RHS', from: 50310, to: 51010 }], 2, 'eng1@rcl.test');
  ok('   the Admin cannot change eng1\'s plan', r.status === 403, r.j);
  // yesterday: the Super Admin enters eng1's and eng2's plans (a day gone by – only he may)
  r = await plan(SA, Y, [{ work: EMB, layer: 'L1', side: 'RHS', from: 50310, to: 51010 }, { work: SUB, layer: 'L1', side: 'RHS', from: 45150, to: 46150 }], 0, 'eng1@rcl.test');
  ok('the Super Admin enters a plan of yesterday for eng1', r.status === 200 && r.j.doc.plan_by === 'sa@rcl.test' && r.j.doc.name === 'Engineer One', r.j);
  r = await plan(SA, Y, [{ work: GSB, layer: 'L1', side: 'RHS', from: 39930, to: 40270 }, { work: GSB, layer: 'L1', side: 'LHS', from: 40410, to: 40730 }], 0, 'eng2@rcl.test');
  ok('   and for eng2 (GSB, 660 m)', r.status === 200, r.j);
  // ---- the report ----
  const rep = (c, day, report, ver, email) => c.eng({ action: 'reportSave', day: day, report: report, ver: ver, email: email });
  r = await U1.eng({ action: 'days', from: Y, to: TODAY });
  const dY = r.j.days.find(d => d.day === Y);
  ok('eng1 opens My work: yesterday\'s plan and today\'s', r.status === 200 && r.j.days.length === 2 && r.j.works.sort().join() === [EMB, SUB, CUL].sort().join(), r.j);
  r = await rep(U1, Y, { lines: [{ plan: 'p1', from: 50310, to: 51110 }, { plan: 'p2', from: 45150, to: 45500 }] }, dY.ver);
  ok('a report with work left but no reason: refused ("say why")', r.status === 400 && /Subgrade\): not all of it was done – say why/.test(r.j.error), r.j);
  r = await rep(U1, Y, { lines: [{ plan: 'p1', from: 50310, to: 51110 }, { plan: 'p2', from: 45150, to: 45500, reason: 'Subgrade top work in progress' }], extra: [{ work: EMB, layer: 'L2', side: 'LHS', from: '55+400', to: '55+500', reason: 'Machine shifted' }], note: 'Rain at 4 pm' }, dY.ver);
  ok('eng1 sends his report: 800 m Embankment (more than the 700 planned), 350 of 1000 m Subgrade and why, 100 m outside the plan', r.status === 200 && r.j.doc.report.lines.map(l => l.qty + '/' + l.left).join() === '800/0,350/650' && r.j.doc.report.extra[0].qty === 100 && r.j.doc.report_by === 'eng1@rcl.test', r.j);
  const vY = r.j.doc.ver;
  ok('   his reasons go into the list suggested to the others', sql('rcl_eng', "select string_agg(text || ':' || uses, ',' order by text) from eng_reasons") === 'Machine shifted:1,Subgrade top work in progress:1');
  r = await plan(SA, Y, [{ work: EMB, layer: 'L1', side: 'RHS', from: 50310, to: 50400 }], vY, 'eng1@rcl.test');
  ok('   the plan of a reported day stays as it was (even for the Super Admin)', r.status === 400 && r.j.code === 'reported', r.j);
  r = await rep(AD, Y, { lines: [{ plan: 'p1', from: 50310, to: 51010 }, { plan: 'p2', none: true, reason: 'x' }] }, vY, 'eng1@rcl.test');
  ok('   the Admin cannot change eng1\'s report (only the sender or the Super Admin)', r.status === 403, r.j);
  r = await rep(U1, Y, { lines: [{ plan: 'p1', from: 50310, to: 51110 }, { plan: 'p2', from: 45150, to: 45600, reason: 'Subgrade top work in progress' }], extra: [{ work: EMB, layer: 'L2', side: 'LHS', from: '55+400', to: '55+500', reason: 'Machine shifted' }] }, vY);
  ok('eng1 corrects his report: kept as a change (✎ 1), the report as sent is in the history', r.status === 200 && r.j.doc.edits === 1 && r.j.doc.edited_by === 'eng1@rcl.test' && r.j.doc.history[0].what === 'report' && r.j.doc.history[0].report.lines[1].qty === 350, r.j);
  r = await rep(SA, Y, Object.assign({}, r.j.doc.report, { note: 'checked' }), r.j.doc.ver, 'eng1@rcl.test');
  ok('   the Super Admin may change it too (✎ 2); the sender stays eng1', r.status === 200 && r.j.doc.edits === 2 && r.j.doc.report_by === 'eng1@rcl.test' && r.j.doc.edited_by === 'sa@rcl.test', r.j);
  r = await rep(U1, Y, r.j.doc.report, vY);
  ok('   a change over an older copy: refused', r.status === 409 && r.j.code === 'changed', r.j);
  r = await rep(U1, add(TODAY, 1), { note: 'x' }, 0);
  ok('   a report of tomorrow: refused', r.status === 400, r.j);
  r = await rep(U1, Y2, { lines: [], extra: [] }, 0);
  ok('   an empty report of a day without a plan: refused (work outside the plan or a note)', r.status === 400 && r.j.code === 'empty', r.j);
  r = await rep(U1, Y2, { extra: [{ work: EMB, layer: 'L1', side: 'LHS', from: 50000, to: 50200 }] }, 0);
  ok('   a day without a plan: the work done is reported outside the plan', r.status === 200 && r.j.doc.report.extra[0].qty === 200, r.j);
  // ---- the hourly reminder ----
  r = await U2.eng({ action: 'init' });
  ok('the reminder: eng2 (GSB given, report of yesterday not in) is due', r.status === 200 && r.j.remind.due === true && r.j.remind.day === Y, r.j.remind);
  r = await U1.eng({ action: 'init' });
  ok('   eng1 (report sent) is not', r.j.remind.due === false, r.j.remind);
  ok('   a User gets only his own works and himself – not the others\'', r.j.assign.every(a => a.email === 'eng1@rcl.test') && r.j.people.length === 1, r.j.assign);

  // ---- THE VIEWS ----
  r = await U1.eng({ action: 'dash', day: Y });
  ok('a User cannot open the dashboard', r.status === 403 && r.j.code === 'access', r.j);
  r = await AD.eng({ action: 'dash', day: Y });
  const w = id => (r.j.works || []).find(x => x.item === id) || {};
  ok('the dashboard of yesterday: Embankment 800 / 700 m "More than planned", 100 m outside the plan, sent by Engineer One', r.status === 200 && w(EMB).planned === 700 && w(EMB).done === 800 && w(EMB).outside === 100 && w(EMB).status === 'More than planned' && w(EMB).senders[0].name === 'Engineer One', w(EMB));
  ok('   Subgrade 450 / 1000 m (as corrected) "Partly done", its reason shown', w(SUB).done === 450 && w(SUB).status === 'Partly done' && w(SUB).lines[0].reason === 'Subgrade top work in progress', w(SUB));
  ok('   GSB: "No report" – eng2 missing', w(GSB).status === 'No report' && w(GSB).missing[0].email === 'eng2@rcl.test', w(GSB));
  ok('   the tiles: planned 2,360 m, achieved 1,250 m (53 %), 1 of 2 reports in, outside the plan 100 m', r.j.tiles.planned === 2360 && r.j.tiles.done === 1250 && r.j.tiles.pct === 53 && r.j.tiles.reportsIn === 1 && r.j.tiles.reportsDue === 2 && r.j.tiles.outside === 100, r.j.tiles);
  ok('   the program of today is shown with the work (Embankment: 2 lines of eng1)', w(EMB).program.length === 2, w(EMB).program);
  ok('   needs attention: eng2\'s report, the Subgrade left, no program from eng2 for today', r.j.attention.some(a => a.kind === 'missing' && a.email === 'eng2@rcl.test') && r.j.attention.some(a => a.kind === 'left' && /Subgrade: 550 m left/.test(a.text)) && r.j.attention.some(a => a.kind === 'program' && a.email === 'eng2@rcl.test'), r.j.attention);
  r = await U1.eng({ action: 'strip', day: Y });
  const st = r.j;
  ok('the strip chart (a User may see it): the layers in their order', r.status === 200 && st.layers.map(l => l.name).join(' | ') === 'Embankment · Layer 1 | Embankment · Top | Subgrade · Layer 1 | Subgrade · Top / final | GSB · Layer 1', st.layers);
  ok('   RHS: Subgrade Layer 1 on top of Embankment where both are done; LHS: Embankment Top (outside the plan) and Layer 1 of the day before', JSON.stringify(st.strip.RHS.pieces.map(p => [p.from, p.to, p.layer])) === JSON.stringify([[45150, 45600, SUB + '|L1'], [50310, 51110, EMB + '|L1']]) && JSON.stringify(st.strip.LHS.pieces.map(p => [p.from, p.to, p.layer])) === JSON.stringify([[50000, 50200, EMB + '|L1'], [55400, 55500, EMB + '|L2']]), st.strip);
  const emb1 = st.stats.find(s => s.id === EMB + '|L1');
  ok('   Embankment Layer 1: L 0.2 · R 0.8 km of 3 × 53.055 km (0.6 %); this month counted', emb1.per.LHS === 0.2 && emb1.per.RHS === 0.8 && emb1.pct === 0.6 && (Y.slice(0, 7) === Y2.slice(0, 7) ? emb1.month === 1 : true), emb1);
  ok('   outlined: what was done yesterday; dashed: today\'s program (Both = on LHS and RHS)', st.yesterday.RHS.length === 2 && st.program.LHS.some(p => p.from === 55270) && st.program.RHS.some(p => p.from === 55270), [st.yesterday, st.program]);
  r = await AD.eng({ action: 'grid', from: add(TODAY, -6), to: TODAY });
  const gy = r.j.rows && r.j.rows.find(x => x.day === Y);
  ok('All reports: yesterday – Embankment 114 % by Engineer One (✎ 2), GSB missing (Engineer Two)', r.status === 200 && gy.cells[EMB].pct === 114 && gy.cells[EMB].senders[0].edits === 2 && gy.cells[GSB].missing[0].name === 'Engineer Two' && gy.sent === 1 && gy.due === 2, gy);
  r = await AD.eng({ action: 'perf', from: add(TODAY, -6), to: TODAY });
  const p1 = r.j.people && r.j.people.find(p => p.email === 'eng1@rcl.test'), p2 = r.j.people && r.j.people.find(p => p.email === 'eng2@rcl.test');
  ok('Performance: eng1 – reports sent, corrections, plan against done (1,250 of 1,700 m)', r.status === 200 && p1.edits === 2 && p1.planned === 1700 && p1.done === 1250 && p1.pct === 74 && p1.works.Embankment === 2, p1);
  ok('   eng2 – reports missing on the days his work was given', p2 && p2.missing >= 1 && p2.sent === 0, p2);
  r = await AD.eng({ action: 'report', from: add(TODAY, -6), to: Y });
  const rw = id => (r.j.works || []).find(x => x.item === id) || {};
  ok('a weekly report: each work planned / done / outside, by person, the reasons', r.status === 200 && rw(EMB).planned === 700 && rw(EMB).done === 800 && rw(EMB).outside === 300 && rw(SUB).reasons[0].text === 'Subgrade top work in progress' && rw(EMB).people[0].name === 'Engineer One', r.j.works);
  r = await U1.eng({ action: 'report', from: Y, to: Y });
  ok('   a User cannot open the reports', r.status === 403, r.j);
  r = await U1.eng({ action: 'days', email: 'eng2@rcl.test', from: Y, to: Y });
  ok('   a User cannot open another person\'s days', r.status === 403, r.j);
  r = await AD.eng({ action: 'dayView', email: 'eng1@rcl.test', day: Y });
  ok('   the Admin opens eng1\'s report (View report)', r.status === 200 && r.j.doc.report.lines.length === 2, r.j);

  // ---- (28-10-2026) the assistant's look-ups (Mechanical's Ask): each through the look of this module, with its own access ----
  r = await AD.eng({ action: 'aiLook', name: 'eng_report', args: { from: add(TODAY, -6), to: Y } });
  const ar = (r.j.works || []).find(w => w.name === 'Embankment') || {};
  ok('aiLook eng_report (the Admin): the week\'s report made short – Embankment 800 of 700 planned, 300 outside, its people', r.status === 200 && ar.planned === 700 && ar.done === 800 && ar.outside === 300 && /Engineer One/.test(ar.people || '') && r.j.reportsDue >= 1, r.j);
  r = await AD.eng({ action: 'aiLook', name: 'eng_performance', args: { from: add(TODAY, -6), to: TODAY } });
  ok('   eng_performance: eng1 – 1,250 of 1,700 m (74 %), 2 corrections', r.status === 200 && (r.j.people || []).some(p => p.name === 'Engineer One' && p.done === 1250 && p.planned === 1700 && p.pct === 74 && p.edits === 2), r.j);
  r = await AD.eng({ action: 'aiLook', name: 'eng_dashboard', args: { day: Y } });
  ok('   eng_dashboard of yesterday: its tiles and works, who reported', r.status === 200 && r.j.workDay === Y && r.j.tiles && Array.isArray(r.j.works) && r.j.works.length >= 1 && Array.isArray(r.j.people), r.j);
  r = await U1.eng({ action: 'aiLook', name: 'eng_report', args: { from: Y, to: Y } });
  ok('   a User: the report is refused as on its page ("This page is for the Admin and the Super Admin.")', r.status === 403 && r.j.error === 'This page is for the Admin and the Super Admin.', r.j);
  r = await U1.eng({ action: 'aiLook', name: 'eng_my_work', args: { from: add(TODAY, -6), to: TODAY } });
  ok('   a User: his own days (his works, each day planned / reported with its lines)', r.status === 200 && r.j.person === 'Engineer One' && r.j.days.some(d => d.reported && d.lines.some(l => l.work === 'Embankment')), r.j);
  r = await U1.eng({ action: 'aiLook', name: 'eng_progress', args: {} });
  ok('   a User: the strip chart\'s progress (each layer)', r.status === 200 && Array.isArray(r.j.layers) && r.j.layers.length >= 1, r.j);
  r = await U1.eng({ action: 'aiLook', name: 'planSave', args: {} });
  ok('   anything else: "There is no such look-up of Engineering." (nothing saved)', r.status === 400 && r.j.error === 'There is no such look-up of Engineering.', r.j);
  r = await U1.eng({ action: 'aiLook', name: 'eng_report', args: { from: '01-10-2026' } });
  ok('   a date not as yyyy-mm-dd: said', r.status === 400 && r.j.error === 'Give the From date as yyyy-mm-dd.', r.j);

  // ---- one site never sees another's ----
  const T = client(E); r = await T.req('/api/sso', { ticket: await ticketFor(AD.p, 'engineering', 'T2') });
  ok('sujit opens Engineering on T2 (User there)', r.status === 200 && r.j.site === 'T2' && r.j.user.role === 'user', r.j);
  r = await T.req('/api/eng', { action: 'init' });
  ok('   T2 has nothing of S1: no road, no works, no people of S1', r.status === 200 && r.j.road === null && r.j.masters.length === 0 && r.j.people.every(p => p.email === 'sujit@rcl.test'), r.j);
  r = await T.req('/api/eng', { action: 'strip', day: Y });
  ok('   T2\'s strip chart is empty', r.status === 200 && r.j.layers.length === 0, r.j);
  ok('   every row carries its site', sql('rcl_eng', "select count(*) from eng_days where site <> 'S1'") === '0' && sql('rcl_eng', "select count(distinct site) from eng_people") === '2');
  ok('who did what is kept (activity)', Number(sql('rcl_eng', "select count(*) from eng_activity where site = 'S1'")) > 15);
  r = await U1.s.req('/api/logout', {});
  ok('Logout ends the Engineering sign-in', r.status === 200 && (await U1.eng({ action: 'init' })).status === 401);

  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + ((e && e.stack) || e)); process.exit(1); });
