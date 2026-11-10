/* (10-11-2026, Engineering 2B) THE MEASUREMENT BOOK through Engineering's own doors, on the local test rig (never the live databases;
 * test values only). Run AFTER test/api.test.js (its road, sides, works and people) with steps 3 and 4 applied to the rig's database
 * (sql/eng_step3_qc_hindrance.sql, sql/eng_step4_mb.sql):      timeout 300 node test/mb.test.js
 * Its own person (mb.eng@rcl.test – his reports entered by the Super Admin), its own stretch of road (30+000 … 32+500) and its own days;
 * it empties only what is its own (the MB pages and their numbers, his days, its RFIs, the RFI rule). Every quantity below is worked
 * out by hand in the comments. */
'use strict';
const { execSync } = require('child_process');
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
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
  const p = client(P); let l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200 && email === 'sa@rcl.test') l = await p.req('/api/auth', { action: 'login', email: email, password: 'Super#Admin2041' });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(E), t = ((await p.req('/api/go?module=engineering&site=' + site)).loc.split('#sso=')[1] || ''), r = await s.req('/api/sso', { ticket: t });
  return { r, s, eng: body => s.req('/api/eng', body) };
}
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SUB = 'W-002', CUL = 'W-004', MBE = 'mb.eng@rcl.test';
const D1 = add(TODAY, -9), D2 = add(TODAY, -8), DV = add(TODAY, -7), D3 = add(TODAY, -6), D4 = add(TODAY, -5);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0005;
const shape = l => [l.day, l.side, l.from, l.to, l.len, l.w_m, l.mm_m, l.qty, l.unit, l.how].join(' ');

