/* (10-11-2026, Engineering 2B) THE MEASUREMENT BOOK in the browser, on the local rig (never live): the register, the abstract, a new MB
 * page made in the page (found from the reports, a width measured with a remark), sent back, corrected, check-measured by another person,
 * locked, printed alone on A4 with the site's name; a phone's width; a User has no MB; the 🎙 in its boxes.
 *   Run test/api.test.js and then test/mb.test.js first (their road, works, people and MB pages).
 *       NODE_PATH=/home/claude/test/node_modules timeout 400 node test/mb.browser.test.js      (pictures in test/shots/mb_*.png)
 * Uses the Chromium of the rig (/home/claude/test/node_modules). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const D5 = add(TODAY, -4), MBE = 'mb.eng@rcl.test';
// a node-side sign-in (the Super Admin enters MB Engineer's report of D5 – as in test/mb.test.js)
function client(base) {
  let cookie = '';
  return async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
}

(async () => {
  if (sql('rcl_eng', "select count(*) from eng_mb where site = 'S1'") === '0') { console.log('Run test/api.test.js and test/mb.test.js first.'); process.exit(1); }
  const saPw = (await fetch(P + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: 'sa@rcl.test', password: 'Super#Admin2040' }) })).status === 200 ? 'Super#Admin2040' : 'Super#Admin2041';
  // its own start: no MB page of D5, MB Engineer's report of D5 – Subgrade Layer 1 LHS 34+000–34+300 and RHS 34+000–34+200
  sql('rcl_eng', "delete from eng_mb where site = 'S1' and lines @> '[{\"day\": \"" + D5 + "\"}]'; delete from eng_days where site = 'S1' and email = '" + MBE + "' and day = '" + D5 + "'; delete from eng_settings where site = 'S1' and key = 'rfi';");
  sql('rcl_portal', "delete from counters; update users set start_item = null where email in ('sa@rcl.test', 'sujit@rcl.test', 'eng1@rcl.test');");
  { const p = client(P); await p('/api/auth', { action: 'login', email: 'sa@rcl.test', password: saPw }); const e = client(E); await e('/api/sso', { ticket: ((await p('/api/go?module=engineering&site=S1')).loc.split('#sso=')[1] || '') });
    const r = await e('/api/eng', { action: 'reportSave', day: D5, email: MBE, report: { lines: [], extra: [{ work: 'W-002', layer: 'L1', side: 'LHS', from: '34+000', to: '34+300' }, { work: 'W-002', layer: 'L1', side: 'RHS', from: '34+000', to: '34+200' }], note: '' }, ver: 0 });
    ok('the start: MB Engineer\'s report of ' + D5 + ' (Subgrade Layer 1 LHS 34+000–34+300, RHS 34+000–34+200)', r.status === 200, r.j); }
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  async function open(email, pw) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200)));
    await p.evaluateOnNewDocument(() => { window.webkitSpeechRecognition = window.webkitSpeechRecognition || function () {}; });      // (a stand-in: this Chromium has no speech of its own – the 🎙 shows where a browser can listen)
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(E + '/', { waitUntil: 'load' });
    await until(() => p.url().startsWith(P) && p.evaluate(() => !document.getElementById('v_login').hidden));
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', email); await p.type('#l_pass', pw); await p.click('#l_btn');
    const where = await until(() => p.url().startsWith(E) ? 'eng' : p.evaluate(() => !document.getElementById('v_home').hidden ? 'home' : !document.getElementById('v_sa').hidden ? 'sa' : ''), 30000);
    if (where === 'home') await p.evaluate(() => { const a = [...document.querySelectorAll('#h_sites a.mod')].find(x => /module=engineering&site=S1/.test(x.getAttribute('href'))); if (a) a.click(); });
    else if (where === 'sa') await p.goto(E + '/#site=S1', { waitUntil: 'load' });
    await until(() => p.url().startsWith(E) && p.evaluate(() => !document.getElementById('v_app').hidden && !!document.querySelector('#eng_pages .navbtn') && !!document.body.dataset.loaded), 30000);      // (its first page has its data)
    return { p, ctx };
  }
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, 'mb_' + n + '.png'), fullPage: true });
  const page = async (p, k) => { await p.evaluate(k => document.querySelector('#eng_pages [data-page="' + k + '"]').click(), k); await until(() => p.evaluate(k => document.body.dataset.loaded === k, k), 20000); };
  const dlg = p => until(() => p.evaluate(() => !document.getElementById('dlg').hidden), 8000);
  const press = (p, label) => p.evaluate(l => { const x = [...document.querySelectorAll('#dlg_btns button')].find(y => y.textContent === l); if (x) x.click(); return !!x; }, label);
  const set = (p, id, v) => p.evaluate((id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
  const rowSet = (p, side, cls, v) => p.evaluate((side, cls, v) => { const tr = [...document.querySelectorAll('#mo_rows tr')].find(t => t.children[2].textContent === side); const i = tr.querySelector(cls); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, side, cls, v);
  const sheet = p => p.evaluate(() => ({ shown: !document.getElementById('mb_sheet').hidden, h: (document.querySelector('#mb_sheet h2') || {}).textContent || '', st: (document.querySelector('#mb_sheet .sh-st') || {}).textContent || '', meta: (document.querySelector('#mb_sheet .sh-meta') || {}).textContent || '',
    btns: [...document.querySelectorAll('#mb_sheet .bar button')].map(x => x.id), rows: document.querySelectorAll('#mb_sheet .mbt tbody tr').length, hist: document.querySelectorAll('#mb_sheet .readline').length, err: (document.querySelector('#mb_sheet .errbox') || {}).textContent || '' }));
  const openNo = async (p, no) => {
    await page(p, 'mb');
    const hit = await until(() => p.evaluate(no => { const x = document.querySelector('#mb_rows [data-mbopen="' + no + '"]'); if (x) x.click(); return !!x; }, no), 15000);
    return (hit && await until(() => sheet(p).then(s => s.shown && s.h.indexOf(no) > -1 && s))) || { why: await p.evaluate(() => ({ loaded: document.body.dataset.loaded, rows: [...document.querySelectorAll('#mb_rows tr')].map(t => t.textContent.slice(0, 40)), list: !document.getElementById('mb_list').hidden, toast: document.getElementById('toast').textContent })) };
  };
  try {
    // ================= the Admin (sujit): the register and the abstract =================
    const AD = await open('sujit@rcl.test', 'Nashik#Road848!');
    const menu = await AD.p.evaluate(() => [...document.querySelectorAll('#eng_pages .navbtn')].map(x => x.textContent.trim()));
    ok('the Admin\'s menu has "Measurement Book"', menu.indexOf('Measurement Book') > -1, menu);
    await page(AD.p, 'mb');
    const reg = await until(() => AD.p.evaluate(() => [...document.querySelectorAll('#mb_rows tr')].map(t => t.textContent)).then(x => x.length >= 5 && x));
    ok('the MB register: every page with its date, work · layer, lines, quantity, status, who measured / checked', !!reg && reg.some(t => /MB-0001.*Subgrade · Layer 1.*2,262\.500 cum.*Check-measured/.test(t)) && reg.some(t => /Measured – to check/.test(t)), reg);
    await shot(AD.p, 'register');
    await AD.p.evaluate(() => document.querySelector('#mb_tabs [data-t="abs"]').click());
    await set(AD.p, 'ab_from', add(TODAY, -3)); await set(AD.p, 'ab_to', TODAY); await AD.p.click('#ab_go');
    const abs = await until(() => AD.p.evaluate(() => [...document.querySelectorAll('#ab_rows tr')].map(t => [...t.children].map(c => c.textContent).join(' | '))).then(x => x.some(t => /Subgrade · Layer 1/.test(t)) && x));
    ok('the abstract for the RA bill: Subgrade · Layer 1 – up to the previous period 2,262.500, this period 225.000, cumulative 2,487.500 cum', !!abs && abs.some(t => /^Subgrade · Layer 1 \| cum \| 2,262\.500 \| 225\.000 \| 2,487\.500 \| MB-\d{4}$/.test(t)), abs);
    const note = await AD.p.evaluate(() => document.getElementById('ab_note').textContent);
    ok('   it names the page of the period not check-measured yet, and says the RA bill itself is not made here', /not check-measured yet – not counted: MB-\d{4}/.test(note) && /RA bill itself .* is not made here/.test(note), note);
    await shot(AD.p, 'abstract');
    // ================= a new MB page, made in the page =================
    await AD.p.evaluate(() => document.querySelector('#mb_tabs [data-t="list"]').click()); await wait(200);
    await AD.p.click('#mb_new'); await until(() => AD.p.evaluate(() => !document.getElementById('mb_form').hidden));
    await set(AD.p, 'mo_work', 'W-002'); await set(AD.p, 'mo_layer', 'L1'); await set(AD.p, 'mo_from', D5); await set(AD.p, 'mo_to', D5);
    await AD.p.click('#mo_find');
    const rows = await until(() => AD.p.evaluate(() => [...document.querySelectorAll('#mo_rows tr')].map(t => [t.children[2].textContent, t.children[3].textContent, t.querySelector('.mo-q').textContent, t.querySelector('.mo-how').textContent])).then(x => x.length === 2 && x));
    // LHS (8.0 m from the new period, 300 mm): 300 × 8 × 0.3 = 720; RHS (7.5 m): 200 × 7.5 × 0.3 = 450
    ok('"Find the work not measured": LHS 34+000–34+300 720 cum (300 × 8 × 0.3), RHS 34+000–34+200 450 cum (200 × 7.5 × 0.3) – each figure shown', !!rows && rows[0][0] === 'LHS' && rows[0][1] === '34+000 – 34+300' && rows[0][2] === '720.000 cum' && /^300 m × 8 m × 0\.3 m \(300 mm\)$/.test(rows[0][3]) && rows[1][0] === 'RHS' && rows[1][2] === '450.000 cum', rows);
    await rowSet(AD.p, 'LHS', '.mo-w', '7.9');
    const live = await AD.p.evaluate(() => ({ q: document.querySelector('#mo_rows tr .mo-q').textContent, tot: document.getElementById('mo_tot').textContent }));
    ok('   the width measured 7.9 m: the line shows 711.000 cum at once (300 × 7.9 × 0.3), the page 1,161.000 cum', live.q === '711.000 cum' && /2 lines ticked · 1,161\.000 cum/.test(live.tot), live);
    await shot(AD.p, 'form');
    await AD.p.click('#mo_save');
    const t1 = await until(() => AD.p.evaluate(() => !document.getElementById('toast').hidden && document.getElementById('toast').textContent).then(t => /differs from the masters/.test(t) && t));
    ok('   saved without a remark: refused – "the width differs from the masters (8 m) – write a remark"', !!t1 && /Line 1 \(LHS 34\+000–34\+300\): the width differs from the masters \(8 m\)/.test(t1), t1);
    await rowSet(AD.p, 'LHS', '.mo-rem', 'measured 7.90 m');
    await AD.p.click('#mo_save');
    const s1 = await until(() => sheet(AD.p).then(s => s.shown && /MB-\d{4}/.test(s.h) && s));
    const NO = s1 && (/MB-\d{4}/.exec(s1.h) || [])[0];
    ok('saved as MEASURED: the page opens – ' + NO + ', Measured – to check, 2 lines, 1,161.000 cum; no "Check-measured" for the one who measured it', !!s1 && /Measured – to check/.test(s1.st) && s1.rows === 2 && /1,161\.000 cum/.test(s1.meta) && s1.btns.indexOf('ms_check') < 0 && s1.btns.indexOf('ms_chg') > -1, s1);
    await shot(AD.p, 'sheet');
    // ================= the Super Admin: sends it back =================
    const SA = await open('sa@rcl.test', saPw);
    let s2 = await openNo(SA.p, NO);
    ok('the Super Admin opens ' + NO + ': "Check-measured" and "Send back" are his', !!s2 && !s2.why && s2.btns.indexOf('ms_check') > -1 && s2.btns.indexOf('ms_sendback') > -1, s2);
    await SA.p.click('#ms_sendback'); await dlg(SA.p);
    await SA.p.evaluate(() => { document.getElementById('mk_why').value = 'RHS width – measure again'; }); await press(SA.p, 'Send back');
    s2 = await until(() => sheet(SA.p).then(s => /Sent back/.test(s.st) && s));
    ok('   sent back – why it is said on the page', !!s2 && /RHS width – measure again/.test(s2.err), s2);
    // ================= sujit corrects it and measures it again =================
    let s3 = await openNo(AD.p, NO);
    ok('sujit sees it sent back – "Correct and measure again"', !!s3 && /Sent back/.test(s3.st) && await AD.p.evaluate(() => (document.getElementById('ms_chg') || {}).textContent === 'Correct and measure again'), s3);
    await AD.p.click('#ms_chg');
    const kept = await until(() => AD.p.evaluate(() => { const r = [...document.querySelectorAll('#mo_rows tr')]; return r.length === 2 && { on: r.map(t => t.querySelector('.mo-on').checked), w: r[0].querySelector('.mo-w').value, rem: r[0].querySelector('.mo-rem').value, h: document.getElementById('mo_h').textContent, fixed: document.getElementById('mo_work').disabled }; }));
    ok('   the form has his 2 lines, ticked, with what he measured (7.9 m, its remark); the work and days stay', !!kept && kept.on.join() === 'true,true' && kept.w === '7.9' && kept.rem === 'measured 7.90 m' && kept.fixed && /Correct MB-\d{4} and measure it again/.test(kept.h), kept);
    await rowSet(AD.p, 'RHS', '.mo-w', '7.4'); await rowSet(AD.p, 'RHS', '.mo-rem', 'measured 7.40 m');
    await AD.p.click('#mo_save');
    s3 = await until(() => sheet(AD.p).then(s => s.shown && /Measured – to check/.test(s.st) && s));
    // RHS: 200 × 7.4 × 0.3 = 444 → 711 + 444 = 1,155 cum
    ok('   measured again: 1,155.000 cum (711 + 200 × 7.4 × 0.3 = 444); the changes kept (✎)', !!s3 && /1,155\.000 cum/.test(s3.meta) && s3.hist === 3, s3);
    // ================= the Super Admin check-measures it – locked =================
    await openNo(SA.p, NO);
    await SA.p.click('#ms_check'); await dlg(SA.p);
    await SA.p.evaluate(() => { document.getElementById('mc_rem').value = 'checked on site'; }); await press(SA.p, 'Check-measured');
    const s4 = await until(() => sheet(SA.p).then(s => /Check-measured · locked/.test(s.st) && s));
    ok('the Super Admin CHECK-MEASURES it: locked – no change, no check any more; every change listed (4)', !!s4 && s4.btns.indexOf('ms_chg') < 0 && s4.btns.indexOf('ms_check') < 0 && s4.hist === 4 && await SA.p.evaluate(() => /checked on site/.test(document.querySelector('#mb_sheet .sh-sign').textContent)), s4);
    await shot(SA.p, 'checked');
    // ================= print: the page alone, on A4, with the site's name =================
    await SA.p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await SA.p.click('#ms_print');
    await SA.p.emulateMediaType('print');
    const pr = await SA.p.evaluate(() => { const vis = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; };
      return { printed: window.__printed, cls: document.body.classList.contains('print-mb'), sheet: vis('mb_sheet'), list: vis('mb_list'), tabs: vis('mb_tabs'), side: getComputedStyle(document.getElementById('side')).display, bar: getComputedStyle(document.querySelector('#mb_sheet .bar')).display, site: document.querySelector('#mb_sheet .sh-top .muted').textContent }; });
    ok('Print (A4): only the MB page is printed – the menu, the list, the buttons hidden; the site\'s name on it', pr.printed === 1 && pr.cls && pr.sheet && !pr.list && !pr.tabs && pr.side === 'none' && pr.bar === 'none' && /Engineering/.test(pr.site) && pr.site.length > 14, pr);
    await SA.p.pdf({ path: path.join(SHOTS, 'mb_print.pdf'), preferCSSPageSize: true, printBackground: true });
    const pdf = fs.readFileSync(path.join(SHOTS, 'mb_print.pdf')).toString('latin1'), box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf);
    ok('   the printed page is A4 (595 × 842 points)', !!box && Math.abs(Number(box[1]) - 595.3) < 1.5 && Math.abs(Number(box[2]) - 841.9) < 1.5, box && box[0]);
    await shot(SA.p, 'print');
    await SA.p.emulateMediaType(null); await SA.p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    ok('   after printing, the page is as before', !(await SA.p.evaluate(() => document.body.classList.contains('print-mb'))));
    // ================= the 🎙 in the MB boxes =================
    await page(AD.p, 'mb'); await AD.p.click('#mb_new'); await until(() => AD.p.evaluate(() => !document.getElementById('mb_form').hidden));
    await AD.p.focus('#mo_note'); await wait(300);
    const mic1 = await AD.p.evaluate(() => { const x = document.getElementById('rclv_btn'); return !!x && getComputedStyle(x).display === 'flex'; });
    ok('the 🎙 in the MB\'s boxes (the note; voice.js – a new box gets it by itself)', mic1, mic1);
    // ================= a phone's width =================
    await AD.p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });      // (a phone: the page is loaded again)
    await until(() => AD.p.evaluate(() => !document.getElementById('v_app').hidden && !!document.querySelector('#eng_pages [data-page="mb"]') && !!document.body.dataset.loaded), 30000);
    await page(AD.p, 'mb');
    await until(() => AD.p.evaluate(() => document.querySelectorAll('#mb_rows tr').length >= 5));
    const ph1 = await AD.p.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, rows: document.querySelectorAll('#mb_rows tr').length }));
    await shot(AD.p, 'phone_register');
    await AD.p.evaluate(no => document.querySelector('#mb_rows [data-mbopen="' + no + '"]').click(), NO);
    await until(() => sheet(AD.p).then(s => s.shown && s.h.indexOf(NO) > -1));
    const ph2 = await AD.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(AD.p, 'phone_sheet');
    await page(AD.p, 'mb'); await AD.p.click('#mb_new'); await until(() => AD.p.evaluate(() => !document.getElementById('mb_form').hidden));
    const ph3 = await AD.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(AD.p, 'phone_form');
    ok('a phone\'s width (390 px): the register, a page and the form fit – no sideways scroll of the page (tables scroll in their box)', ph1.over <= 1 && ph2 <= 1 && ph3 <= 1 && ph1.rows >= 5, [ph1, ph2, ph3]);
    // ================= a User has no MB =================
    const U1 = await open('eng1@rcl.test', 'Audit#PassView9!x');
    const um = await U1.p.evaluate(() => [...document.querySelectorAll('#eng_pages .navbtn')].map(x => x.textContent.trim()));
    await U1.p.evaluate(() => { location.hash = 'page=mb'; }); await wait(800);
    const ut = await U1.p.evaluate(() => ({ title: document.getElementById('pg_title').textContent, mb: !document.getElementById('pg_mb').hidden }));
    ok('a User: no "Measurement Book" in his menu; asked for by its address – My work opens', um.indexOf('Measurement Book') < 0 && ut.title === 'My work' && !ut.mb, [um, ut]);
    ok('no script error on any page', !errs.length, errs);
  } catch (e) { ok('the test ran to its end', false, String((e && e.stack) || e).slice(0, 1500)); }
  finally { await b.close(); }
  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + ((e && e.stack) || e)); process.exit(1); });
