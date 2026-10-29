/* (29-10-2026) LIVE on the local rig (never live) – run after test/api.test.js (its people and works): the Admin's Dashboard in a
 * browser asks "what changed?" every 2 s and reads the Dashboard again when another person's save is noted at the site (a row of the
 * site's activity – what every save writes); My work asks nothing; a hidden tab nothing, at once when seen again.   node test/live.test.js */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', E = 'http://127.0.0.1:3040';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const PW = 'Nashik#Road848!';

(async () => {
  sql('rcl_portal', "delete from counters; update users set start_item = null where email in ('sujit@rcl.test');");
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
  try {
    const A = await open('sujit@rcl.test', PW);
    ok('sujit (Engineering Admin at S1) is in Engineering', A.inE);
    const p = A.p; const asked = { live: 0, dash: 0 };
    p.on('request', q => { if (q.method() === 'POST' && /\/api\/eng$/.test(q.url())) { const a = (/"action":"([a-zA-Z]+)"/.exec(q.postData() || '') || [])[1]; if (a === 'live') asked.live++; if (a === 'dash') asked.dash++; } });
    await p.evaluate(() => document.querySelector('#eng_pages [data-page="dashboard"]').click());
    await until(() => p.evaluate(() => document.body.dataset.loaded === 'dashboard'), 20000); await wait(800);
    asked.live = 0; await wait(6200);
    ok('the Dashboard in use: "what changed?" every 2 s (about 3 in 6 s)', asked.live >= 2 && asked.live <= 4, asked);
    const d0 = asked.dash;
    sql('rcl_eng', "insert into eng_activity (site, email, action, target, detail) values ('S1', 'eng1@rcl.test', 'Report sent', 'rig live test', '{}')");      // (another person's save – what each save notes)
    ok('another person\'s save noted at S1: the Dashboard read again by itself within 4 s', !!(await until(() => asked.dash > d0, 4500)), asked);
    const d1 = asked.dash; sql('rcl_eng', "insert into eng_activity (site, email, action, target, detail) values ('T2', 'x@rcl.test', 'Report sent', 'rig live test', '{}')"); await wait(4500);
    ok('   a save at ANOTHER site: not read again (each site its own)', asked.dash === d1, asked);
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    asked.live = 0; await wait(5000); const nh = asked.live;
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(700);
    ok('a hidden tab: nothing asked in 5 s; seen again: asked at once', nh === 0 && asked.live >= 1, [nh, asked.live]);
    await p.evaluate(() => document.querySelector('#eng_pages [data-page="mywork"]').click()); await wait(1500);
    asked.live = 0; await wait(5000);
    ok('My work (a plan or a report being typed): nothing asked, never redrawn by it', asked.live === 0, asked);
    ok('no fault on the page', errs.length === 0, errs);
  } finally { sql('rcl_eng', "delete from eng_activity where target = 'rig live test'"); await b.close(); }
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n') + '\nFAIL the test stopped: ' + (e && e.stack || e)); process.exit(1); });