(async () => {
  sql('rcl_eng', "delete from eng_mb where site = 'S1'; delete from eng_numbers where site = 'S1' and kind = 'MB'; delete from eng_settings where site = 'S1' and key = 'rfi'; " +
    "delete from eng_rfi where site = 'S1' and note = 'mb-test'; delete from eng_days where site = 'S1' and email = '" + MBE + "';");
  const SA = await engAs('sa@rcl.test', 'Super#Admin2040', 'S1'), AD = await engAs('sujit@rcl.test', 'Nashik#Road848!', 'S1'), U1 = await engAs('eng1@rcl.test', 'Audit#PassView9!x', 'S1');
  ok('signed in: the Super Admin, the Engineering Admin (sujit), a User (eng1)', SA.r.j.user.role === 'super' && AD.r.j.user.role === 'admin' && U1.r.j.user.role === 'user');
  const menu = async c => ((await c.s.req('/menu.json')).j.pages || []).map(p => p.key);
  ok('the menu: "Measurement Book" for the Admin and the Super Admin, not for a User', (await menu(AD)).indexOf('mb') > -1 && (await menu(SA)).indexOf('mb') > -1 && (await menu(U1)).indexOf('mb') < 0);

  // ---- the masters of the day: from DV the LHS is 8.0 m wide (it was 7.5) and Subgrade Layer 1 is 300 mm thick (it was 250) ----
  let r = await SA.eng({ action: 'masterSave', kind: 'side', mode: 'period', item: 'S-001', valid_from: DV, data: { name: 'LHS', from: 8000, to: 61055, width: 8 } });
  ok('a new period of the LHS from ' + DV + ': 8.0 m (7.5 m before it)', r.status === 200 || (r.status === 409 && /already starts/.test(r.j.error)), r.j);
  r = await SA.eng({ action: 'masterSave', kind: 'work', mode: 'period', item: SUB, valid_from: DV, data: { name: 'Subgrade', sort: 30, layers: [{ key: 'L1', name: 'Layer 1', mm: 300 }, { key: 'L2', name: 'Top / final', mm: 250 }] } });
  ok('a new period of Subgrade from ' + DV + ': Layer 1 300 mm (250 mm before it)', r.status === 200 || (r.status === 409 && /already starts/.test(r.j.error)), r.j);
  r = await SA.eng({ action: 'personAdd', email: MBE, name: 'MB Engineer' });
  ok('his own person on the list (his reports are entered by the Super Admin)', r.status === 200 || r.status === 409, r.j);
  // ---- what was REPORTED DONE (the Super Admin enters MB Engineer's reports) ----
  const rep = (day, extra, lines, ver) => SA.eng({ action: 'reportSave', day: day, email: MBE, report: { lines: lines || [], extra: extra || [], note: '' }, ver: ver || 0 });
  r = await rep(D1, [{ work: SUB, layer: 'L1', side: 'Both', from: '30+000', to: '30+400' }]);
  ok(D1 + ': Subgrade Layer 1 on Both (LHS + RHS) 30+000–30+400', r.status === 200, r.j);
  r = await rep(D2, [{ work: SUB, layer: 'L1', side: 'Median', from: '31+000', to: '31+100' }]);
  ok(D2 + ': Subgrade Layer 1 on the Median 31+000–31+100', r.status === 200, r.j);
  r = await rep(D3, [{ work: SUB, layer: 'L1', side: 'LHS', from: '30+300', to: '30+700' }, { work: CUL, qty: 2 }, { work: SUB, layer: 'L2', side: 'LHS', from: '30+000', to: '30+100' }]);
  ok(D3 + ': Subgrade Layer 1 on LHS 30+300–30+700 (30+300–30+400 again), 2 culverts, Subgrade Top LHS 30+000–30+100', r.status === 200, r.j);
  r = await SA.eng({ action: 'planSave', day: D4, email: MBE, lines: [{ work: SUB, layer: 'L1', side: 'RHS', from: '32+000', to: '32+500' }], ver: 0 });
  r = await rep(D4, [], [{ plan: 'p1', from: '32+000', to: '32+250', reason: 'rain' }], r.j.doc && r.j.doc.ver);
  ok(D4 + ': planned Subgrade Layer 1 RHS 32+000–32+500, done 32+000–32+250 (a plan line)', r.status === 200 && r.j.doc.report.lines[0].qty === 250, r.j);

  // ---- ACCESS: a User has no MB at all (checked on the server for every action) ----
  const acts = [{ action: 'mbList' }, { action: 'mbOffer', work: SUB, layer: 'L1', from: D1, to: D3 }, { action: 'mbSave', work: SUB, layer: 'L1', from: D1, to: D3, lines: [{ key: 'x' }], mb_day: D3 }, { action: 'mbGet', no: 'MB-0001' }, { action: 'mbCheck', no: 'MB-0001', ver: 1, chk_day: TODAY }, { action: 'mbBack', no: 'MB-0001', ver: 1, why: 'xyz' }, { action: 'mbAbstract', from: D1, to: TODAY }];
  const deny = await Promise.all(acts.map(a => U1.eng(a)));
  ok('a User: every MB action refused (403 – "This page is for the Admin and the Super Admin.")', deny.every(x => x.status === 403 && x.j.code === 'access'), deny.map(x => x.status + ' ' + x.j.error));

  // ---- THE LINES OFFERED from the reports, each worked out with the masters of ITS day ----
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', side: '', from: D1, to: D3 });
  const O = r.j;
  // D1 LHS: 400 m × 7.5 m × 0.250 m = 750 cum; D1 RHS: the same 750; D2 Median: 100 × 2.0 × 0.250 = 50; D3 LHS (from DV: 8.0 m, 300 mm) only
  // 30+400–30+700 (30+300–30+400 was reported on D1 already): 300 × 8.0 × 0.300 = 720 cum
  const want = [D1 + ' LHS 30000 30400 400 7.5 250 750 cum LxWxT', D1 + ' RHS 30000 30400 400 7.5 250 750 cum LxWxT', D2 + ' Median 31000 31100 100 2 250 50 cum LxWxT', D3 + ' LHS 30400 30700 300 8 300 720 cum LxWxT'];
  ok('offered: 4 lines – "Both" as LHS and RHS, each side its own width, the version of each day (7.5 m / 250 mm; from ' + DV + ' 8.0 m / 300 mm)', r.status === 200 && JSON.stringify(O.lines.map(shape)) === JSON.stringify(want), (O.lines || []).map(shape));
  ok('   the stretch reported twice (LHS 30+300–30+400 on ' + D3 + ') is not offered again – said so', O.skipped.length === 1 && O.skipped[0].why === 'reported twice' && O.skipped[0].len === 100 && O.skipped[0].day === D3, O.skipped);
  ok('   every line says where it came from (the report\'s day, person, line) and is open (rule off: not asked)', O.lines.every(l => l.email === MBE && l.name === 'MB Engineer' && /^x\d$/.test(l.line) && l.outside === true && l.appr === 'off') && O.rule && O.rule.on === false, O.lines[0]);
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', side: 'RHS', from: D1, to: D3 });
  ok('   one side asked (RHS): only its line', r.status === 200 && r.j.lines.length === 1 && r.j.lines[0].side === 'RHS' && r.j.lines[0].qty === 750, r.j.lines);
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: '', from: D1, to: D3 });
  ok('   a work with layers and no layer picked: refused', r.status === 400 && /Pick the layer/.test(r.j.error), r.j);
  r = await AD.eng({ action: 'mbOffer', work: CUL, layer: 'L1', from: D1, to: D3 });
  ok('   a layer for a work without layers: refused', r.status === 400 && /has no layers/.test(r.j.error), r.j);
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', from: D1, to: add(TODAY, 1) });
  ok('   reports of a day not come yet: refused', r.status === 400, r.j);

  // ---- MEASURED: MB-0001 by sujit (the Admin) ----
  const L = (o, x) => Object.assign({ key: o.key }, x || {});
  const save = (c, x) => c.eng(Object.assign({ action: 'mbSave', work: SUB, layer: 'L1', from: D1, to: D3, mb_day: D3, note: '' }, x));
  r = await save(AD, { lines: O.lines.map((o, i) => L(o, i === 0 ? { w: '7.4' } : {})) });
  ok('a width measured other than the masters\' (7.4 m for 7.5) without a remark: refused', r.status === 400 && r.j.code === 'remark' && /Line 1 \(LHS 30\+000–30\+400\): the width differs from the masters \(7\.5 m\)/.test(r.j.error), r.j);
  r = await save(AD, { lines: O.lines.map((o, i) => L(o, i === 0 ? { w: '0' } : {})) });
  ok('   a width of 0: refused', r.status === 400 && r.j.code === 'width', r.j);
  r = await save(AD, { lines: O.lines.map(o => L(o)), mb_day: D2 });
  ok('   the MB date before the work was done (' + D3 + '): refused', r.status === 400 && /on or after the work was done/.test(r.j.error), r.j);
  r = await save(AD, { lines: [] });
  ok('   nothing ticked: refused', r.status === 400 && r.j.code === 'lines', r.j);
  r = await save(AD, { lines: O.lines.map((o, i) => L(o, i === 0 ? { w: '7.4', remark: 'measured 7.40 m on site' } : {})), note: 'rig MB test' });
  const M1 = r.j.mb || {};
  // line 1: 400 × 7.4 × 0.250 = 740 cum → 740 + 750 + 50 + 720 = 2260 cum
  ok('MB-0001 saved as MEASURED: 4 lines, 2,260 cum (line 1 measured 7.4 m: 400 × 7.4 × 0.25 = 740)', r.status === 200 && M1.no === 'MB-0001' && M1.status === 'Measured' && M1.lines.length === 4 && M1.lines[0].qty === 740 && M1.lines[0].w === 7.4 && M1.lines[0].w_m === 7.5 && M1.lines[0].remark === 'measured 7.40 m on site' && M1.measured_by === 'sujit@rcl.test' && near(M1.lines.reduce((a, l) => a + l.qty, 0), 2260), r.j);
  ok('   each line keeps the formula\'s figures: length, the masters\' and the measured width / thickness, how', M1.lines[3].len === 300 && M1.lines[3].w === 8 && M1.lines[3].mm === 300 && M1.lines[3].mm_m === 300 && M1.lines[3].how === 'LxWxT' && M1.lines.map(l => l.ln).join() === '1,2,3,4', M1.lines && M1.lines[3]);
  // ---- NEVER MEASURED TWICE ----
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', from: D1, to: D3 });
  ok('never twice: offered again – nothing (every stretch is in MB-0001)', r.status === 200 && r.j.lines.length === 0 && r.j.skipped.some(x => x.why === 'in the MB'), r.j);
  r = await save(SA, { lines: [L(O.lines[1])], mb_day: D3 });
  ok('   a second page with a line of MB-0001: refused on the server', r.status === 409 && r.j.code === 'changed' && /not open to measure any more/.test(r.j.error), r.j);
  // two people save the same stretch at the same moment (Subgrade Top LHS 30+000–30+100 of D3: 100 × 8.0 × 0.250 = 200 cum): one page only
  const O2 = (await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L2', from: D3, to: D3 })).j;
  const both = await Promise.all([AD, SA].map(c => c.eng({ action: 'mbSave', work: SUB, layer: 'L2', from: D3, to: D3, mb_day: D3, lines: O2.lines.map(o => L(o)) })));
  ok('   two saves of the same stretch at the same moment: one page, the other refused ("never measured twice")', O2.lines.length === 1 && O2.lines[0].qty === 200 && both.filter(x => x.status === 200).length === 1 && both.filter(x => x.status === 409).length === 1 && sql('rcl_eng', "select count(*) from eng_mb where site = 'S1' and work = 'W-002' and layer = 'L2'") === '1', both.map(x => x.status + ' ' + (x.j.error || x.j.mb.no)));
  // ---- CHECK-MEASURED: never by the one who measured it; SENT BACK (why) → corrected → measured again ----
  r = await AD.eng({ action: 'mbCheck', no: 'MB-0001', ver: M1.ver, chk_day: TODAY });
  ok('sujit cannot check-measure his own MB-0001', r.status === 403 && r.j.code === 'own', r.j);
  r = await AD.eng({ action: 'mbBack', no: 'MB-0001', ver: M1.ver, why: 'mine' });
  ok('   …nor send it back', r.status === 403 && r.j.code === 'own', r.j);
  r = await SA.eng({ action: 'mbBack', no: 'MB-0001', ver: M1.ver, why: '' });
  ok('the Super Admin sends it back without saying why: refused', r.status === 400 && r.j.code === 'why', r.j);
  r = await SA.eng({ action: 'mbBack', no: 'MB-0001', ver: M1.ver, why: 'Median width – check on site' });
  ok('   with why: SENT BACK', r.status === 200 && r.j.mb.status === 'Sent back' && r.j.mb.back_why === 'Median width – check on site' && r.j.mb.back_by === 'sa@rcl.test', r.j);
  const vBack = r.j.mb.ver;
  r = await SA.eng({ action: 'mbCheck', no: 'MB-0001', ver: vBack, chk_day: TODAY });
  ok('   a page sent back is not check-measured (it is measured again first)', r.status === 400 && r.j.code === 'status', r.j);
  r = await AD.eng({ action: 'mbOffer', no: 'MB-0001' });
  ok('sujit opens it to correct: its own 4 lines (with what he measured), nothing gone', r.status === 200 && r.j.lines.length === 4 && r.j.lines.every(l => l.inPage) && r.j.lines[0].w === 7.4 && r.j.lines[0].remark === 'measured 7.40 m on site' && r.j.gone.length === 0 && r.j.ver === vBack, r.j);
  const OC = r.j.lines;
  const fix = (x) => AD.eng(Object.assign({ action: 'mbSave', no: 'MB-0001', mb_day: D3, note: 'rig MB test', lines: OC.map((o, i) => L(o, i === 0 ? { w: 7.4, remark: 'measured 7.40 m on site' } : i === 2 ? { w: 2.1, remark: 'Median 2.10 m' } : {})) }, x));
  r = await fix({ ver: vBack - 1 });
  ok('   saved over an older version: refused (changed meanwhile)', r.status === 409 && r.j.code === 'changed', r.j);
  r = await U1.eng({ action: 'mbSave', no: 'MB-0001', ver: vBack, mb_day: D3, lines: OC.map(o => L(o)) });
  ok('   a User cannot change it', r.status === 403, r.j);
  r = await fix({ ver: vBack });
  const M1b = r.j.mb || {};
  // the Median line: 100 × 2.1 × 0.250 = 52.5 → 740 + 750 + 52.5 + 720 = 2262.5 cum
  ok('corrected and MEASURED AGAIN: the Median 2.1 m (100 × 2.1 × 0.25 = 52.5) – 2,262.5 cum; the earlier page kept (✎)', r.status === 200 && M1b.status === 'Measured' && M1b.lines[2].qty === 52.5 && near(M1b.lines.reduce((a, l) => a + l.qty, 0), 2262.5) &&
    M1b.history[0].what === 'Corrected and measured again' && M1b.history[0].was.lines[2].w === 2 && M1b.history[1].what === 'Sent back' && M1b.history[2].what === 'Measured', r.j);
  r = await SA.eng({ action: 'mbCheck', no: 'MB-0001', ver: M1b.ver - 1, chk_day: TODAY });
  ok('the check-measurement over an older version: refused (changed meanwhile)', r.status === 409 && r.j.code === 'changed', r.j);
  r = await SA.eng({ action: 'mbCheck', no: 'MB-0001', ver: M1b.ver, chk_day: add(D3, -1) });
  ok('the check-measurement before the day it was measured: refused', r.status === 400 && /on or after the day it was measured/.test(r.j.error), r.j);
  r = await SA.eng({ action: 'mbCheck', no: 'MB-0001', ver: M1b.ver, chk_day: add(TODAY, -4), remark: 'checked 3 stretches' });
  ok('the Super Admin CHECK-MEASURES MB-0001', r.status === 200 && r.j.mb.status === 'Check-measured' && r.j.mb.checked_by === 'sa@rcl.test' && r.j.mb.chk_day === add(TODAY, -4) && r.j.mb.chk_remark === 'checked 3 stretches', r.j);
  const M1c = r.j.mb;
  r = await fix({ ver: M1c.ver });
  ok('LOCKED: sujit cannot change it any more', r.status === 400 && r.j.code === 'locked', r.j);
  r = await SA.eng({ action: 'mbSave', no: 'MB-0001', ver: M1c.ver, mb_day: D3, lines: OC.map(o => L(o)) });
  ok('   nor the Super Admin', r.status === 400 && r.j.code === 'locked', r.j);
  r = await SA.eng({ action: 'mbOffer', no: 'MB-0001' });
  ok('   it is not opened to correct', r.status === 400 && r.j.code === 'locked', r.j);
  r = await AD.eng({ action: 'mbBack', no: 'MB-0001', ver: M1c.ver, why: 'again' });
  ok('   nor sent back', r.status === 400 && r.j.code === 'status', r.j);
  r = await AD.eng({ action: 'mbGet', no: 'MB-0001' });
  ok('the page as it is: 4 lines, 2,262.5 cum, every change kept – Measured, Sent back, Corrected and measured again, Check-measured', r.status === 200 && r.j.totals.length === 1 && r.j.totals[0].unit === 'cum' && r.j.totals[0].qty === 2262.5 && r.j.name === 'Subgrade · Layer 1' &&
    r.j.mb.history.map(h => h.what).join(' | ') === 'Check-measured | Corrected and measured again | Sent back | Measured', r.j);

  // ---- a work in Nos: the reported quantity (one line) ----
  r = await SA.eng({ action: 'mbOffer', work: CUL, layer: '', from: D3, to: D3 });
  const OK2 = r.j.lines || [];
  ok('Culvert (Nos): the reported quantity – 2 Nos, one line, no chainage', r.status === 200 && OK2.length === 1 && OK2[0].qty === 2 && OK2[0].unit === 'Nos' && OK2[0].how === 'reported' && OK2[0].from === null && OK2[0].w_m === null, r.j);
  r = await SA.eng({ action: 'mbSave', work: CUL, layer: '', from: D3, to: D3, mb_day: D3, lines: [L(OK2[0], { w: 3, mm: 100 })] });
  const MC = r.j.mb || {};
  ok('   measured by the Super Admin (a width typed for a reported quantity changes nothing)', r.status === 200 && MC.lines[0].qty === 2 && MC.lines[0].w === null, r.j);
  r = await AD.eng({ action: 'mbCheck', no: MC.no, ver: MC.ver, chk_day: TODAY });
  ok('   check-measured by sujit (not the one who measured it)', r.status === 200 && r.j.mb.status === 'Check-measured', r.j);
  r = await SA.eng({ action: 'mbOffer', work: CUL, layer: '', from: D3, to: D3 });
  ok('   a report line without chainage is never measured twice either', r.status === 200 && r.j.lines.length === 0 && r.j.skipped.length === 1, r.j);

  // ---- E1: the RFI rule on – a stretch not approved by the IE is not finished → not measured (the Super Admin may, with a reason) ----
  r = await SA.eng({ action: 'rfiRule', on: true, from: D4 });
  ok('the RFI rule on from ' + D4, r.status === 200 && r.j.rule.on === true, r.j);
  r = await SA.eng({ action: 'rfiSave', day: D4, work: SUB, layer: 'L1', side: 'RHS', from: '32+000', to: '32+100', note: 'mb-test' });
  const RF = r.j.rfi || {};
  r = await AD.eng({ action: 'rfiDecide', no: RF.no, ver: RF.ver, status: 'Approved', ie_day: D4, ie_name: 'Mr IE', ie_ref: 'IE/MB/1' });
  ok('   ' + RF.no + ': Subgrade Layer 1 RHS 32+000–32+100 approved by the IE', r.status === 200 && r.j.rfi.status === 'Approved', r.j);
  r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', from: D4, to: D4 });
  const O3 = r.j.lines || [];
  // 32+000–32+100 approved: 100 × 7.5 × 0.300 = 225 cum; 32+100–32+250 not approved: 150 × 7.5 × 0.300 = 337.5 cum
  ok('the plan line done on RHS 32+000–32+250: 32+000–32+100 approved (' + RF.no + ', 225 cum), 32+100–32+250 "Not approved by the IE" (337.5 cum)', r.status === 200 && r.j.rule.on === true && O3.length === 2 &&
    O3[0].appr === 'yes' && O3[0].rfi.join() === RF.no && O3[0].qty === 225 && O3[0].line === 'p1' && O3[0].outside === false && O3[1].appr === 'no' && O3[1].rfi.length === 0 && O3[1].from === 32100 && O3[1].qty === 337.5, O3);
  const save4 = (c, lines, x) => c.eng(Object.assign({ action: 'mbSave', work: SUB, layer: 'L1', from: D4, to: D4, mb_day: add(TODAY, -1), lines: lines }, x || {}));
  r = await save4(AD, [L(O3[0]), L(O3[1], { skip: 'IE saw it' })]);
  ok('the Admin cannot measure the stretch not approved (not finished – E1), even with a reason', r.status === 400 && r.j.code === 'notapproved' && /Line 2 \(RHS 32\+100–32\+250\): not approved by the IE – the layer is not finished \(E1\)/.test(r.j.error), r.j);
  r = await save4(AD, [L(O3[0])]);
  const M3 = r.j.mb || {};
  ok('   he measures the approved stretch: 225 cum, its RFI on the line', r.status === 200 && M3.lines.length === 1 && M3.lines[0].qty === 225 && M3.lines[0].rfi.join() === RF.no, r.j);
  r = await save4(SA, [L(O3[1])], { mb_day: TODAY });
  ok('the Super Admin without a reason: refused', r.status === 400 && r.j.code === 'notapproved' && /write why it is measured anyway/.test(r.j.error), r.j);
  r = await save4(SA, [L(O3[1], { skip: 'IE inspected, letter awaited' })], { mb_day: TODAY });
  const M4 = r.j.mb || {};
  ok('   with a reason: measured (337.5 cum) – the reason on the line and in the activity record', r.status === 200 && M4.lines[0].qty === 337.5 && M4.lines[0].skip === 'IE inspected, letter awaited' &&
    sql('rcl_eng', "select detail->'notApproved'->0->>'reason' from eng_activity where site = 'S1' and action = 'MB measured' and target = '" + M4.no + "' order by id desc limit 1") === 'IE inspected, letter awaited', r.j);
  r = await SA.eng({ action: 'mbSave', no: M4.no, ver: M4.ver, mb_day: TODAY, note: 'letter IE/18B/77 awaited', lines: [L(O3[1], { skip: 'IE inspected, letter awaited' })] });
  ok('   a change while it waits for the check: kept (✎ Changed)', r.status === 200 && r.j.mb.note === 'letter IE/18B/77 awaited' && r.j.mb.history[0].what === 'Changed' && r.j.mb.history[0].was.note === '', r.j);
  r = await SA.eng({ action: 'mbCheck', no: M3.no, ver: M3.ver, chk_day: TODAY });
  ok('   the Super Admin check-measures sujit\'s ' + M3.no, r.status === 200 && r.j.mb.status === 'Check-measured', r.j);
  sql('rcl_eng', "delete from eng_settings where site = 'S1' and key = 'rfi';");      // (the rule off again for the other tests of the rig)

  // ---- THE ABSTRACT for the RA bill: the check-measured quantity of the period (by the MB date), up to the previous period, cumulative ----
  const P1 = add(TODAY, -3);
  r = await AD.eng({ action: 'mbAbstract', from: P1, to: TODAY });
  const ab = (r.j.rows || []), sub = ab.find(g => g.work === SUB && g.layer === 'L1'), cul = ab.find(g => g.work === CUL);
  // Subgrade Layer 1: MB-0001 (dated D3, before P1) 2,262.5 up to the previous period; M3 (yesterday) 225 this period; M4 (today, not checked) not counted
  ok('the abstract of ' + P1 + ' – today: Subgrade · Layer 1 – up to the previous period 2,262.5, this period 225, cumulative 2,487.5 cum', r.status === 200 && sub && sub.unit === 'cum' && sub.prev === 2262.5 && sub.now === 225 && sub.cum === 2487.5 && sub.pages.join() === M3.no && sub.name === 'Subgrade' && sub.layerName === 'Layer 1', ab);
  ok('   Culvert: 2 Nos before, none this period, 2 cumulative; Subgrade Top (not check-measured) not counted', cul && cul.unit === 'Nos' && cul.prev === 2 && cul.now === 0 && cul.cum === 2 && !ab.some(g => g.layer === 'L2'), ab);
  ok('   the page of this period not check-measured yet is named, not counted', (r.j.waiting || []).length === 1 && r.j.waiting[0].no === M4.no && r.j.waiting[0].status === 'Measured', r.j.waiting);
  r = await AD.eng({ action: 'mbAbstract', from: D1, to: TODAY });
  const sub2 = (r.j.rows || []).find(g => g.work === SUB && g.layer === 'L1');
  ok('   the whole time as one period: 2,487.5 this period, nothing before', sub2 && sub2.prev === 0 && sub2.now === 2487.5 && sub2.cum === 2487.5, r.j.rows);
  r = await AD.eng({ action: 'mbAbstract', from: D1, to: D2 });
  ok('   up to a day before any MB page: nothing', r.status === 200 && r.j.rows.length === 0, r.j);
  // ---- THE MB REGISTER ----
  r = await AD.eng({ action: 'mbList', from: D1, to: TODAY });
  const nos = (r.j.rows || []).map(p => p.no);
  ok('the register: every page (numbers never given twice), each with its lines and quantity', r.status === 200 && nos.length === 5 && new Set(nos).size === 5 && nos.every(n => /^MB-\d{4}$/.test(n)) && (r.j.rows.find(p => p.no === 'MB-0001') || {}).totals[0].qty === 2262.5, r.j.rows);
  r = await AD.eng({ action: 'mbList', from: D1, to: TODAY, status: 'Check-measured' });
  ok('   filtered: check-measured – 3', r.status === 200 && r.j.rows.length === 3 && r.j.rows.every(p => p.status === 'Check-measured'), r.j.rows);
  r = await AD.eng({ action: 'mbList', from: D1, to: TODAY, work: CUL });
  ok('   filtered: Culvert – 1', r.status === 200 && r.j.rows.length === 1 && r.j.rows[0].work === CUL, r.j.rows);
  r = await AD.eng({ action: 'mbList', from: add(TODAY, -2), to: TODAY });
  ok('   filtered by the MB date: the last 3 days – 2 pages', r.status === 200 && r.j.rows.length === 2, r.j.rows);
  // ---- every save in the activity record ----
  ok('who did what is kept: MB measured / changed / sent back / measured again / check-measured', ['MB measured', 'MB changed', 'MB sent back', 'MB measured again', 'MB check-measured'].every(a => Number(sql('rcl_eng', "select count(*) from eng_activity where site = 'S1' and action = '" + a + "'")) > 0));

  // ---- STEP 4 NOT RUN: the MB page says so; everything else works as before (on the rig: the table and the function hidden for a moment) ----
  const reload = async test => { sql('rcl_eng', "notify pgrst, 'reload schema';"); for (let i = 0; i < 40; i++) { await wait(250); if (await test()) return true; } return false; };
  try {
    sql('rcl_eng', 'alter table public.eng_mb rename to eng_mb_hidden; alter function public.eng_mb_put(text, text, integer, jsonb) rename to eng_mb_put_hidden;');
    await reload(async () => !!(await AD.eng({ action: 'mbList' })).j.missing);
    r = await AD.eng({ action: 'mbList' });
    ok('before step 4: the register says which file to run', r.status === 200 && /sql\/eng_step4_mb\.sql/.test(r.j.missing || '') && r.j.rows.length === 0, r.j);
    r = await AD.eng({ action: 'mbOffer', work: SUB, layer: 'L1', from: D1, to: D3 });
    const a2 = await AD.eng({ action: 'mbAbstract', from: D1, to: TODAY });
    ok('   the lines and the abstract too (not "step 1", not "step 3")', r.status === 500 && r.j.code === 'notinstalled4' && /eng_step4_mb\.sql/.test(r.j.error) && /eng_step4_mb\.sql/.test(a2.j.missing || ''), [r.j, a2.j]);
    const others = await Promise.all([AD.eng({ action: 'init' }), AD.eng({ action: 'rfiList', from: D1, to: TODAY, status: '' }), AD.eng({ action: 'dash', day: add(TODAY, -1) })]);
    ok('   everything else works as before', others.every(x => x.status === 200), others.map(x => x.status + ' ' + (x.j.error || '')));
  } finally {
    sql('rcl_eng', "do $$ begin if to_regclass('public.eng_mb_hidden') is not null then alter table public.eng_mb_hidden rename to eng_mb; end if; " +
      "if to_regprocedure('public.eng_mb_put_hidden(text, text, integer, jsonb)') is not null then alter function public.eng_mb_put_hidden(text, text, integer, jsonb) rename to eng_mb_put; end if; end $$;");
    const back = await reload(async () => (await AD.eng({ action: 'mbList' })).j.missing === undefined);
    ok('   (the rig\'s step 4 put back)', back);
  }

  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + ((e && e.stack) || e)); process.exit(1); });
