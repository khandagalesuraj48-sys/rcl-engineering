/* (09-11-2026, Engineering 2A) RFI – the IE's approval of a layer – and HINDRANCES, through Engineering's own doors on the local test rig
 * (never the live databases; test values only). Run AFTER test/api.test.js (it uses its road, works and people) with step 3 applied to
 * the rig's database (sql/eng_step3_qc_hindrance.sql):      timeout 300 node test/qc2a.test.js
 * Its own stretch of road (40+000 …) and its own days; it empties only what is its own (RFIs, hindrances, the rule, sujit's days). */
'use strict';
const { execSync } = require('child_process');
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
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
  return { r, eng: body => s.req('/api/eng', body) };
}
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const EMB = 'W-001', SUB = 'W-002', GSB = 'W-003', D0 = add(TODAY, -5);

(async () => {
  sql('rcl_eng', "delete from eng_rfi; delete from eng_hindrance; delete from eng_settings; delete from eng_numbers; delete from eng_days where email = 'sujit@rcl.test' and day >= '" + add(TODAY, -10) + "';");
  const SA = await engAs('sa@rcl.test', 'Super#Admin2040', 'S1'), AD = await engAs('sujit@rcl.test', 'Nashik#Road848!', 'S1'), U1 = await engAs('eng1@rcl.test', 'Audit#PassView9!x', 'S1'), U2 = await engAs('eng2@rcl.test', 'Audit#PassView9!x', 'S1');
  ok('signed in: the Super Admin, the Admin (sujit), two Users', SA.r.j.user.role === 'super' && AD.r.j.user.role === 'admin' && U1.r.j.user.role === 'user' && U2.r.j.user.role === 'user');
  let r = await SA.eng({ action: 'assignSave', email: 'sujit@rcl.test', works: [EMB, SUB, GSB] });
  ok('sujit is given Embankment, Subgrade and GSB (for his own plans)', r.status === 200, r.j);
  sql('rcl_eng', "update eng_assign set created_at = now() - interval '30 days' where email = 'sujit@rcl.test'");

  // ---- the rule: off until the Super Admin switches it on ----
  r = await U1.eng({ action: 'rfiList', from: add(TODAY, -30), to: TODAY, status: '' });
  ok('the RFI page: the rule is off at first; a User does not record the IE\'s answer', r.status === 200 && r.j.rule && r.j.rule.on === false && r.j.decide === false && r.j.rows.length === 0, r.j);
  r = await AD.eng({ action: 'rfiRule', on: true, from: D0 });
  ok('   the Admin cannot switch the rule on (Super Admin only)', r.status === 403, r.j);
  // Embankment Top done on LHS 40+000–40+500 (4 days ago) – nothing below it was ever reported there: nothing stops it
  const rep = (c, day, extra, x) => c.eng(Object.assign({ action: 'reportSave', day: day, report: { lines: [], extra: extra, note: '' }, ver: 0 }, x || {}));
  r = await SA.eng({ action: 'rfiRule', on: true, from: D0 });
  ok('the Super Admin switches the rule on from ' + D0, r.status === 200 && r.j.rule.on === true && r.j.rule.from === D0, r.j);
  r = await rep(AD, add(TODAY, -4), [{ work: EMB, layer: 'L2', side: 'LHS', from: '40+000', to: '40+500', reason: 'rig test' }]);
  ok('Embankment Top on LHS 40+000–40+500 reported (nothing below it reported there – not stopped)', r.status === 200, r.j);
  const plan = (c, lines, x) => c.eng(Object.assign({ action: 'planSave', day: TODAY, lines: lines, ver: 0 }, x || {}));
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+300' }]);
  ok('the next layer (Subgrade Layer 1) planned on it: STOPPED – Embankment Top is not approved there', r.status === 400 && r.j.code === 'rfi' && /^Line 1 \(LHS\): Embankment · Top is not approved by the IE on 40\+000–40\+300\./.test(r.j.error), r.j);
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'Both', from: '40+000', to: '40+300' }]);
  ok('   "Both": stopped for LHS only (nothing done on RHS)', r.status === 400 && /\(LHS\)/.test(r.j.error) && !/\(RHS\)/.test(r.j.error), r.j);
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'RHS', from: '40+000', to: '40+300' }, { work: SUB, layer: 'L1', side: 'LHS', from: '41+000', to: '41+300' }]);
  ok('   where the layer below was never reported: not stopped', r.status === 200, r.j);
  let ver = r.j.doc.ver;
  // ---- the RFI ----
  const ask = (c, x) => c.eng(Object.assign({ action: 'rfiSave', day: add(TODAY, -4), work: EMB, layer: 'L2', side: 'LHS', from: '40+000', to: '40+400' }, x || {}));
  r = await ask(U2);
  ok('eng2 (GSB only) cannot ask an RFI of Embankment', r.status === 403 && /not given to you/.test(r.j.error), r.j);
  r = await ask(U1, { day: add(TODAY, 1) });
  ok('   an RFI of a day not come yet: refused', r.status === 400, r.j);
  r = await ask(U1, { from: '40+400', to: '40+000' });
  ok('   "to" before "from": refused', r.status === 400 && /The RFI: the chainage "to"/.test(r.j.error), r.j);
  r = await ask(U1, { note: 'ready for inspection' });
  ok('eng1 asks RFI-0001: Embankment Top, LHS 40+000–40+400 – waiting', r.status === 200 && r.j.rfi.no === 'RFI-0001' && r.j.rfi.status === 'Pending' && r.j.rfi.ch_to === 40400, r.j);
  const R1 = r.j.rfi;
  r = await U1.eng({ action: 'rfiDecide', no: R1.no, ver: R1.ver, status: 'Approved', ie_day: TODAY });
  ok('   eng1 cannot record the IE\'s answer', r.status === 403, r.j);
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+300' }], { ver: ver });
  ok('   while it waits: still stopped', r.status === 400 && r.j.code === 'rfi', r.j);
  r = await AD.eng({ action: 'rfiDecide', no: R1.no, ver: R1.ver, status: 'Approved', ie_day: add(TODAY, -5), ie_name: 'Mr IE' });
  ok('   the IE\'s answer before the day of the RFI: refused', r.status === 400 && /on or after the day of the RFI/.test(r.j.error), r.j);
  r = await AD.eng({ action: 'rfiDecide', no: R1.no, ver: R1.ver, status: 'Approved', ie_day: add(TODAY, -1), ie_name: 'Mr IE', ie_ref: 'RFI/18B/0042' });
  ok('the Admin records the IE\'s answer: Approved', r.status === 200 && r.j.rfi.status === 'Approved' && r.j.rfi.ie_ref === 'RFI/18B/0042' && r.j.rfi.decided_by === 'sujit@rcl.test', r.j);
  r = await AD.eng({ action: 'rfiDecide', no: R1.no, ver: R1.ver, status: 'Rejected', ie_day: TODAY, ie_remark: 'again' });
  ok('   decided once: not again', r.status === 400 && /Approved already/.test(r.j.error), r.j);
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+300' }], { ver: ver });
  ok('now Subgrade Layer 1 on LHS 40+000–40+300 is planned (approved below)', r.status === 200, r.j); ver = r.j.doc.ver;
  r = await plan(AD, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+500' }], { ver: ver });
  ok('   up to 40+500: stopped on 40+400–40+500 (not in the approved RFI)', r.status === 400 && /40\+400–40\+500/.test(r.j.error), r.j);
  r = await plan(SA, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+500' }], { ver: ver, email: 'sujit@rcl.test', rfiSkip: 'ok' });
  ok('   the Super Admin with a reason too short: still stopped', r.status === 400 && r.j.code === 'rfi', r.j);
  r = await plan(SA, [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+000', to: '40+500' }], { ver: ver, email: 'sujit@rcl.test', rfiSkip: 'IE checked on site, letter follows' });
  ok('   the Super Admin lets it through with a reason – kept in the activity record', r.status === 200 && sql('rcl_eng', "select detail->'rfiSkip'->>'reason' from eng_activity where action = 'Plan changed' order by id desc limit 1") === 'IE checked on site, letter follows', r.j);
  r = await rep(AD, add(TODAY, -1), [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+400', to: '40+500', reason: 'rig' }]);
  ok('the report is checked too: Subgrade on 40+400–40+500 reported done – stopped', r.status === 400 && r.j.code === 'rfi', r.j);
  // rejected and cancelled
  r = await ask(U1, { from: '40+400', to: '40+500' }); const R2 = r.j.rfi;
  ok('RFI-0002 asked for 40+400–40+500', r.status === 200 && R2.no === 'RFI-0002', r.j);
  r = await AD.eng({ action: 'rfiDecide', no: R2.no, ver: R2.ver, status: 'Rejected', ie_day: TODAY });
  ok('   rejected without why: refused', r.status === 400 && /why the IE rejected/.test(r.j.error), r.j);
  r = await AD.eng({ action: 'rfiDecide', no: R2.no, ver: R2.ver, status: 'Rejected', ie_day: TODAY, ie_remark: 'compaction low – redo' });
  ok('   rejected (compaction low – redo): the stretch stays stopped', r.status === 200 && r.j.rfi.status === 'Rejected' && (await rep(AD, add(TODAY, -1), [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+400', to: '40+500', reason: 'rig' }])).j.code === 'rfi', r.j);
  r = await ask(U1, { from: '40+400', to: '40+500', note: 'after rework' }); const R3 = r.j.rfi;
  r = await U1.eng({ action: 'rfiSave', no: R3.no, ver: R3.ver, day: add(TODAY, -4), work: EMB, layer: 'L2', side: 'LHS', from: '40+400', to: '40+480', note: 'changed' });
  ok('RFI-0003 asked and changed while it waits (the earlier one kept)', r.status === 200 && r.j.rfi.ch_to === 40480 && r.j.rfi.history.length === 1 && r.j.rfi.ver === 2, r.j);
  r = await U2.eng({ action: 'rfiCancel', no: R3.no, ver: 2 });
  ok('   eng2 cannot cancel eng1\'s RFI', r.status === 403, r.j);
  r = await U1.eng({ action: 'rfiCancel', no: R3.no, ver: 1 });
  ok('   with the version of before (changed meanwhile): refused', r.status === 409 && r.j.code === 'changed', r.j);
  r = await U1.eng({ action: 'rfiCancel', no: R3.no, ver: 2 });
  ok('   eng1 cancels it – kept as Cancelled', r.status === 200 && r.j.rfi.status === 'Cancelled', r.j);
  // numbers never given twice, also at the same moment
  const many = await Promise.all([0, 1, 2, 3, 4].map(i => ask(U1, { from: 42000 + i * 100, to: 42100 + i * 100 })));
  ok('five RFIs asked at the same moment: five different numbers (RFI-0004 … RFI-0008)', many.every(x => x.status === 200) && new Set(many.map(x => x.j.rfi.no)).size === 5 && many.map(x => x.j.rfi.no).sort().join() === 'RFI-0004,RFI-0005,RFI-0006,RFI-0007,RFI-0008', many.map(x => x.j));
  r = await AD.eng({ action: 'rfiList', from: add(TODAY, -30), to: TODAY, status: 'Pending' });
  ok('the list of the waiting ones (the Admin may record answers)', r.status === 200 && r.j.decide === true && r.j.rows.length === 5 && r.j.rows.every(x => x.status === 'Pending'), r.j);
  // the strip chart: Embankment Top on LHS, 40+400–40+500 not approved → striped
  r = await U1.eng({ action: 'strip', day: TODAY });
  const lhs = ((r.j.strip || {}).LHS || {}).pieces || [], piece = lhs.find(p => p.from <= 40000 && p.to >= 40500);
  ok('the strip chart says the rule is on and marks the stretch done but not approved (striped)', r.status === 200 && r.j.rfi === true && piece && JSON.stringify(piece.open) === '[[40400,40500]]', piece || lhs);
  // ---- the rule off: nothing stopped ----
  r = await SA.eng({ action: 'rfiRule', on: false });
  ok('the rule switched off: the same report now goes through', r.status === 200 && r.j.rule.on === false && (await rep(AD, add(TODAY, -1), [{ work: SUB, layer: 'L1', side: 'LHS', from: '40+400', to: '40+500', reason: 'rig' }])).status === 200, r.j);

  // ---- HINDRANCES ----
  const hs = (c, x) => c.eng(Object.assign({ action: 'hindSave' }, x));
  r = await hs(U2, { from_day: add(TODAY, 1), kind: 'Rain' });
  ok('a hindrance from a day not come yet: refused', r.status === 400, r.j);
  r = await hs(U2, { from_day: add(TODAY, -10), kind: '' });
  ok('   without saying what it is: refused', r.status === 400 && /Say what the hindrance is/.test(r.j.error), r.j);
  r = await hs(U2, { from_day: add(TODAY, -10), kind: 'Land not handed over', ch_from: '55+000', ch_to: '56+000', side: 'LHS', works: [GSB], letter: 'NHAI/18B/311' });
  ok('eng2 adds H-0001: land not handed over, LHS 55+000–56+000, stops GSB – still on', r.status === 200 && r.j.hindrance.no === 'H-0001' && r.j.hindrance.status === 'Open' && r.j.hindrance.ch_from === 55000, r.j);
  const H1 = r.j.hindrance;
  r = await hs(SA, { from_day: add(TODAY, -3), to_day: add(TODAY, -2), kind: 'Heavy rain' });
  ok('the Super Admin adds H-0002: heavy rain, every work, the whole road, 2 days', r.status === 200 && r.j.hindrance.status === 'Closed' && r.j.hindrance.works.length === 0, r.j);
  r = await U1.eng({ action: 'hindList', from: add(TODAY, -30), to: TODAY });
  const h1 = (r.j.rows || []).find(h => h.no === 'H-0001'), gsb = (r.j.works || []).find(w => w.work === GSB), every = (r.j.works || []).find(w => w.work === '*');
  ok('the list: H-0001 11 days (still on), H-0002 2 days; days per work; the kinds typed are suggested', r.status === 200 && h1 && h1.days === 11 && r.j.open === 1 && gsb && gsb.days === 11 && gsb.open === 1 && every && every.days === 2 && r.j.kinds.indexOf('Land not handed over') > -1, r.j);
  r = await hs(U1, { no: H1.no, ver: H1.ver, from_day: H1.from_day, to_day: add(TODAY, -1), kind: H1.kind, works: [GSB] });
  ok('   eng1 cannot change eng2\'s hindrance', r.status === 403, r.j);
  r = await hs(AD, { no: H1.no, ver: H1.ver, from_day: H1.from_day, to_day: add(TODAY, -2), kind: H1.kind, ch_from: 55000, ch_to: 56000, side: 'LHS', works: [GSB], letter: H1.letter });
  ok('   the Admin ends it (to = 2 days ago): Closed, 9 days; the earlier one kept', r.status === 200 && r.j.hindrance.status === 'Closed' && r.j.hindrance.history.length === 1, r.j);
  r = await U1.eng({ action: 'hindList', from: add(TODAY, -30), to: TODAY });
  ok('   …and the list says 9 days', (r.j.rows.find(h => h.no === 'H-0001') || {}).days === 9 && r.j.open === 0, r.j);
  // ---- PPC in Performance ----
  r = await AD.eng({ action: 'perf', from: add(TODAY, -20), to: TODAY });
  ok('Performance carries PPC (plan lines done as planned) per person, week by week, and the reasons most often first', r.status === 200 && r.j.ppc && 'pct' in r.j.ppc && Array.isArray(r.j.weeks) && r.j.weeks.length >= 3 && Array.isArray(r.j.reasons) && r.j.people.every(p => p.ppc && 'lines' in p.ppc), r.j);
  // ---- every save noted (activity) ----
  ok('who did what is kept: RFI asked / Approved / Rejected / cancelled, rule, hindrances', ['RFI asked', 'RFI Approved', 'RFI Rejected', 'RFI cancelled', 'RFI changed', 'RFI rule', 'Hindrance added', 'Hindrance closed'].every(a => Number(sql('rcl_eng', "select count(*) from eng_activity where site = 'S1' and action = '" + a + "'")) > 0));

  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + ((e && e.stack) || e)); process.exit(1); });
