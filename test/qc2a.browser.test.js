/* (09-11-2026, Engineering 2A) RFI, Hindrances, the RFI rule and PPC in the browser, on the local rig (never live).
 *   Run test/api.test.js and then test/qc2a.test.js first (their road, works, people, RFIs and hindrances).
 *       timeout 400 node test/qc2a.browser.test.js      (pictures in test/shots/qc2a_*.png)
 * Uses the Chromium of the rig (/home/claude/test/node_modules). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

(async () => {
  if (sql('rcl_eng', "select count(*) from eng_rfi where site = 'S1'") === '0') { console.log('Run test/api.test.js and test/qc2a.test.js first.'); process.exit(1); }
  sql('rcl_portal', "delete from counters; update users set start_item = null where email in ('sa@rcl.test', 'sujit@rcl.test', 'eng1@rcl.test');");
  sql('rcl_eng', "delete from eng_days where site = 'S1' and email = 'sujit@rcl.test' and day = '" + add(TODAY, 1) + "';");
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  async function open(email, pw) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200)));
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(E + '/', { waitUntil: 'load' });
    await until(() => p.url().startsWith(P) && p.evaluate(() => !document.getElementById('v_login').hidden));
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', email); await p.type('#l_pass', pw); await p.click('#l_btn');
    const where = await until(() => p.url().startsWith(E) ? 'eng' : p.evaluate(() => !document.getElementById('v_home').hidden ? 'home' : !document.getElementById('v_sa').hidden ? 'sa' : ''), 30000);
    if (where === 'home') await p.evaluate(() => { const a = [...document.querySelectorAll('#h_sites a.mod')].find(x => /module=engineering&site=S1/.test(x.getAttribute('href'))); if (a) a.click(); });
    else if (where === 'sa') await p.goto(E + '/#site=S1', { waitUntil: 'load' });
    await until(() => p.url().startsWith(E) && p.evaluate(() => !document.getElementById('v_app').hidden && !!document.querySelector('#eng_pages .navbtn')), 30000);
    return { p, ctx };
  }
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, 'qc2a_' + n + '.png'), fullPage: true });
  const page = async (p, k) => { await p.evaluate(k => document.querySelector('#eng_pages [data-page="' + k + '"]').click(), k); await until(() => p.evaluate(k => document.body.dataset.loaded === k, k), 20000); };
  const dlg = p => until(() => p.evaluate(() => !document.getElementById('dlg').hidden), 8000);
  const press = (p, label) => p.evaluate(l => { const x = [...document.querySelectorAll('#dlg_btns button')].find(y => y.textContent === l); if (x) x.click(); return !!x; }, label);
  try {
    // ---- the Super Admin: switches the rule on (Set-up → RFI rule) ----
    // (the Portal's own test, run first on the rig, may leave the Super Admin's test password as …2041)
    const saPw = (await fetch(P + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: 'sa@rcl.test', password: 'Super#Admin2040' }) })).status === 200 ? 'Super#Admin2040' : 'Super#Admin2041';
    const SA = await open('sa@rcl.test', saPw);
    await page(SA.p, 'setup');
    await SA.p.evaluate(() => document.querySelector('#su_tabs [data-t="rule"]').click()); await wait(300);
    await SA.p.evaluate(d => { document.getElementById('ru_on').value = '1'; document.getElementById('ru_from').value = d; document.getElementById('ru_save').click(); }, add(TODAY, -5));
    const now = await until(() => SA.p.evaluate(() => /on from/.test(document.getElementById('ru_now').textContent) && document.getElementById('ru_now').textContent));
    ok('Set-up → RFI rule: the Super Admin switches it on from a day', !!now && sql('rcl_eng', "select value->>'on' from eng_settings where site = 'S1' and key = 'rfi'") === 'true', now);
    await shot(SA.p, 'rule');
    // ---- the RFI page ----
    await page(SA.p, 'rfi');
    await SA.p.evaluate(() => document.querySelector('#rf_st [data-s=""]').click()); await until(() => SA.p.evaluate(() => document.querySelectorAll('#rf_rows tr').length > 3));
    const rows = await SA.p.evaluate(() => ({ rule: document.getElementById('rf_rule').textContent, n: document.querySelectorAll('#rf_rows tr').length, st: [...document.querySelectorAll('#rf_rows tr td:nth-child(6)')].map(t => t.textContent) }));
    ok('the RFI page: the rule ON, every RFI with its status (Approved, Rejected, Cancelled, Waiting)', /RFI rule ON/.test(rows.rule) && rows.n >= 8 && ['Approved', 'Rejected', 'Cancelled', 'Waiting'].every(s => rows.st.indexOf(s) > -1), rows);
    await shot(SA.p, 'rfi_list');
    // ---- eng1 asks an RFI in the page ----
    const U1 = await open('eng1@rcl.test', 'Audit#PassView9!x');
    await page(U1.p, 'rfi');
    await U1.p.evaluate(() => document.getElementById('rf_new').click()); await dlg(U1.p);
    await U1.p.evaluate(d => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('rq_day', d); set('rq_work', 'W-001'); set('rq_layer', 'L2'); set('rq_side', 'LHS'); set('rq_from', '40+480'); set('rq_to', '40+500'); set('rq_note', 'browser'); }, add(TODAY, -4));
    await shot(U1.p, 'rfi_ask');
    await press(U1.p, 'Ask RFI');
    const asked = await until(() => U1.p.evaluate(() => [...document.querySelectorAll('#rf_rows tr')].map(t => t.textContent).find(t => /40\+480 – 40\+500/.test(t))), 15000);
    ok('eng1 asks an RFI in the page (Embankment · Top, LHS 40+480–40+500): it is in the list, waiting', !!asked && /Waiting/.test(asked) && /Embankment · Top/.test(asked), asked);
    const hasDecide = await U1.p.evaluate(() => !!document.querySelector('#rf_rows [data-rdec]'));
    ok('   a User has no "IE\'s answer" button', !hasDecide);
    // ---- the Admin records the IE's answer in the page ----
    const AD = await open('sujit@rcl.test', 'Nashik#Road848!');
    await page(AD.p, 'rfi');
    const no = await AD.p.evaluate(() => { const tr = [...document.querySelectorAll('#rf_rows tr')].find(t => /40\+480 – 40\+500/.test(t.textContent)); const b = tr && tr.querySelector('[data-rdec]'); if (b) b.click(); return b ? b.dataset.rdec : ''; });
    await dlg(AD.p);
    await AD.p.evaluate(() => { document.getElementById('rd_name').value = 'Mr IE'; document.getElementById('rd_ref').value = 'RFI/18B/0099'; });
    await press(AD.p, 'Save');
    const st = await until(() => sql('rcl_eng', "select status from eng_rfi where site = 'S1' and no = '" + no + "'") === 'Approved' && 'Approved', 15000);
    ok('the Admin records the IE\'s answer in the page: ' + no + ' Approved', st === 'Approved', no);
    // ---- the strip chart: striped where done and not approved ----
    await page(SA.p, 'strip');
    const strip = await until(() => SA.p.evaluate(() => ({ striped: document.querySelectorAll('#sc_chart rect[fill="url(#rfiOpen)"]').length, legend: /Striped = IE approval/.test(document.getElementById('sc_legend').textContent) })).then(x => x.striped && x), 15000);
    ok('the strip chart: the stretch done but not approved is striped; the legend says so', !!strip && strip.legend, strip);
    await shot(SA.p, 'strip');
    // ---- the rule in My work: the Super Admin is asked "Let it through?" ----
    await page(AD.p, 'mywork');
    await AD.p.evaluate(() => { const b = [...document.querySelectorAll('#mw_dates button')].find(x => /tomorrow|Tomorrow/.test(x.textContent)); if (b) b.click(); });
    const r = await AD.p.evaluate(async d => { const x = await fetch('api/eng', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'planSave', day: d, lines: [{ work: 'W-002', layer: 'L1', side: 'LHS', from: '40+300', to: '40+450' }], ver: 0 }) }); return x.json(); }, add(TODAY, 1));
    ok('the Admin\'s plan on a stretch not approved: refused with what is missing', r.code === 'rfi' && /Embankment · Top is not approved by the IE on 40\+400–40\+450/.test(r.error), r);
    // ---- Hindrances ----
    await page(U1.p, 'hind');
    const hd = await U1.p.evaluate(() => ({ tiles: document.getElementById('hd_tiles').textContent, rows: document.querySelectorAll('#hd_rows tr').length, works: document.getElementById('hd_works').textContent }));
    ok('Hindrances: the tiles, every hindrance with its days, days by work', /Hindrances/.test(hd.tiles) && hd.rows >= 2 && /GSB/.test(hd.works), hd);
    await U1.p.evaluate(() => document.getElementById('hd_new').click()); await dlg(U1.p);
    await U1.p.evaluate(d => { document.getElementById('hq_from').value = d; document.getElementById('hq_kind').value = 'Utility shifting (HT line)'; document.getElementById('hq_cf').value = '44+000'; document.getElementById('hq_ct').value = '44+200'; const c = document.querySelector('.hq-w[value="W-001"]'); if (c) c.checked = true; }, add(TODAY, -2));
    await shot(U1.p, 'hind_add');
    await press(U1.p, 'Save');
    const added = await until(() => U1.p.evaluate(() => [...document.querySelectorAll('#hd_rows tr')].map(t => t.textContent).find(t => /Utility shifting/.test(t))), 15000);
    ok('eng1 adds a hindrance in the page: utility shifting, 44+000–44+200, stops Embankment – 3 days, still on', !!added && /still on/.test(added) && /Embankment/.test(added), added);
    await shot(U1.p, 'hind');
    // ---- Performance: PPC ----
    await page(AD.p, 'perf');
    const pf = await until(() => AD.p.evaluate(() => ({ tile: document.getElementById('pf_tiles').textContent, weeks: document.querySelectorAll('#pf_ppc .lrow').length })).then(x => /PPC/.test(x.tile) && x), 15000);
    ok('Performance: the PPC tile and PPC week by week', !!pf && pf.weeks >= 1, pf);
    await shot(AD.p, 'perf');
    ok('no script error on any page', !errs.length, errs);
  } catch (e) { ok('the test ran to its end', false, String((e && e.stack) || e).slice(0, 1500)); }
  finally {
    sql('rcl_eng', "delete from eng_settings where site = 'S1' and key = 'rfi';");      // (the rule off again for the other tests of the rig)
    await b.close();
  }
  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + ((e && e.stack) || e)); process.exit(1); });
