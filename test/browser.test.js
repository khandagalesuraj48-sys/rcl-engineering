/* Engineering in the browser, on the local rig (never live): the Portal :3010 → Engineering :3040.
 *   Run test/api.test.js first (it sets the road, sides, works, people, plans and reports this test builds on).
 *   A User: My work (his plan for tomorrow made in the page; yesterday's report sent in the page – "Done as planned", "Not done"
 *   with a reason), the "Submit report" bar; the Admin: dashboard, strip chart, all reports, reports, performance; the Super
 *   Admin: set-up (road, sides, works with a new work added, mix design, design, people and their works); a phone.
 *       timeout 400 node test/browser.test.js      (pictures in test/shots/)
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
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10), HOUR = new Date(Date.now() + IST).getUTCHours();
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const Y = add(TODAY, -1), TM = add(TODAY, 1);
const SAPW = 'Super#Admin2040', PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';

(async () => {
  if (sql('rcl_eng', "select count(distinct item) from eng_masters where site = 'S1' and kind = 'work' and data->>'name' <> 'Kerb'") !== '4') { console.log('Run test/api.test.js first.'); process.exit(1); }
  sql('rcl_portal', "delete from counters; update users set start_item = null where email in ('sa@rcl.test', 'sujit@rcl.test', 'eng1@rcl.test', 'eng2@rcl.test');");
  sql('rcl_eng', "delete from eng_days where site = 'S1' and email = 'eng1@rcl.test' and day = '" + TM + "'; delete from eng_masters where site = 'S1' and kind = 'work' and data->>'name' = 'Kerb';");
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  // a person signs in on the Portal's page and opens Engineering of S1 from its card
  async function open(email, pw, view) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200)));
    await p.setViewport(view || { width: 1440, height: 900 });
    await p.goto(E + '/', { waitUntil: 'load' });
    await until(() => p.url().startsWith(P) && p.evaluate(() => !document.getElementById('v_login').hidden));
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', email); await p.type('#l_pass', pw); await p.click('#l_btn');
    // (the Portal may open the module he used last by itself – then he is in Engineering already)
    const where = await until(() => p.url().startsWith(E) ? 'eng' : p.evaluate(() => !document.getElementById('v_home').hidden ? 'home' : !document.getElementById('v_sa').hidden ? 'sa' : ''), 30000);
    // a person: the card of Engineering on S1; the Super Admin lands in his console – he opens Engineering by its address
    if (where === 'home') await p.evaluate(() => { const a = [...document.querySelectorAll('#h_sites a.mod')].find(x => /module=engineering&site=S1/.test(x.getAttribute('href'))); if (a) a.click(); });
    else if (where === 'sa') await p.goto(E + '/#site=S1', { waitUntil: 'load' });
    const inE = await until(() => p.url().startsWith(E) && p.evaluate(() => !document.getElementById('v_app').hidden && !!document.querySelector('#eng_pages .navbtn')), 30000);
    return { p, ctx, inE: !!inE };
  }
  const shot = (p, n, full) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: full !== false });
  const page = async (p, k) => { await p.evaluate(k => document.querySelector('#eng_pages [data-page="' + k + '"]').click(), k); await until(() => p.evaluate(k => document.body.dataset.loaded === k, k), 20000); };
  const idle = p => until(() => p.evaluate(() => !document.querySelector('main .empty') || document.querySelector('main .empty').textContent !== '…'), 20000);
  try {
    // ================= a User: eng1 =================
    let U = await open('eng1@rcl.test', VPW);
    let p = U.p;
    ok('eng1 opens Engineering from the Portal\'s card (nothing typed here)', U.inE, p.url());
    let st = await p.evaluate(() => ({ pages: [...document.querySelectorAll('#eng_pages .navbtn')].map(x => x.textContent.trim()), title: document.getElementById('pg_title').textContent, role: document.getElementById('u_role').textContent }));
    ok('   a User: his menu has My work and the Strip chart only; it opens on My work', st.pages.join() === 'My work,Strip chart' && st.title === 'My work' && /Engineering User/.test(st.role), st);
    await until(() => p.evaluate(() => !!document.getElementById('mw_plan')));
    st = await p.evaluate(() => ({ plan: document.querySelectorAll('#mw_plan .pline').length, sent: (document.querySelector('#mw_rep .sent') || {}).textContent || '', reads: document.querySelectorAll('#mw_rep .readline').length }));
    ok('   today\'s plan (3 lines) can be changed; yesterday\'s report is shown as sent (✎ changed 2 times)', st.plan === 3 && /Sent/.test(st.sent) && /changed 2 times/.test(st.sent) && st.reads >= 3, st);
    await shot(p, 'eng-mywork-user');
    // his plan for tomorrow, made in the page
    await p.evaluate(() => document.querySelector('#mw_dates button[data-n="1"]').click());
    await until(() => p.evaluate(() => !!document.getElementById('pl_add')));
    await p.click('#pl_add'); await wait(200);
    await p.evaluate(() => { const l = document.querySelector('#pl_lines .pline'); const set = (c, v) => { const e = l.querySelector(c); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); };
      set('.l-work', 'W-001'); set('.l-layer', 'L2'); set('.l-side', 'LHS'); set('.l-from', '52+000'); set('.l-to', '52+300'); });
    st = await p.evaluate(() => document.querySelector('#pl_lines .l-len').textContent);
    ok('   tomorrow: a line of Embankment Top LHS 52+000 → 52+300 – its length shown as it is typed (300 m)', st === '300 m', st);
    await p.click('#pl_save'); await wait(1500);
    ok('   "Save plan": the plan of tomorrow is saved', sql('rcl_eng', "select plan->0->>'from' || '-' || (plan->0->>'to') || ' ' || (plan->0->>'layer') || ' ' || (plan->0->>'qty') from eng_days where email = 'eng1@rcl.test' and day = '" + TM + "'") === '52000-52300 L2 300');
    st = await p.evaluate(() => ({ users: document.querySelectorAll('#mw_who_w:not([hidden])').length, disabled: document.querySelector('#mw_dates button[data-n="1"]').disabled }));
    ok('   a User has no person picker', st.users === 0, st);
    // the strip chart (a User may see it)
    await page(p, 'strip'); await until(() => p.evaluate(() => document.querySelectorAll('#sc_chart svg').length > 0), 20000);
    st = await p.evaluate(() => ({ svgs: document.querySelectorAll('#sc_chart svg').length, legend: document.getElementById('sc_legend').textContent, layers: document.querySelectorAll('#sc_layers .lrow').length }));
    ok('   the strip chart: the road in pieces of 4 km, the index of the layers (as set yesterday), progress by layer', st.svgs === 14 && /Embankment · Layer 1/.test(st.legend) && st.layers === 5, st);
    await shot(p, 'eng-strip-user');
    await U.ctx.close();

    // ================= a User whose report is due: eng2 =================
    U = await open('eng2@rcl.test', VPW); p = U.p;
    await until(() => p.evaluate(() => !!document.getElementById('mw_rep')));
    st = await p.evaluate(() => ({ bar: !document.getElementById('remind').hidden, t: document.getElementById('remind_t').textContent }));
    ok('eng2 (report of yesterday not in): ' + (HOUR >= 9 && HOUR <= 20 ? 'the "Submit report" bar is on the page' : 'outside 9–20 h the bar is not shown'), HOUR >= 9 && HOUR <= 20 ? st.bar && /is not in yet/.test(st.t) : !st.bar, st);
    await p.click('#mw_dates button[data-d="' + TODAY + '"]').catch(() => {});
    await until(() => p.evaluate(() => document.querySelectorAll('#mw_rep .line[data-plan]').length === 2));
    await p.evaluate(() => { const L = document.querySelectorAll('#mw_rep .line[data-plan]'); L[0].querySelector('input[value="all"]').click(); L[1].querySelector('input[value="none"]').click(); });
    st = await p.evaluate(() => ({ why0: document.querySelectorAll('#mw_rep .line[data-plan]')[0].querySelector('.r-why').hidden, why1: document.querySelectorAll('#mw_rep .line[data-plan]')[1].querySelector('.r-why').hidden, left: document.querySelectorAll('#mw_rep .line[data-plan]')[1].querySelector('.r-left').textContent, list: document.querySelectorAll('#dl_reasons option').length }));
    ok('   "Done as planned" asks no reason; "Not done" asks why – the reasons others typed are suggested', st.why0 && !st.why1 && /Nothing done/.test(st.left) && st.list >= 2, st);
    await p.click('#rp_send'); await wait(1000);
    st = await p.evaluate(() => document.getElementById('toast').textContent);
    ok('   sent without the reason: refused, the message says which line', /say why/.test(st) && sql('rcl_eng', "select count(*) from eng_days where email = 'eng2@rcl.test' and report is not null") === '0', st);
    await p.evaluate(() => { const i = document.querySelectorAll('#mw_rep .line[data-plan]')[1].querySelector('.r-reason'); i.value = 'Machine shifted'; });
    await p.click('#rp_send'); await wait(1500);
    ok('   with the reason: the report is sent', sql('rcl_eng', "select report->'lines'->0->>'qty' || '/' || (report->'lines'->1->>'qty') || ' ' || (report->'lines'->1->>'reason') from eng_days where email = 'eng2@rcl.test' and day = '" + Y + "'") === '340/0 Machine shifted');
    st = await p.evaluate(() => ({ bar: !document.getElementById('remind').hidden, sent: (document.querySelector('#mw_rep .sent') || {}).textContent || '' }));
    ok('   the "Submit report" bar goes; the report shows as sent', !st.bar && /Sent/.test(st.sent), st);
    ok('   the reason "Machine shifted" counted again in the suggestions', sql('rcl_eng', "select uses from eng_reasons where key = 'machine shifted'") === '2');
    await shot(p, 'eng-report-sent');
    await U.ctx.close();

    // ================= the Admin: sujit =================
    U = await open('sujit@rcl.test', PW); p = U.p;
    st = await p.evaluate(() => ({ pages: [...document.querySelectorAll('#eng_pages .navbtn')].map(x => x.textContent.trim()), title: document.getElementById('pg_title').textContent }));
    ok('the Admin: the views in his menu, no set-up', st.pages.join() === 'My work,Dashboard,Strip chart,All reports,Reports,Performance', st);
    if (st.title !== 'Dashboard') await page(p, 'dashboard');      // (the Portal may open the page he had last)
    await until(() => p.evaluate(() => document.querySelectorAll('#db_cards .wcard').length > 0), 20000);
    st = await p.evaluate(() => ({ date: document.getElementById('db_date').textContent, chips: [...document.querySelectorAll('#db_chips .wchip')].map(x => x.innerText.replace(/\s+/g, ' ')), tiles: [...document.querySelectorAll('#db_tiles .tile')].map(x => x.innerText.replace(/\s+/g, ' ')), cards: [...document.querySelectorAll('#db_cards .wcard')].map(x => x.querySelector('h3').textContent + ':' + x.querySelector('.st').textContent), attn: (document.getElementById('db_attn_b') || {}).textContent || '' }));
    ok('   the dashboard of today (yesterday\'s work): a chip per work with its sender and time', st.chips.length === 3 && st.chips.some(c => /Embankment Engineer One · \d\d:\d\d/.test(c)) && st.chips.some(c => /GSB Engineer Two/.test(c)), st.chips);
    ok('   the tiles: planned, achieved against plan, works complete, outside the plan', /Planned on .* 2,360 ?m 2\/2 reports in/.test(st.tiles[0]) && /Achieved against plan 1,590 ?m 67% of plan/.test(st.tiles[1]) && /Works 1\/ ?3 complete/.test(st.tiles[2]) && /Work outside the plan 100 ?m/.test(st.tiles[3]), st.tiles);
    ok('   a card per work: Embankment "More than planned", Subgrade "Partly done", GSB "Partly done"', st.cards.join() === 'Embankment:More than planned,Subgrade:Partly done,GSB:Partly done', st.cards);
    await shot(p, 'eng-dashboard');
    await p.evaluate(() => document.querySelector('#db_cards [data-view]').click()); await until(() => p.evaluate(() => !document.getElementById('dlg').hidden));
    st = await p.evaluate(() => document.getElementById('dlg_b').innerText);
    ok('   "View report": the report as text (to send on WhatsApp)', /Report – work of/.test(st) && /planned 700 m, done 50\+310 → 51\+110 800 m/.test(st), st);
    await p.evaluate(() => document.querySelector('#dlg_btns button').click());
    await page(p, 'allreports'); await until(() => p.evaluate(() => document.querySelectorAll('#ar_rows .rcell').length > 0), 20000);
    st = await p.evaluate(() => ({ head: [...document.querySelectorAll('#ar_head th')].map(x => x.textContent), cells: document.querySelectorAll('#ar_rows .rcell').length, edit: [...document.querySelectorAll('#ar_rows .rcell')].some(x => /✎/.test(x.textContent)) }));
    ok('All reports: a column per work, a card per report (time, %, sender, ✎)', st.head.join() === 'Report date,Embankment,Subgrade,GSB,Culvert,Reports' && st.cells >= 4 && st.edit, st);
    await shot(p, 'eng-allreports');
    await page(p, 'reports'); await until(() => p.evaluate(() => document.querySelectorAll('#rp_rows tr').length > 0 && !/…/.test(document.getElementById('rp_rows').textContent)), 20000);
    await p.evaluate(() => document.querySelector('#rp_kind [data-k="week"]').click()); await wait(1500);
    st = await p.evaluate(() => ({ title: document.getElementById('rp_title').textContent, rows: [...document.querySelectorAll('#rp_rows tr')].map(x => x.children[0].textContent), reasons: document.getElementById('rp_reasons').innerText }));
    ok('Reports: weekly – work by work, the reasons for the work left', st.title === 'Weekly report' && st.rows.length === 3 && /Subgrade top work in progress/.test(st.reasons) && /Machine shifted/.test(st.reasons), st);
    await shot(p, 'eng-reports-week');
    await page(p, 'perf'); await until(() => p.evaluate(() => document.querySelectorAll('#pf_cards .pcard').length > 0), 20000);
    st = await p.evaluate(() => [...document.querySelectorAll('#pf_cards .pcard')].map(x => x.innerText.replace(/\s+/g, ' ')));
    ok('Performance: a card per person – reports sent, corrections, late, plan against done, his works', st.some(c => /Engineer One .*correction/.test(c) && /of his plan done/.test(c)) && st.some(c => /Engineer Two/.test(c)), st);
    await shot(p, 'eng-performance');
    // the Admin looks at eng1's day (not changed by him)
    await page(p, 'mywork'); await until(() => p.evaluate(() => !document.getElementById('mw_who_w').hidden));
    await p.select('#mw_who', 'eng1@rcl.test'); await until(() => p.evaluate(() => /Engineer One/.test(document.querySelector('#mw_rep h2').textContent)));
    st = await p.evaluate(() => ({ change: !!document.getElementById('rp_change'), plines: document.querySelectorAll('#mw_plan .pline').length }));
    ok('   the Admin opens eng1\'s day: he sees it but cannot change it', !st.change && st.plines === 0, st);
    await U.ctx.close();

    // ================= the Super Admin =================
    U = await open('sa@rcl.test', SAPW); p = U.p;
    await page(p, 'setup'); await until(() => p.evaluate(() => /Package 18B/.test(document.getElementById('rd_now').textContent)));
    st = await p.evaluate(() => document.getElementById('rd_now').innerText);
    ok('Set-up → Road: the road from the KML – 8+000 to 61+055', /8\+000 to 61\+055/.test(st) && /53\.055 km/.test(st), st);
    await shot(p, 'eng-setup-road');
    await p.evaluate(() => document.querySelector('#su_tabs [data-t="work"]').click()); await until(() => p.evaluate(() => !document.getElementById('su_master').hidden && document.querySelectorAll('#ms_rows tr[data-id]').length >= 5));
    st = await p.evaluate(() => [...document.querySelectorAll('#ms_rows tr')].map(x => x.innerText.replace(/\s+/g, ' ')));
    ok('   Works & layers: each work with its layers, its periods (GSB: two periods, the new one "now")', st.length === 5 && st.some(r => /GSB m Layer 1 100 mm, Layer 2 100 mm/.test(r) && /now/.test(r)), st);
    await p.click('#ms_new'); await wait(300);
    await p.evaluate(() => { document.getElementById('mf_name').value = 'Kerb'; document.querySelector('#mf_sides input[value="Median"]').checked = true; document.getElementById('mf_sort').value = '60';
      const r = document.querySelector('#mf_rows .r'); r.querySelector('.rw-label').value = 'Kerb'; r.querySelector('.rw-mm').value = '300'; });
    await p.click('#mf_save'); await wait(1500);
    ok('   a new work added from the form (Kerb, on the Median, 300 mm)', sql('rcl_eng', "select item || ' ' || (data->'sides'->>0) || ' ' || (data->'layers'->0->>'mm') from eng_masters where data->>'name' = 'Kerb'") === 'W-005 Median 300');
    await shot(p, 'eng-setup-works');
    await p.evaluate(() => document.querySelector('#su_tabs [data-t="mix"]').click()); await wait(300);
    await p.evaluate(() => document.querySelector('#ms_rows .m-edit').click()); await wait(300);
    st = await p.evaluate(() => ({ name: document.getElementById('mf_name').value, rows: document.querySelectorAll('#mf_rows .r').length }));
    ok('   Mix design: its form filled (PQC M40, 2 lines)', st.name === 'PQC M40' && st.rows === 2, st);
    await shot(p, 'eng-setup-mix');
    await p.evaluate(() => document.querySelector('#su_tabs [data-t="side"]').click()); await wait(300);
    st = await p.evaluate(() => document.querySelectorAll('#ms_rows tr[data-id]').length);
    ok('   Sides & widths: LHS, Median, RHS', st === 3, st);
    await p.evaluate(() => document.querySelector('#su_tabs [data-t="people"]').click()); await wait(300);
    st = await p.evaluate(() => [...document.querySelectorAll('#pp_rows tr')].map(x => x.innerText.replace(/\s+/g, ' ')));
    ok('   People & works: each person with the works given to him', st.some(r => /Engineer One .*Embankment.*Subgrade.*Culvert/.test(r)) && st.some(r => /New Engineer .*not yet signed in/.test(r)), st);
    await p.evaluate(() => [...document.querySelectorAll('#pp_rows tr')].find(x => /Engineer Two/.test(x.textContent)).querySelector('.p-works').click()); await wait(300);
    await p.evaluate(() => { document.querySelector('#aw_list input[value="W-005"]').checked = true; }); await shot(p, 'eng-setup-assign', false);
    await p.evaluate(() => [...document.querySelectorAll('#dlg_btns button')].find(x => x.textContent === 'Save').click()); await wait(1500);
    ok('   "Give works": Engineer Two now has GSB and Kerb', sql('rcl_eng', "select string_agg(work, ',' order by work) from eng_assign where email = 'eng2@rcl.test' and active") === 'W-003,W-005');
    await U.ctx.close();

    // ================= a phone =================
    const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    U = await open('eng1@rcl.test', VPW, phone); p = U.p;
    await until(() => p.evaluate(() => !!document.getElementById('mw_plan')));
    st = await p.evaluate(() => ({ menu: getComputedStyle(document.getElementById('menu_btn')).display !== 'none', over: document.documentElement.scrollWidth - window.innerWidth }));
    ok('a phone: the menu button, nothing wider than the screen', st.menu && st.over <= 1, st);
    await shot(p, 'eng-phone-mywork');
    await U.ctx.close();
    U = await open('sujit@rcl.test', PW, phone); p = U.p;
    await until(() => p.evaluate(() => document.querySelectorAll('#db_cards .wcard').length > 0), 20000);
    st = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('   the dashboard on a phone: nothing wider than the screen', st <= 1, st);
    await shot(p, 'eng-phone-dashboard');
    await page(p, 'strip'); await until(() => p.evaluate(() => document.querySelectorAll('#sc_chart svg').length > 0), 20000);
    st = await p.evaluate(() => document.querySelectorAll('#sc_chart svg').length);
    ok('   the strip chart on a phone: pieces of 2 km', st === 27, st);
    await shot(p, 'eng-phone-strip');
    await U.ctx.close();
  } catch (e) { ok('the test ran to its end', false, String((e && e.stack) || e)); }
  ok('no script error on any page', errs.length === 0, errs);
  await b.close();
  console.log(out.join('\n'));
  console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
