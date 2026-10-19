/* Engineering INSIDE Mechanical's screen (one address), on the rig in gateway mode – what the live rewrite of Mechanical's
 * vercel.json does (/engineering/… → this project):
 *   GATEWAY=1 PORTAL=1 bash /home/claude/rig/all.sh     then (after test/api.test.js)
 *   timeout 300 node test/inmech.test.js
 * Checks: Engineering's card on the Portal opens Mechanical's screen with Engineering in the middle; Mechanical's dark menu
 * lists Engineering's pages for this person (from /engineering/menu.json); a page opens in place; a save inside; Ctrl K finds
 * an Engineering work. The Portal's module addresses are put back at the end. */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const G = 'http://127.0.0.1:3030';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const out = []; let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const IST = 330 * 60000, TODAY = new Date(Date.now() + IST).toISOString().slice(0, 10), TM = new Date(Date.now() + IST + 86400000).toISOString().slice(0, 10);
(async () => {
  const before = sql('rcl_portal', "select key || '|' || url from modules where key in ('mechanical', 'engineering') order by key");
  sql('rcl_portal', "update modules set url = '" + G + "' where key = 'mechanical'; update modules set url = '" + G + "/engineering' where key = 'engineering'; delete from counters; update users set start_item = null where email = 'sujit@rcl.test';");
  sql('rcl', "delete from web.cache where key like 'F\\_%' or key like 'LG\\_%';");
  sql('rcl_eng', "delete from eng_sessions; delete from eng_days where email = 'sujit@rcl.test';");
  sql('rcl_eng', "insert into eng_assign (site, email, work, active, created_by) values ('S1', 'sujit@rcl.test', 'W-001', true, 'test') on conflict (site, email, work) do update set active = true;");
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  const app = p => p.frames().find(x => x !== p.mainFrame() && !/\/engineering\//.test(x.url()) && x.parentFrame() === p.mainFrame());
  const eng = p => p.frames().find(x => /\/engineering\/\?embed=1/.test(x.url()));
  try {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    await ctx.overridePermissions(G, ['geolocation']); await p.setGeolocation({ latitude: 19.997453, longitude: 73.789802, accuracy: 20 });      // (Mechanical opens only with the location on)
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(G + '/portal/', { waitUntil: 'load' });
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', 'sujit@rcl.test'); await p.type('#l_pass', 'Nashik#Road848!'); await p.click('#l_btn');
    await until(() => p.evaluate(() => !document.getElementById('v_home').hidden && document.querySelectorAll('#h_sites a.mod').length));
    await p.evaluate(() => [...document.querySelectorAll('#h_sites a.mod')].find(a => /module=engineering&site=S1/.test(a.getAttribute('href'))).click());
    const v1 = await until(async () => { const f = eng(p); if (!f || !app(p)) return null; const s = await f.evaluate(() => document.body.dataset.loaded); return s && { page: s, url: p.url(), crumb: await app(p).evaluate(() => document.getElementById('crumb_mod').textContent) }; }, 60000);
    ok('Engineering\'s card on the Portal: Mechanical\'s screen opens with Engineering\'s Dashboard in the middle (the main address)', !!v1 && v1.page === 'dashboard' && v1.crumb === 'Engineering' && v1.url.startsWith(G + '/') && !/\/engineering\//.test(v1.url), v1);
    const inside = await eng(p).evaluate(() => ({ side: getComputedStyle(document.getElementById('side')).display, top: getComputedStyle(document.querySelector('.topbar')).display, cards: document.querySelectorAll('#db_cards .wcard').length }));
    ok('   inside: no menu or top bar of its own; the dashboard\'s work cards are there', inside.side === 'none' && inside.top === 'none' && inside.cards >= 1, inside);
    await wait(800); await p.screenshot({ path: path.join(SHOTS, 'inmech-dashboard.png') });
    await eng(p).evaluate(() => { window.__still = 1; });
    await app(p).evaluate(() => { const g = document.querySelector('#grp_mods .modgrp[data-mod="engineering"]'); if (g && !g.classList.contains('open')) g.querySelector('.grphead').click(); });
    const menu = await until(() => app(p).evaluate(() => { const L = [...document.querySelectorAll('#grp_mods .modgrp[data-mod="engineering"] .navbtn[data-page]')].map(x => x.textContent.trim()); return L.length ? L : null; }), 15000);
    ok('Mechanical\'s dark menu: Engineering with the pages of this person (Admin – no set-up)', (menu || []).join() === 'My work,Dashboard,Strip chart,All reports,Reports,Performance', menu);
    await app(p).evaluate(() => [...document.querySelectorAll('#grp_mods .modgrp[data-mod="engineering"] .navbtn[data-page]')].find(x => /Strip chart/.test(x.textContent)).click());
    const v2 = await until(async () => await eng(p).evaluate(() => document.body.dataset.loaded === 'strip' && window.__still === 1 && document.querySelectorAll('#sc_chart svg').length) && await app(p).evaluate(() => document.getElementById('page_title').textContent), 20000);
    ok('   Strip chart from Mechanical\'s menu: in place (Engineering\'s page is not loaded again)', v2 === 'Strip chart', v2);
    await p.screenshot({ path: path.join(SHOTS, 'inmech-strip.png') });
    // a save inside: his plan for tomorrow
    await app(p).evaluate(() => [...document.querySelectorAll('#grp_mods .modgrp[data-mod="engineering"] .navbtn[data-page]')].find(x => /My work/.test(x.textContent)).click());
    await until(() => eng(p).evaluate(() => document.body.dataset.loaded === 'mywork'), 20000);
    const f = eng(p);
    await f.evaluate(() => document.querySelector('#mw_dates button[data-n="1"]').click());
    await until(() => f.evaluate(() => !!document.getElementById('pl_add') && document.body.dataset.loaded === 'mywork'), 20000);
    await f.evaluate(() => document.getElementById('pl_add').click());
    await f.evaluate(() => { const l = document.querySelector('#pl_lines .pline'); const set = (c, v) => { const e = l.querySelector(c); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; set('.l-work', 'W-001'); set('.l-layer', 'L1'); set('.l-side', 'RHS'); set('.l-from', '30+000'); set('.l-to', '30+250'); });
    await f.evaluate(() => document.getElementById('pl_save').click());
    const saved = await until(() => sql('rcl_eng', "select plan->0->>'qty' from eng_days where email = 'sujit@rcl.test' and day = '" + TM + "'") === '250', 15000);
    ok('a plan saved in Engineering inside Mechanical\'s screen (the one address – the change passes the origin check)', !!saved);
    // Ctrl K in Mechanical finds Engineering's work
    await app(p).evaluate(() => { gsOpen(); const i = document.getElementById('gs_in'); i.value = 'Embankment'; i.dispatchEvent(new Event('input')); });
    const hit = await until(() => app(p).evaluate(() => { const t = document.getElementById('gs_list').innerText; return /Engineering – Works/i.test(t) && /Embankment/.test(t) ? t.slice(0, 300) : null; }), 20000);
    ok('Ctrl K (Mechanical\'s search) finds Engineering\'s work "Embankment"', !!hit, hit || await app(p).evaluate(() => document.getElementById('gs_list').innerText.slice(0, 600)));
    await p.screenshot({ path: path.join(SHOTS, 'inmech-search.png') });
  } catch (e) { ok('the run finished', false, e.stack || String(e)); }
  finally { await b.close(); }
  ok('no script error on any page', errs.length === 0, errs);
  before.split('\n').filter(Boolean).forEach(l => { const [k, u] = l.split('|'); sql('rcl_portal', "update modules set url = '" + u + "' where key = '" + k + "';"); });
  sql('rcl_eng', "delete from eng_assign where email = 'sujit@rcl.test'; delete from eng_days where email = 'sujit@rcl.test';");
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
