/* Unit tests – no database needed:   timeout 300 node --test test/unit.test.js
 * The rules (lib/rules.js), the KML reader (public/kml.js), the page's script, the menu, the settings files, no secret.
 * With the 18B KML on this computer (ENG_KML=<its path>) the real drawing is read too. */
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const R = require('../lib/rules'), K = require('../public/kml.js');
const ROOT = path.join(__dirname, '..');
const W = (item, data, from, to, active) => ({ kind: 'work', item: item, data: R.cleanData('work', data), valid_from: from || '2026-01-01', valid_to: to || null, active: active !== false });
const road = { ch_from: 8000, ch_to: 61055 };

test('chainage: km+m both ways', () => {
  assert.strictEqual(R.chain('8+020'), 8020); assert.strictEqual(R.chain(' 50 + 310 '), 50310); assert.strictEqual(R.chain('61.055km'), 61055);
  assert.strictEqual(R.chain('8020'), 8020); assert.strictEqual(R.chain(''), null); assert.ok(isNaN(R.chain('8-020')));
  assert.strictEqual(R.showCh(8020), '8+020'); assert.strictEqual(R.showCh(61055.5), '61+055.5'); assert.strictEqual(R.showCh(0), '0+000');
});
test('dates in India; late = after 9 in the morning of the next day', () => {
  assert.strictEqual(R.today(Date.parse('2026-10-18T19:00:00Z')), '2026-10-19');      // 00:30 in India
  assert.strictEqual(R.addDays('2026-10-01', -1), '2026-09-30');
  assert.strictEqual(R.lateOf('2026-10-17', '2026-10-18T03:20:00Z'), false);      // 08:50
  assert.strictEqual(R.lateOf('2026-10-17', '2026-10-18T03:40:00Z'), true);       // 09:10
  assert.throws(() => R.day('2026-13-01'), /proper date/);
});
test('a work: name, unit, layers with their own keys that never change', () => {
  const w = R.cleanData('work', { name: ' Embankment ', unit: 'x', layers: [{ name: 'Layer 1', mm: '200' }, { name: 'Top', mm: '' }], sides: ['LHS', 'RHS', 'LHS'] });
  assert.strictEqual(w.name, 'Embankment'); assert.strictEqual(w.unit, 'm'); assert.deepStrictEqual(w.sides, ['LHS', 'RHS']);
  assert.deepStrictEqual(w.layers.map(l => l.key + ':' + l.name + ':' + l.mm), ['L1:Layer 1:200', 'L2:Top:null']);
  // a new period: the old layers keep their keys; a new one gets the next key after every key used before (keyFloor)
  const w2 = R.cleanData('work', { name: 'Embankment', layers: [{ key: 'L2', name: 'Top' }, { name: 'Layer 2' }] }, null, 3);
  assert.deepStrictEqual(w2.layers.map(l => l.key), ['L2', 'L4']);
  assert.throws(() => R.cleanData('work', { name: 'E', layers: [] }), /name/);
  assert.throws(() => R.cleanData('work', { name: 'Embankment', layers: [{ name: 'Top' }, { name: 'top' }] }), /twice/);
  assert.throws(() => R.cleanData('work', { name: 'Embankment', layers: [{ name: 'Top', mm: '-5' }] }), /thickness/);
});
test('a side stretch: inside the road, to after from, a width', () => {
  const s = R.cleanData('side', { name: 'LHS', from: '8+000', to: 61055, width: '7.5' }, road);
  assert.deepStrictEqual([s.from, s.to, s.width], [8000, 61055, 7.5]);
  assert.throws(() => R.cleanData('side', { name: 'LHS', from: 7000, to: 9000, width: 7 }, road), /road runs from 8\+000/);
  assert.throws(() => R.cleanData('side', { name: 'LHS', from: 9000, to: 9000, width: 7 }, road), /after/);
  assert.throws(() => R.cleanData('side', { name: 'LHS', from: 9000, to: 9100, width: 0 }, road), /width/);
});
test('periods: the version of a day; inactive ones only when asked', () => {
  const rows = [W('W-001', { name: 'GSB', layers: [{ name: 'L1' }] }, '2026-01-01', '2026-06-30'), W('W-001', { name: 'GSB', layers: [{ name: 'Layer 1' }, { name: 'Layer 2' }] }, '2026-07-01'), W('W-002', { name: 'DLC' }, '2026-01-01', null, false)];
  assert.strictEqual(R.versionOn(rows, 'work', 'W-001', '2026-06-30').data.layers.length, 1);
  assert.strictEqual(R.versionOn(rows, 'work', 'W-001', '2026-07-01').data.layers.length, 2);
  assert.deepStrictEqual(Object.keys(R.itemsOn(rows, 'work', '2026-08-01')), ['W-001']);
  assert.deepStrictEqual(Object.keys(R.itemsOn(rows, 'work', '2026-08-01', true)).sort(), ['W-001', 'W-002']);
  assert.strictEqual(R.nextItem(rows, 'work'), 'W-003'); assert.strictEqual(R.nextItem(rows, 'side'), 'S-001');
});
const works = { 'W-001': W('W-001', { name: 'Embankment', sort: 20, layers: [{ name: 'Layer 1' }, { name: 'Top' }] }), 'W-002': W('W-002', { name: 'Culvert', unit: 'Nos', strip: false }), 'W-003': W('W-003', { name: 'Median kerb', sides: ['Median'], sort: 50 }), 'W-004': W('W-004', { name: 'GSB', sort: 40 }) };
const ctx = (mine) => ({ day: '2026-10-17', road: road, works: works, worksAll: works, sideNames: ['LHS', 'Median', 'RHS'], mayWork: w => (mine || ['W-001', 'W-002', 'W-003', 'W-004']).indexOf(w) > -1, keep: [] });
test('a plan: checked line by line', () => {
  const p = R.cleanPlan([{ work: 'W-001', layer: 'L1', side: 'RHS', from: '50+310', to: '51+010' }, { work: 'W-002', qty: '2' }, { work: 'W-001', layer: 'L2', side: 'Both', from: '55+270', to: '55+370' }], ctx());
  assert.deepStrictEqual(p.map(x => x.id + ':' + x.qty), ['p1:700', 'p2:2', 'p3:100']);
  assert.strictEqual(p[1].side, '');
  const bad = (l, re, mine) => assert.throws(() => R.cleanPlan([l], ctx(mine)), re);
  bad({ work: 'W-009' }, /pick the work/);
  bad({ work: 'W-004', side: 'LHS', from: 9000, to: 9100 }, /not given to you/, ['W-001']);
  bad({ work: 'W-001', layer: 'L9', side: 'LHS', from: 9000, to: 9100 }, /pick the layer/);
  bad({ work: 'W-001', layer: 'L1', side: 'LHS', from: 9100, to: 9000 }, /must be after/);
  bad({ work: 'W-001', layer: 'L1', side: 'LHS', from: 7000, to: 9000 }, /road runs/);
  bad({ work: 'W-001', layer: 'L1', side: 'LHS' }, /metres – give the chainage/);
  bad({ work: 'W-001', layer: 'L1', from: 9000, to: 9100 }, /pick the side/);
  bad({ work: 'W-003', side: 'LHS', from: 9000, to: 9100 }, /done on Median – not on LHS/);
  bad({ work: 'W-002', qty: '' }, /quantity/);
  bad({ work: 'W-001', layer: 'L1', side: 'LHS', from: '9+000' }, /both chainages/);
});
test('a report: every plan line once; work left needs a reason; work outside the plan', () => {
  const plan = R.cleanPlan([{ work: 'W-001', layer: 'L1', side: 'RHS', from: 50310, to: 51010 }, { work: 'W-002', qty: 2 }], ctx());
  assert.throws(() => R.cleanReport({ lines: [{ plan: 'p1', from: 50310, to: 50577 }, { plan: 'p2', qty: 2 }] }, plan, ctx()), /not all of it was done – say why/);
  assert.throws(() => R.cleanReport({ lines: [{ plan: 'p1', from: 50310, to: 51010 }] }, plan, ctx()), /Plan line 2 \(Culvert\): nothing was done – say why/);
  const rep = R.cleanReport({ lines: [{ plan: 'p1', from: 50310, to: 50577, reason: 'Machine shifted to Emb. top' }, { plan: 'p2', none: true, reason: 'No pipes' }],
    extra: [{ work: 'W-001', layer: 'L1', side: 'LHS', from: '50+310', to: '50+610' }], note: 'ok' }, plan, ctx());
  assert.deepStrictEqual(rep.lines.map(l => l.qty + '/' + l.left), ['267/433', '0/2']);
  assert.strictEqual(rep.extra[0].qty, 300);
  assert.deepStrictEqual(R.reasonsOf(rep), ['Machine shifted to Emb. top', 'No pipes']);
  assert.strictEqual(R.reasonKey('  Machine   shifted, to EMB. top!'), 'machine shifted to emb top');
  // more than planned: nothing left, no reason needed
  const more = R.cleanReport({ lines: [{ plan: 'p1', from: 50310, to: 51110 }, { plan: 'p2', qty: 3 }] }, plan, ctx());
  assert.deepStrictEqual(more.lines.map(l => l.qty + '/' + l.left), ['800/0', '3/0']);
  const f = R.dayFigures({ email: 'a', name: 'A', day: '2026-10-17', plan: plan, report: rep });
  assert.deepStrictEqual(f.map(x => x.work + ':' + x.planned + ':' + x.done + ':' + x.outside), ['W-001:700:267:false', 'W-002:2:0:false', 'W-001:0:300:true']);
  assert.strictEqual(R.statusOf(700, 267, true), 'Partly done'); assert.strictEqual(R.statusOf(700, 800, true), 'More than planned');
  assert.strictEqual(R.statusOf(700, 700, true), 'As planned'); assert.strictEqual(R.statusOf(700, 0, true), 'Not done'); assert.strictEqual(R.statusOf(700, 0, false), 'No report');
});
test('the strip chart: the highest layer at each place; "Both" on LHS and RHS; clipped to the side\'s stretch', () => {
  const doc = (day, lines) => { const plan = R.cleanPlan(lines, ctx()); return { day: day, email: 'a', plan: plan, report: R.cleanReport({ lines: plan.map(p => ({ plan: p.id, from: p.from, to: p.to, qty: p.qty })) }, plan, ctx()) }; };
  const docs = [doc('2026-10-01', [{ work: 'W-001', layer: 'L1', side: 'Both', from: 10000, to: 11000 }]), doc('2026-10-02', [{ work: 'W-001', layer: 'L2', side: 'RHS', from: 10500, to: 11500 }]),
    doc('2026-10-03', [{ work: 'W-004', side: 'RHS', from: 10200, to: 10400 }, { work: 'W-001', layer: 'L1', side: 'LHS', from: 10900, to: 11200 }])];
  const s = R.strip(docs, works, [{ name: 'LHS', iv: [[8000, 61055]] }, { name: 'Median', iv: [[8000, 61055]] }, { name: 'RHS', iv: [[8000, 11200]] }], '2026-10-03');
  assert.deepStrictEqual(s.layers.map(l => l.name), ['Embankment · Layer 1', 'Embankment · Top', 'GSB', 'Median kerb']);
  assert.deepStrictEqual(s.sides.LHS.pieces.map(p => p.from + '-' + p.to + ' ' + p.layer), ['10000-11200 W-001|L1']);
  assert.deepStrictEqual(s.sides.RHS.pieces.map(p => p.from + '-' + p.to + ' ' + p.layer), ['10000-10200 W-001|L1', '10200-10400 W-004|', '10400-10500 W-001|L1', '10500-11200 W-001|L2']);
  assert.strictEqual(s.sides.RHS.done['W-001|L2'], 700);      // 10500–11500, clipped to the RHS stretch ending at 11+200
  assert.strictEqual(s.sides.LHS.done['W-001|L1'], 1200);     // 10000–11000 and 10900–11200 joined
  const before = R.strip(docs, works, [{ name: 'RHS', iv: null }], '2026-10-01');
  assert.deepStrictEqual(before.sides.RHS.pieces.map(p => p.layer), ['W-001|L1']);
  assert.deepStrictEqual(R.within([[0, 10], [20, 30]], [[5, 25]]), [[5, 10], [20, 25]]);
});
test('the KML: chainage labels on the centre-line ticks (a small drawing)', () => {
  const pm = (inner) => '<Placemark>' + inner + '</Placemark>', line = (a, b) => pm('<LineString><coordinates>' + a.join(',') + ',0\n' + b.join(',') + ',0</coordinates></LineString>');
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Test road</name>' +
    '<Folder><name>C-ALIGN-MEDIAN CNTR</name><Folder><name>x</name>' + pm('<LineString><coordinates>74.0,16.0,0 74.0,16.001,0 74.0,16.002,0</coordinates></LineString>') + '</Folder></Folder>' +
    '<Folder><name>C-ROAD-STAN-MAJR</name>' + [0, 1, 2].map(i => '<Folder><name>t</name>' + line([73.99999, 16 + i * 0.0009], [74.00001, 16 + i * 0.0009]) + '</Folder>').join('') +
    [0, 1, 2].map(i => '<Folder><name>t</name>' + line([74.00006, 16 + i * 0.0009], [74.00008, 16 + i * 0.0009]) + '</Folder>').join('') +
    [0, 1, 2].map(i => pm('<name>1+' + String(i * 100).padStart(3, '0') + '</name><Point><coordinates>74.0002, ' + (16 + i * 0.0009) + ', 0</coordinates></Point>')).join('') + '</Folder></Document></kml>';
  const r = K.parse(kml);
  assert.strictEqual(r.name, 'Test road'); assert.deepStrictEqual(r.stations.map(s => s[0]), [1000, 1100, 1200]);
  assert.ok(r.stations.every(s => Math.abs(s[1] - 74) < 1e-6), 'the ticks on the centre line are used, not the edge ones');
  assert.throws(() => K.parse('<html></html>'), /not a KML/);
  assert.throws(() => K.parse('<kml><Document></Document></kml>'), /no chainage labels/);
});
test('the real 18B KML (when it is on this computer)', { skip: !process.env.ENG_KML || !fs.existsSync(process.env.ENG_KML) }, () => {
  const r = K.parse(fs.readFileSync(process.env.ENG_KML, 'utf8'));
  assert.strictEqual(r.stations.length, 2654); assert.strictEqual(r.from, 8000); assert.strictEqual(r.to, 61055); assert.strictEqual(r.onTick, 2654);
  assert.ok(Math.abs(r.along - (r.to - r.from)) < 0.005 * (r.to - r.from), 'the line measures what the chainage says (within 0.5 %): ' + r.along);
});
test('the page: its script parses; its pages are the menu\'s pages', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), js = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function(js));
  const keys = Object.keys(eval('(' + /const PAGES = (\{[^}]*\})/.exec(js)[1] + ')'));
  assert.deepStrictEqual(keys, require('../api/menu.js').PAGES.map(p => p.key));
  keys.forEach(k => assert.ok(html.indexOf('id="pg_' + k + '"') > -1, 'a section for ' + k));
  const m = require('../api/menu.js');
  assert.deepStrictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'user')).map(p => p.key), ['mywork', 'strip', 'rfi', 'hind']);      // (09-11-2026: RFI, Hindrances)
  assert.strictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'admin')).length, 9); assert.strictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'super')).length, 10);      // (10-11-2026: the Measurement Book – the Admin and the Super Admin)
});
test('every action of the API is checked: the views need Admin, the set-up the Super Admin', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/eng.js'), 'utf8');
  ['roadSave', 'masterSave', 'masterActive', 'personAdd', 'assignSave'].forEach(a => assert.ok(new RegExp('A\\.' + a + ' = async \\(s, x, C\\) => \\{\\n  needSuper\\(s\\);').test(src), a + ' starts with needSuper'));
  ['dash', 'grid', 'perf', 'report'].forEach(a => assert.ok(new RegExp('A\\.' + a + ' = async \\(s, x, C\\) => \\{\\n  needView\\(s\\);').test(src), a + ' starts with needView'));
});
test('settings files; no secret in any file', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.deepStrictEqual(v.rewrites, [{ source: '/menu.json', destination: '/api/menu' }]);
  assert.ok(!fs.existsSync(path.join(ROOT, 'public/menu.json')), 'no static menu.json (it would hide the per-person menu)');
  const files = []; (function walk(d) { fs.readdirSync(d).forEach(f => { if (['.git', 'node_modules', 'shots'].indexOf(f) > -1) return; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); }); })(ROOT);
  files.filter(f => /\.(js|json|html|sql|md)$/.test(f) && !/test[\\/]/.test(f)).forEach(f => { const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/sb_secret_[A-Za-z0-9]{10,}|eyJhbGciOi[A-Za-z0-9_-]{20,}|service_role\s*[:=]\s*['"][^'"]{20,}/.test(t), 'no key in ' + path.relative(ROOT, f)); });
});

test('a Preview works only with the database marked as the TEST one (as Mechanical, the Portal and the Store); live asks nothing', async () => {
  const P = require('../lib/preview'), { db } = require('../lib/db');
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF, RCL_CHANNEL: process.env.RCL_CHANNEL, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const asked = []; let marked = false;
  global.fetch = async (url) => { asked.push(String(url));
    if (/app_settings\?id=eq\.THIS_IS_A_TEST_DATABASE/.test(url)) return marked ? new Response(JSON.stringify([{ value: 'yes' }]), { status: 200 }) : new Response('{"code":"PGRST205","message":"Could not find the table"}', { status: 404 });
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 }); };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k';
    // live (production): nothing is asked first
    process.env.VERCEL_ENV = 'production'; P._forget(); asked.length = 0;
    assert.deepStrictEqual(await db('GET', 'eng_roads?select=id'), [{ id: 1 }]); assert.strictEqual(asked.length, 1);
    // a Preview pointed at a database WITHOUT the mark (the live one): refused, nothing read
    process.env.VERCEL_ENV = 'preview'; P._forget(); asked.length = 0;
    await assert.rejects(db('GET', 'eng_roads?select=id'), e => e.status === 503 && /This is a Preview/.test(e.message));
    assert.ok(asked.every(u => /THIS_IS_A_TEST_DATABASE/.test(u)), 'only the mark was asked');
    await assert.rejects(db('POST', 'eng_days', [{ x: 1 }]), e => e.status === 503);      // remembered: refused at once
    assert.ok(!asked.some(u => /eng_days|eng_roads/.test(u)), 'nothing read or written');
    // the staging database (marked): works
    marked = true; P._forget(); asked.length = 0;
    assert.deepStrictEqual(await db('GET', 'eng_roads?select=id'), [{ id: 1 }]);
    assert.ok(asked.length === 2 && /THIS_IS_A_TEST_DATABASE/.test(asked[0]));
    // the page shows the TEST band when the server says preview
    // (02-11-2026) the BETA copy – branch "beta" AND RCL_CHANNEL = beta (Vercel, that branch only): the live data, no mark asked;
    // one of them missing, or live: as before
    marked = false; process.env.VERCEL_GIT_COMMIT_REF = 'beta'; process.env.RCL_CHANNEL = 'beta'; P._forget(); asked.length = 0;
    assert.strictEqual(P.isBeta(), true); assert.deepStrictEqual(P.band(), { beta: true });
    assert.deepStrictEqual(await db('GET', 'eng_roads?select=id'), [{ id: 1 }]); assert.strictEqual(asked.length, 1, 'the beta copy asks no mark');
    delete process.env.RCL_CHANNEL; P._forget(); asked.length = 0;
    assert.strictEqual(P.isBeta(), false); assert.deepStrictEqual(P.band(), { preview: true });
    await assert.rejects(db('GET', 'eng_roads?select=id'), e => e.status === 503 && /This is a Preview/.test(e.message));
    process.env.RCL_CHANNEL = 'beta'; process.env.VERCEL_GIT_COMMIT_REF = 'staging'; assert.strictEqual(P.isBeta(), false, 'another branch');
    process.env.VERCEL_ENV = 'production'; process.env.VERCEL_GIT_COMMIT_REF = 'beta'; assert.strictEqual(P.isBeta(), false, 'live'); assert.deepStrictEqual(P.band(), {});
    // the page: the beta band or the TEST band, as the server says
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert.ok(/if \(j\.beta\) previewBand\(true\); else if \(j\.preview \|\| \/\^This is a Preview\/\.test\(String\(j\.error \|\| ''\)\)\) previewBand\(\);/.test(html) && /id = 'rcl_preview_band'/.test(html));
    assert.ok(html.indexOf("'BETA – the new version for testers · the data is LIVE'") > -1 && html.indexOf("'TEST copy (Preview) – the staging database · nothing here is live'") > -1);
    ['me.js', 'sso.js'].forEach(f => assert.ok(/\.\.\.band\(\)/.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')), f));
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); P._forget(); }
});

test('update-155: the page keeps the answers of its looks in memory and rebuilds them exactly – the same way as Mechanical', async () => {
  const d = require('../lib/delta'), { sendKept } = require('../lib/http'), vm = require('vm');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // the two functions in the page are lib/delta.js CLIENT word for word (indented)
  const lines = d.CLIENT.split('\n'), at = page.indexOf('  ' + lines[0]);
  assert.ok(at > -1 && lines.every((l, k) => page.slice(at).split('\n')[k] === '  ' + l), 'the page carries delta.CLIENT');

  // the server's answer: whole, "the same", only what changed; per person and site
  d.clearKept();
  const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(t) { r.text = t; } }; return r; };
  const S = { site: 'S1', email: 'a@rcl.test' }, big = n => ({ items: Array.from({ length: n }, (_, i) => ({ code: 'ITM-' + String(i + 1).padStart(4, '0'), name: 'Part ' + i, unit: 'Nos' })) });
  let r = res(); sendKept(r, S, { action: 'list', m: 1 }, big(300)); const j1 = JSON.parse(r.text);
  assert.deepStrictEqual(Object.keys(j1), ['h', 'result']); assert.deepStrictEqual(j1.result, big(300));
  r = res(); sendKept(r, S, { action: 'list', m: 1, have: j1.h, dx: 1 }, big(300)); assert.deepStrictEqual(JSON.parse(r.text), { h: j1.h, same: 1 });
  r = res(); sendKept(r, S, { action: 'list', m: 1, have: j1.h, dx: 1 }, big(301)); const j3 = JSON.parse(r.text);
  assert.ok(j3.delta && j3.base === j1.h && r.text.length < 2000); assert.strictEqual(d.rclPatch(JSON.stringify(big(300)), j3.delta), JSON.stringify(big(301)));
  r = res(); sendKept(r, { site: 'S1', email: 'b@rcl.test' }, { action: 'list', m: 1, have: j3.h, dx: 1 }, big(5)); assert.ok('result' in JSON.parse(r.text), 'another person: never a change from someone else\'s answer');
  r = res(); sendKept(r, { site: 'T2', email: 'a@rcl.test' }, { action: 'list', m: 1, have: j3.h, dx: 1 }, big(5)); assert.ok('result' in JSON.parse(r.text), 'another site: the same');
  // the page's helper against these answers: always the server's answer of now
  const fns = page.slice(page.indexOf('  ' + lines[0]), page.indexOf('    return j.result;\n  }\n') + '    return j.result;\n  }\n'.length);
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(fns), 'nothing of it in the browser\'s storage');
  let list = big(200); const sent = [];
  const fetch = async (u, o) => { const b = JSON.parse(o.body); sent.push(b); const out = res(); const q = Object.assign({}, b); sendKept(out, S, q, list); return { ok: true, status: 200, text: async () => out.text }; };
  const ctx = { fetch, BASE: '', previewBand() {}, window: { crypto: globalThis.crypto, TextEncoder }, TextEncoder, Map, JSON, Object, Array, Uint8Array, String, Error, Promise };
  ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(fns + '; this.look = look; this.keptClear = keptClear;', ctx);
  d.clearKept();
  assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list); assert.ok(!('have' in sent[0]));
  assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list); assert.ok(sent[1].have && sent[1].dx === 1);
  for (let k = 0; k < 8; k++) { list = JSON.parse(JSON.stringify(list)); if (k % 2) list.items.unshift({ code: 'N' + k, name: 'New ' + k, unit: 'Nos' }); else list.items[k * 3].name = 'Changed ' + k; assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list, 'change ' + k); }
  ctx.keptClear(); await ctx.look('api/x', { action: 'list' }); assert.ok(!('have' in sent[sent.length - 1]), 'emptied: asked whole');
});

test('update-155: the looks that come together share one read of what the site has set up – never a save, never another site, 2 seconds', async () => {
  const P = require('../lib/preview'), E = require('../api/eng.js');
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const reads = []; let hold = null, failNext = false, name = 'GSB';
  global.fetch = async (url) => { const u = String(url);
    if (/eng_masters/.test(u)) { reads.push(decodeURIComponent((u.match(/site=eq\.([^&]*)/) || [])[1] || ''));
      const nm = name;      // what the database has when it is asked (the answer may come later)
      if (hold) await hold;
      if (failNext) { failNext = false; return new Response('{"code":"PGRST205x","message":"bad"}', { status: 400 }); }
      return new Response(JSON.stringify(/offset=0(&|$)/.test(u) ? [{ id: 1, kind: 'work', item: 'W-001', data: { name: nm } }] : []), { status: 200 }); }
    return new Response('[]', { status: 200 }); };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production'; P._forget(); E.forgetCtx();
    // a page that opens: 5 looks at once – one read; each gets its own copy
    const five = await Promise.all([0, 1, 2, 3, 4].map(() => E.ctxFor('S1')));
    assert.deepStrictEqual(reads, ['S1']);
    five[0].masters[0].data.name = 'changed by one request'; assert.strictEqual(five[1].masters[0].data.name, 'GSB');
    assert.strictEqual((await E.ctxFor('S1')).masters[0].data.name, 'GSB');      // what one request does never reaches another
    // another site: its own read; a save: always afresh, and the shared read is not used for it
    await E.ctxFor('T2'); assert.deepStrictEqual(reads, ['S1', 'T2']);
    await E.ctxFor('S1', true); assert.deepStrictEqual(reads, ['S1', 'T2', 'S1']);
    // a look that STARTED during a save: the save's end drops it – the next look reads again and sees the save
    E.forgetCtx(); reads.length = 0; let go; hold = new Promise(r => { go = r; });
    const during = E.ctxFor('S1');      // its read is on the way: the database gave it the work as before the save
    name = 'GSB saved'; E.ctxDrop('S1');      // the save is done (the handler's end)
    go(); hold = null; await during;
    assert.strictEqual((await E.ctxFor('S1')).masters[0].data.name, 'GSB saved'); assert.strictEqual(reads.length, 2);
    // 2 seconds later: read again (another server's save shows within 2 s)
    name = 'GSB other server'; await new Promise(r => setTimeout(r, 2050));
    assert.strictEqual((await E.ctxFor('S1')).masters[0].data.name, 'GSB other server'); assert.strictEqual(reads.length, 3);
    // a read that failed is not shared: the next look reads again
    E.forgetCtx(); failNext = true; await assert.rejects(E.ctxFor('S1'));
    assert.strictEqual((await E.ctxFor('S1')).masters[0].data.name, 'GSB other server'); assert.strictEqual(reads.length, 5);
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); P._forget(); E.forgetCtx(); }
});

test('update-155: a new row is not sent twice after no answer; one that never left, a read, a change, a delete and an upsert are asked again', async () => {
  const { db } = require('../lib/db');
  const DB = (m, p, b, pr) => db(m, p.replace('ROWS', 'eng_masters'), b, pr);
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  let plan = [], calls = 0;
  const fault = code => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error(code), { code: code }); return e; };
  global.fetch = async () => { calls++; const step = plan.shift();
    if (step === 'refused') throw fault('ECONNREFUSED');      // the request never left: no connection
    if (step === 'dropped') throw fault('UND_ERR_SOCKET');    // sent, and the answer was lost on the way back
    if (step === 500) return new Response('{"message":"boom"}', { status: 500 });
    if (step === 503) return new Response('{"message":"not reachable"}', { status: 503 });
    return new Response('[{"id":1}]', { status: 200 }); };
  const run = async (steps, ...args) => { plan = steps.slice(); calls = 0; try { return { r: await DB(...args), n: calls }; } catch (e) { return { e: e, n: calls }; } };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production';
    let x = await run(['dropped', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=representation');
    assert.ok(x.e && x.e.status === 503 && /may or may not have been saved/.test(x.e.message) && x.n === 1, 'a new row whose answer was lost: not sent again – ' + (x.e && x.e.message) + ' / ' + x.n);
    x = await run([500, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(x.e && x.n === 1, 'a new row the database answered 500 to: not sent again');
    x = await run(['refused', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row that never left (no connection): sent again');
    x = await run([503, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row the database said it did not take (503): sent again');
    for (const [m, p, pr] of [['GET', 'ROWS?select=id', undefined], ['PATCH', 'ROWS?id=eq.1', 'return=minimal'], ['DELETE', 'ROWS?id=eq.1', 'return=minimal'], ['POST', 'ROWS?on_conflict=id', 'resolution=merge-duplicates,return=minimal']]) {
      x = await run(['dropped', 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ': asked again as before (done twice it leaves the same)');
      x = await run([500, 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ' after a 500: asked again as before');
    }
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('update-157: the backup export – only with the secret; one site\'s rows only; never the sign-ins; "since" for Sheet 2', async () => {
  const E = require('../api/backup-export.js');
  const env = { BACKUP_EXPORT_SECRET: process.env.BACKUP_EXPORT_SECRET, VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const asked = [];
  global.fetch = async (url) => { const u = String(url); asked.push(u);
    if (/\/rest\/v1\/$/.test(u)) return new Response(JSON.stringify({ definitions: { eng_masters: { properties: { id: {}, site: {}, item: {}, updated_at: {} } }, eng_days: { properties: { site: {}, day: {}, email: {}, plan_at: {} } }, eng_sessions: { properties: { id_hash: {} } } } }), { status: 200 });
    if (/\?select=\*/.test(u)) return new Response(JSON.stringify([{ id: 1, site: 'S1', item: 'W-001' }]), { status: 200 });
    return new Response('[]', { status: 200, headers: { 'content-range': '*/3' } }); };
  const call = async body => { let status = 0, out = null;
    const res = { setHeader() {}, end(t) { out = JSON.parse(t); }, set statusCode(v) { status = v; } };
    await E({ method: 'POST', headers: { authorization: 'Bearer ' + 'k'.repeat(30) }, body: body }, res); return { status: status, j: out }; };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production'; process.env.BACKUP_EXPORT_SECRET = 'k'.repeat(30);
    assert.strictEqual((await call({ action: 'catalog' })).status, 400);      // a site must be named
    asked.length = 0; let r = await call({ action: 'catalog', site: 's1' });
    assert.deepStrictEqual(r.j.tables.map(t => t.name), ['eng_masters', 'eng_days']);      // the sign-ins are never in the list
    assert.ok(asked.slice(1).every(u => /&site=eq\.S1/.test(u)), asked.join(' '));      // counted for that site only
    asked.length = 0; r = await call({ action: 'rows', table: 'eng_masters', site: 'S1' });
    assert.ok(/eng_masters\?select=\*&site=eq\.S1&order=id\.asc&offset=0&limit=1000$/.test(asked[0]), asked[0]);
    assert.strictEqual((await call({ action: 'rows', table: 'eng_sessions', site: 'S1' })).status, 400);
    assert.strictEqual((await call({ action: 'rows', table: 'eng_tickets', site: 'S1' })).status, 400);
    asked.length = 0; await call({ action: 'rows', table: 'eng_days', site: 'S1', since: '2026-10-24T08:00:00Z' });
    assert.ok(/eng_days\?select=\*&site=eq\.S1&or=\(plan_at\.gte\.2026-10-24T08%3A00%3A00Z,report_at\.gte\.2026-10-24T08%3A00%3A00Z,edited_at\.gte\.2026-10-24T08%3A00%3A00Z\)&order=day\.asc,email\.asc/.test(asked[0]), asked[0]);
    assert.strictEqual((await call({ action: 'rows', table: 'eng_masters', site: "S1';--" })).status, 400);
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('update-158: the backup export says how full the Engineering database is (web_usage) – no site needed, no row of any table; before its step: which file to run', async () => {
  const E = require('../api/backup-export.js');
  const env = { BACKUP_EXPORT_SECRET: process.env.BACKUP_EXPORT_SECRET, VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  const asked = []; let missing = false;
  global.fetch = async (url, o) => { asked.push(String(url) + ' ' + ((o && o.method) || 'GET'));
    if (/rpc\/web_usage$/.test(String(url))) return missing ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ db: 98765, files: [] }), { status: 200 });
    return new Response('[]', { status: 200 }); };
  const call = async (body, auth) => { let status = 0, out = null;
    const res = { setHeader() {}, end(t) { out = JSON.parse(t); }, set statusCode(v) { status = v; } };
    await E({ method: 'POST', headers: auth === undefined ? { authorization: 'Bearer ' + 'k'.repeat(30) } : auth, body: body }, res); return { status: status, j: out }; };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production'; process.env.BACKUP_EXPORT_SECRET = 'k'.repeat(30);
    assert.strictEqual((await call({ action: 'usage' }, { authorization: 'Bearer nope' })).status, 401);
    const r = await call({ action: 'usage' });
    assert.deepStrictEqual([r.status, r.j], [200, { db: 98765, files: [] }]);
    assert.deepStrictEqual(asked, ['http://db.test/rest/v1/rpc/web_usage POST']);
    missing = true; const m = await call({ action: 'usage' });
    assert.ok(m.j.needSql && /eng_step2_usage\.sql/.test(m.j.error), JSON.stringify(m.j));
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('(28-10-2026) the assistant\'s Engineering look-ups: only these five, through Engineering\'s own looks and their checks; short answers', () => {
  const AL = require('../lib/ailook');
  assert.deepStrictEqual(AL.NAMES, ['eng_my_work', 'eng_dashboard', 'eng_report', 'eng_performance', 'eng_progress']);
  assert.throws(() => AL.day('28-10-2026', 'To date'), /^Error: Give the To date as yyyy-mm-dd\.$/); assert.strictEqual(AL.day('', 'x'), ''); assert.strictEqual(AL.day('2026-10-28', 'x'), '2026-10-28');
  assert.deepStrictEqual(AL.pick([{ a: 1, b: '', c: null, d: 'x'.repeat(300) }], ['a', 'b', 'c', 'd'], 5), [{ a: 1, d: 'x'.repeat(200) + '…' }]);
  const big = AL.fit({ total: 3, rows: Array.from({ length: 200 }, () => ({ t: 'y'.repeat(200) })) });
  assert.ok(JSON.stringify(big).length <= 14000 && big.total === 3 && /^Only the first \d+ of "rows"/.test(big.note));
  const src = fs.readFileSync(path.join(ROOT, 'api', 'eng.js'), 'utf8'), body = src.slice(src.indexOf('A.aiLook = async'), src.indexOf('/* (24-10-2026, Mechanical\'s update-155:'));
  // each look is the page's own action (with its own access check) – nothing is written
  ['A.days(s,', 'A.dash(s,', 'A.report(s,', 'A.perf(s,', 'A.strip(s,'].forEach(k => assert.ok(body.indexOf(k) > -1, k));
  assert.ok(!/db\('(POST|PATCH|DELETE)'|activity\(/.test(body), 'it writes nothing');
  assert.ok(!/'aiLook'/.test(src.slice(src.indexOf('const WRITES')).split('\n')[0]), 'not one of the saves');
  assert.match(src, /There is no such look-up of Engineering\./);
});

test('(29-10-2026) an Engineering User sends / changes the report only of today or yesterday – the Engineering Admin and the Super Admin any day; the page says so', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'eng.js'), 'utf8'), page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const at = src.indexOf('A.reportSave = async'), body = src.slice(at, src.indexOf('\n};', at));
  assert.ok(body.indexOf("if ((process.env.ENG_DAY_RULE !== 'off' || process.env.VERCEL) && !canView(s) && d < R.addDays(t, -1)) throw fail(400, 'The report of ' + R.showDay(d) + ': a user sends the report of today or yesterday only – a report of an earlier day is sent only by the Engineering Admin or the Super Admin. Ask the Admin.', 'date');") > -1);
  assert.ok(body.indexOf('!canView(s)') < body.indexOf('R.cleanReport('), 'checked before anything is read or written');
  assert.match(src, /const canView = s => s\.role === 'super' \|\| s\.role === 'admin';/);
  const pl = src.slice(src.indexOf('A.planSave = async'), src.indexOf('A.reportSave = async'));
  assert.ok(!/ENG_DAY_RULE/.test(pl), 'the plan as before: today and the next 7 days');
  assert.match(page, /const repDayOk = X => canView\(\) \|\| X >= addDays\(S\.today, -1\);/);
  assert.match(page, /if \(!repDayOk\(X\)\) return '<div class="empty" id="rp_old">A user sends the report of today or yesterday only/);
  assert.match(page, /if \(mwMayChange\(\) && repDayOk\(X\)\) h \+= '<div class="bar"><button type="button" class="btn" id="rp_change">/);
  // (the review) the rig's switch never on Vercel; a page left open past midnight reads "today" again
  assert.match(page, /async function dayCheck\(\) \{\n    if \(!S\.today \|\| S\.dayAt === istNow\(\)\.toISOString\(\)\.slice\(0, 10\)\) return;/);
  assert.match(page, /remindLoop\.t = setInterval\(async \(\) => \{ await dayCheck\(\);/);
  assert.match(page, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) dayCheck\(\); \}\);/);
});

test('(29-10-2026, "jithe jithe type krun entry hotat … voice mick … hindi english marathi"; words and numbers) speak into a box: the page has voice.js; a number said in words → the number; the site lets its own pages use the microphone (nothing else)', () => {
  const V = require('../public/voice.js');
  const cases = [["12", "12"], ["12.5", "12.5"], ["१२.५", "12.5"], ["1,200", "1200"], ["₹500", "500"], ["twelve", "12"], ["twelve point five", "12.5"], ["zero point five", "0.5"], ["point two five", "0.25"], ["one hundred twenty", "120"], ["two thousand five hundred", "2500"], ["twenty five thousand", "25000"], ["two and a half", "2.5"], ["1 lakh 20 thousand", "120000"], ["a hundred", "100"], ["बारा", "12"], ["बारा पॉइंट पाच", "12.5"], ["बारा लिटर", "12"], ["लिटर बारा", "12"], ["साडे तीन हजार", "3500"], ["साडेतीन", "3.5"], ["साडेतीनशे", "350"], ["दीडशे", "150"], ["दोनशे", "200"], ["सव्वाशे", "125"], ["पावणे दोन", "1.75"], ["दीड हजार", "1500"], ["अडीच लाख", "250000"], ["एक लाख वीस हजार", "120000"], ["पंधरा हजार पाचशे", "15500"], ["एकशेवीस", "120"], ["शंभर", "100"], ["अर्धा", "0.5"], ["चौऱ्याहत्तर", "74"], ["नव्व्याण्णव", "99"], ["पंचाहत्तर बॅग", "75"], ["बारा पंधरा", "12"], ["दो सौ", "200"], ["डेढ़ सौ", "150"], ["ढाई हज़ार", "2500"], ["एक सौ बीस", "120"], ["साढ़े चार", "4.5"], ["सवा दो", "2.25"], ["पौने तीन", "2.75"], ["अड़तीस", "38"], ["पचहत्तर", "75"], ["दो करोड़ पचास लाख", "25000000"], ["निन्यानवे", "99"], ["पाँच", "5"], ["सात सौ पचास रुपये", "750"], ["cement", ""], ["", ""], ["twenty twenty", "20"], ["twenty five", "25"], ["12 kg", "12"], ["12kg", "12"], ["50 bag", "50"], ["three point one four", "3.14"], ["एक हजार दोनशे पन्नास", "1250"], ["दोन हजार", "2000"], ["शून्य", "0"], ["सहाशे", "600"], ["पाचशे पन्नास", "550"]];
  cases.forEach(([said, want]) => assert.strictEqual(V.toNumber(said), want, said));
  assert.strictEqual(V.toNumber('नऊ आठ दोन शून्य एक', 'digits'), '98201', 'a phone number said digit by digit');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(page.includes('<script src="voice.js"></script>'), 'the page loads it');
  const pp = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).headers || []).flatMap(h => h.headers || []).find(h => h.key === 'Permissions-Policy').value;
  assert.strictEqual(pp, 'camera=(), microphone=(self), geolocation=()', 'the microphone for its own pages only; the camera and the place still off');
});

test('(29-10-2026, "supabase 2 second … data real time disne … niyojan tu kar") LIVE: every save notes an activity row (the live answer is the newest of the site); one read in 2 s for a site, never the site\'s whole read; the page asks only on Dashboard / Strip chart / All reports – 2 s, 15 s idle, nothing hidden; My work and the Set-up never redrawn by it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/eng.js'), 'utf8'), page = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const writes = /const WRITES = new Set\(\[([^\]]+)\]\)/.exec(src)[1].split(',').map(x => x.trim().replace(/'/g, ''));
  assert.ok(writes.length >= 7, writes);
  writes.forEach(n => { const i = src.indexOf('\nA.' + n + ' = async'), j = src.indexOf('\nA.', i + 5); assert.ok(i > 0, n); assert.ok(/await activity\(/.test(src.slice(i, j > 0 ? j : i + 6000)), n + ' notes an activity row'); });
  assert.ok(src.includes("db('GET', 'eng_activity?select=id,at&site=eq.' + enc(site) + '&order=at.desc&limit=1')"), 'its index (site, at)');
  assert.ok(src.includes('if (c && Date.now() - c.at < 2000) return c.p;'));
  assert.ok(src.includes("const C = x.action === 'live' ? null : await ctxFor(s.site, w);"), "the live question never reads the site's whole set-up");
  assert.ok(src.includes('finally { if (w) { ctxDrop(s.site); LIVE.delete(s.site); } }'), "a save: this server's live answer read again");
  assert.ok(page.includes("const LIVE_PAGES = new Set(['dashboard', 'strip', 'allreports']);"));
  assert.ok(page.includes('liveSoon(liveIdle() ? 15000 : 2000);'));
  assert.ok(page.includes("if (LV.pend && $('dlg').hidden && document.body.dataset.loaded === pg) { LV.pend = false; await LOAD[pg](); }"));
});

// (09-11-2026, Engineering 2A) the RFI rule, the hindrances, PPC – the rules on their own
test('(09-11-2026) RFI: the layer below on a side; a line stopped only where the layer below was reported done and not approved; hindrance days; PPC', () => {
  const works = {}; [W('W-001', { name: 'Embankment', sort: 20, layers: [{ name: 'Layer 1' }, { name: 'Top' }] }), W('W-002', { name: 'Subgrade', sort: 30, layers: [{ name: 'Layer 1' }] }),
    W('W-005', { name: 'Median kerb', sort: 25, sides: ['Median'], layers: [{ name: 'Kerb' }] }), W('W-004', { name: 'Culvert', unit: 'Nos', strip: false, sort: 90 })].forEach(w => { works[w.item] = w; });
  assert.strictEqual(R.layerBelow(works, 'W-002|L1', 'LHS').id, 'W-001|L2', 'Subgrade on LHS rests on Embankment Top (the Median kerb is not on LHS)');
  assert.strictEqual(R.layerBelow(works, 'W-002|L1', 'Median').id, 'W-005|L1', 'on the Median: the kerb is the layer below');
  assert.strictEqual(R.layerBelow(works, 'W-001|L2', 'RHS').id, 'W-001|L1');
  assert.strictEqual(R.layerBelow(works, 'W-001|L1', 'RHS'), null, 'the lowest layer: nothing below');
  assert.deepStrictEqual(R.minus([[0, 100], [200, 300]], [[50, 250]]), [[0, 50], [250, 300]]);
  // done since the rule's day: Embankment Top on LHS 10+000–10+500; approved (an RFI on "Both"): 10+000–10+300
  const done = { LHS: { 'W-001|L2': [[10000, 10500]] } }, ok = R.approvedBy([{ status: 'Approved', work: 'W-001', layer: 'L2', side: 'Both', ch_from: 10000, ch_to: 10300 }, { status: 'Pending', work: 'W-001', layer: 'L2', side: 'LHS', ch_from: 10300, ch_to: 10500 }]);
  assert.deepStrictEqual(ok.LHS['W-001|L2'], [[10000, 10300]]); assert.ok(!ok.LHS['W-001|L1'] && ok.RHS, 'a waiting RFI counts for nothing; "Both" on LHS and RHS');
  const L = (side, a, b, work, layer) => ({ work: work || 'W-002', layer: layer || 'L1', side: side, from: a, to: b });
  assert.deepStrictEqual(R.rfiBlocks([L('LHS', 10000, 10300)], works, done, ok), [], 'on the approved stretch: allowed');
  let b = R.rfiBlocks([L('LHS', 10200, 10600)], works, done, ok);
  assert.deepStrictEqual(b.map(x => [x.i, x.side, x.below.name, x.miss]), [[0, 'LHS', 'Embankment · Top', [[10300, 10500]]]], 'done and not approved: stopped (beyond 10+500 the layer below was never reported – not stopped)');
  assert.match(R.rfiSay(b, 'Line'), /^Line 1 \(LHS\): Embankment · Top is not approved by the IE on 10\+300–10\+500\. Its RFI must be approved first/);
  b = R.rfiBlocks([L('Both', 10200, 10600), L('RHS', 10000, 10500), L('', null, null, 'W-004', ''), L('LHS', 10000, 10500, 'W-001', 'L1')], works, done, ok);
  assert.deepStrictEqual(b.map(x => x.i + x.side), ['0LHS'], '"Both": LHS stopped, RHS not (nothing done there); a quantity line and the lowest layer never');
  assert.deepStrictEqual(R.rfiBlocks([L('LHS', 10499.8, 10600)], works, done, ok), [], 'less than half a metre: not counted');
  // the RFI and the IE's answer
  assert.deepStrictEqual(R.cleanRfi({ work: 'W-001', layer: 'L2', side: 'LHS', from: '10+000', to: '10+300', note: ' ok ' }, works['W-001'], road, ['LHS', 'Median', 'RHS']), { work: 'W-001', layer: 'L2', side: 'LHS', from: 10000, to: 10300, qty: 300, note: 'ok' });
  assert.throws(() => R.cleanRfi({ work: 'W-001', layer: 'L2', side: 'LHS', from: '10+300', to: '10+000' }, works['W-001'], road), /^Error: The RFI: the chainage "to"/);
  assert.throws(() => R.cleanDecision({ status: 'Rejected', ie_day: '2026-11-01' }, '2026-11-09'), /why the IE rejected/);
  assert.throws(() => R.cleanDecision({ status: 'Approved', ie_day: '2026-11-10' }, '2026-11-09'), /cannot be after today/);
  assert.throws(() => R.cleanDecision({ status: 'Maybe', ie_day: '2026-11-01' }, '2026-11-09'), /approved or rejected/);
  assert.deepStrictEqual(R.cleanDecision({ status: 'Approved', ie_day: '2026-11-08', ie_name: ' Mr IE ', ie_ref: 'RFI/18B/77' }, '2026-11-09'), { status: 'Approved', ie_day: '2026-11-08', ie_name: 'Mr IE', ie_ref: 'RFI/18B/77', ie_remark: '' });
  // a hindrance: checked; its days inside a period
  const hc = { today: '2026-11-09', road: road, sideNames: ['LHS', 'Median', 'RHS'], works: works };
  assert.deepStrictEqual(R.cleanHindrance({ from_day: '2026-11-01', kind: ' Land not handed over ', works: ['W-002', 'W-002'], ch_from: '12+000', ch_to: '12+800', side: 'LHS' }, hc),
    { from_day: '2026-11-01', to_day: null, ch_from: 12000, ch_to: 12800, side: 'LHS', works: ['W-002'], kind: 'Land not handed over', detail: '', letter: '' });
  assert.throws(() => R.cleanHindrance({ from_day: '2026-11-10', kind: 'Rain' }, hc), /starts today or a day before/);
  assert.throws(() => R.cleanHindrance({ from_day: '2026-11-05', to_day: '2026-11-04', kind: 'Rain' }, hc), /on or after "from"/);
  assert.throws(() => R.cleanHindrance({ from_day: '2026-11-05', kind: '' }, hc), /Say what the hindrance is/);
  assert.throws(() => R.cleanHindrance({ from_day: '2026-11-05', kind: 'Rain', ch_from: '12+000' }, hc), /both chainages/);
  assert.throws(() => R.cleanHindrance({ from_day: '2026-11-05', kind: 'Rain', works: ['W-999'] }, hc), /from the list/);
  assert.strictEqual(R.hindDays({ from_day: '2026-11-01', to_day: null }, '2026-10-01', '2026-11-30', '2026-11-09'), 9, 'still on: up to today');
  assert.strictEqual(R.hindDays({ from_day: '2026-10-25', to_day: '2026-11-03' }, '2026-11-01', '2026-11-30', '2026-11-09'), 3, 'only the days inside the period');
  assert.strictEqual(R.hindDays({ from_day: '2026-09-01', to_day: '2026-09-03' }, '2026-11-01', '2026-11-30', '2026-11-09'), 0);
  // PPC: plan lines done as planned (all or more) of the reported days; work outside the plan does not count
  const doc = (plan, lines, extra) => ({ email: 'a', day: '2026-11-01', plan: plan, report: { lines: lines, extra: extra || [] } });
  const p = [{ id: 'p1', work: 'W-001', layer: 'L1', side: 'LHS', from: 0, to: 100, qty: 100 }, { id: 'p2', work: 'W-001', layer: 'L1', side: 'LHS', from: 100, to: 200, qty: 100 }, { id: 'p3', work: 'W-004', qty: 2 }];
  assert.deepStrictEqual(R.ppcOf([doc(p, [{ plan: 'p1', qty: 100, left: 0 }, { plan: 'p2', qty: 60, left: 40, reason: 'rain' }, { plan: 'p3', qty: 3, left: 0 }], [{ work: 'W-001', qty: 50 }]), { email: 'a', day: '2026-11-02', plan: p, report: null }]), { lines: 3, done: 2, pct: 67 });
  assert.deepStrictEqual(R.ppcOf([]), { lines: 0, done: 0, pct: null });
});
test('(09-11-2026) RFI and hindrances in the API: who may do what; every save notes an activity row; before step 3 the pages say which file to run', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/eng.js'), 'utf8');
  assert.ok(/A\.rfiRule = async \(s, x\) => \{\n  needSuper\(s\);/.test(src), 'the rule: the Super Admin only');
  assert.ok(/A\.rfiDecide = async \(s, x\) => \{\n  if \(!canView\(s\)\) throw fail\(403/.test(src), 'the IE\'s answer: the Admin or the Super Admin');
  assert.ok(/if \(isSuper\(s\) && why\.length >= 3\) return/.test(src), 'only the Super Admin lets a line through, with a reason');
  assert.ok(/const skip = await rfiCheck\(s, C, d, plan, 'Line', x\);/.test(src) && /const skip = await rfiCheck\(s, C, d, doneLines, 'Line', x\);/.test(src), 'the plan and the report are both checked');
  assert.ok(/if \(!rule \|\| !rule\.on \|\| !rule\.from \|\| d < rule\.from\) return null;/.test(src), 'rule off, not set up (no step 3), or a day before its start: nothing stopped');
  const db = fs.readFileSync(path.join(ROOT, 'lib/db.js'), 'utf8');
  assert.match(db, /eng_\(rfi\|hindrance\|settings\|numbers\|next_no\)/); assert.match(db, /sql\/eng_step3_qc_hindrance\.sql/);
  const sql = fs.readFileSync(path.join(ROOT, 'sql/eng_step3_qc_hindrance.sql'), 'utf8');
  assert.ok(!/\b(drop table|delete from|truncate|alter table [^;]* drop)\b/i.test(sql.replace(/^--.*$/gm, '')), 'step 3 only adds');
  ['eng_settings', 'eng_numbers', 'eng_rfi', 'eng_hindrance'].forEach(t => assert.ok(sql.includes('create table if not exists public.' + t + ' ('), t));
  assert.match(sql, /revoke all on function public\.eng_next_no\(text, text\) from public, anon, authenticated;/);
});

// (10-11-2026, Engineering 2B) THE MEASUREMENT BOOK – the quantity rules on their own
const SD = (item, data, from, to, active) => ({ kind: 'side', item: item, data: R.cleanData('side', data, null), valid_from: from || '2026-01-01', valid_to: to || null, active: active !== false });
test('(10-11-2026) MB: the quantity of each unit – metres: length × width × thickness (cum), no thickness: × width (sq m), no width: the length; sq m / cum / Nos: the reported quantity', () => {
  assert.deepStrictEqual(R.mbQty('m', 400, 7.5, 250, 400), { qty: 750, unit: 'cum', how: 'LxWxT' });            // 400 × 7.5 × 0.250
  assert.deepStrictEqual(R.mbQty('m', 123.4, 7.25, 200, 0), { qty: 178.93, unit: 'cum', how: 'LxWxT' });       // 123.4 × 7.25 × 0.2 = 178.93
  assert.deepStrictEqual(R.mbQty('m', 100, 2, null, 100), { qty: 200, unit: 'sq m', how: 'LxW' });
  assert.deepStrictEqual(R.mbQty('m', 100, null, 250, 100), { qty: 100, unit: 'm', how: 'L' });
  assert.deepStrictEqual(R.mbQty('sq m', 100, 7.5, null, 812.5), { qty: 812.5, unit: 'sq m', how: 'reported' });
  assert.deepStrictEqual(R.mbQty('cum', null, null, null, 44.256), { qty: 44.256, unit: 'cum', how: 'reported' });
  assert.deepStrictEqual(R.mbQty('Nos', null, null, null, 2), { qty: 2, unit: 'Nos', how: 'reported' });
  assert.deepStrictEqual(R.mbTotals([{ unit: 'Nos', qty: 2 }, { unit: 'cum', qty: 0.1 }, { unit: 'cum', qty: 0.2 }, { unit: 'm', qty: 5 }]), [{ unit: 'cum', qty: 0.3 }, { unit: 'm', qty: 5 }, { unit: 'Nos', qty: 2 }]);
});
test('(10-11-2026) MB: the width of a side along a stretch, as on the day (its version) – a change of width, a gap with no width', () => {
  const ms = [SD('S-001', { name: 'LHS', from: 8000, to: 20000, width: 7.5 }, '2026-01-01', '2026-10-31'), SD('S-001', { name: 'LHS', from: 8000, to: 20000, width: 8 }, '2026-11-01'),
    SD('S-002', { name: 'LHS', from: 20500, to: 30000, width: 7 }), SD('S-003', { name: 'RHS', from: 8000, to: 30000, width: 7.5 }), SD('S-004', { name: 'LHS', from: 30000, to: 40000, width: 9 }, '2026-01-01', null, false)];
  assert.deepStrictEqual(R.widthPieces(ms, 'LHS', '2026-10-31', 19800, 21000), [{ from: 19800, to: 20000, width: 7.5 }, { from: 20000, to: 20500, width: null }, { from: 20500, to: 21000, width: 7 }]);
  assert.deepStrictEqual(R.widthPieces(ms, 'LHS', '2026-11-01', 19800, 20000), [{ from: 19800, to: 20000, width: 8 }], 'the new period from 1 Nov');
  assert.deepStrictEqual(R.widthPieces(ms, 'RHS', '2026-11-01', 19800, 21000), [{ from: 19800, to: 21000, width: 7.5 }], 'each side its own width');
  assert.deepStrictEqual(R.widthPieces(ms, 'LHS', '2026-11-01', 31000, 31100), [{ from: 31000, to: 31100, width: null }], 'an inactive stretch gives no width');
  assert.deepStrictEqual(R.widthPieces(ms, 'Median', '2026-11-01', 10000, 10100), [{ from: 10000, to: 10100, width: null }]);
});
const mbMasters = () => [W('W-002', { name: 'Subgrade', sort: 30, layers: [{ name: 'Layer 1', mm: 250 }, { name: 'Top', mm: 250 }] }, '2026-01-01', '2026-10-31'),
  W('W-002', { name: 'Subgrade', sort: 30, layers: [{ key: 'L1', name: 'Layer 1', mm: 300 }, { key: 'L2', name: 'Top', mm: 250 }] }, '2026-11-01'), W('W-004', { name: 'Culvert', unit: 'Nos', strip: false }), W('W-006', { name: 'Prime coat', unit: 'sq m', strip: false }),
  W('W-007', { name: 'Kerb', sides: ['Median'], layers: [{ name: 'Kerb' }] }),
  SD('S-001', { name: 'LHS', from: 8000, to: 61055, width: 7.5 }, '2026-01-01', '2026-10-31'), SD('S-001', { name: 'LHS', from: 8000, to: 61055, width: 8 }, '2026-11-01'), SD('S-002', { name: 'Median', from: 8000, to: 61055, width: 2 }), SD('S-003', { name: 'RHS', from: 8000, to: 61055, width: 7.5 })];
const mbDoc = (day, extra, email, plan, lines) => ({ day: day, email: email || 'a@x', name: 'A', plan: plan || [], report: { lines: lines || [], extra: extra.map((x, i) => Object.assign({ id: 'x' + (i + 1), layer: '', side: '', from: null, to: null }, x, { qty: x.qty !== undefined ? x.qty : Math.abs(x.to - x.from) })), note: '' } });
const mbOf = (docs, x) => R.mbOffer(Object.assign({ docs: docs, masters: mbMasters(), work: 'W-002', layer: 'L1', sides: null, claimed: [], rfis: [], rule: null }, x || {}));
const lineOf = l => [l.day, l.side, l.from, l.to, l.w_m, l.mm_m, l.qty, l.unit].join(' ');
test('(10-11-2026) MB: the lines offered – "Both" on LHS and RHS with each side\'s width, the version of the day, reported twice, already in the MB, one side asked', () => {
  const docs = [mbDoc('2026-10-30', [{ work: 'W-002', layer: 'L1', side: 'Both', from: 30000, to: 30400 }]), mbDoc('2026-11-02', [{ work: 'W-002', layer: 'L1', side: 'LHS', from: 30300, to: 30700 }, { work: 'W-002', layer: 'L2', side: 'LHS', from: 30000, to: 30100 }])];
  let o = mbOf(docs);
  // 30 Oct: 400 × 7.5 × 0.25 = 750 on each side; 2 Nov (LHS 8 m, 300 mm): 30+400–30+700 only = 300 × 8 × 0.3 = 720
  assert.deepStrictEqual(o.lines.map(lineOf), ['2026-10-30 LHS 30000 30400 7.5 250 750 cum', '2026-10-30 RHS 30000 30400 7.5 250 750 cum', '2026-11-02 LHS 30400 30700 8 300 720 cum']);
  assert.deepStrictEqual(o.skipped.map(x => x.why + ' ' + x.len), ['reported twice 100']);
  assert.deepStrictEqual(o.lines.map(l => l.key), ['2026-10-30|a@x|x1|LHS|30000|30400', '2026-10-30|a@x|x1|RHS|30000|30400', '2026-11-02|a@x|x1|LHS|30400|30700']);
  // the other pages hold 30+000–30+200 on LHS: only the rest is offered (never measured twice)
  o = mbOf(docs, { claimed: [{ side: 'LHS', from: 30000, to: 30200, src: 'z' }] });
  assert.deepStrictEqual(o.lines.map(lineOf), ['2026-10-30 LHS 30200 30400 7.5 250 375 cum', '2026-10-30 RHS 30000 30400 7.5 250 750 cum', '2026-11-02 LHS 30400 30700 8 300 720 cum']);
  assert.deepStrictEqual(o.skipped.map(x => x.why + ' ' + x.len).sort(), ['in the MB 200', 'reported twice 100']);
  // one side asked: the same lines (the same keys) of that side only
  const all = mbOf(docs).lines, rhs = mbOf(docs, { sides: ['RHS'] }).lines, lhs = mbOf(docs, { sides: ['LHS'] }).lines;
  assert.deepStrictEqual(rhs.map(l => l.key), all.filter(l => l.side === 'RHS').map(l => l.key)); assert.deepStrictEqual(lhs.map(l => l.key), all.filter(l => l.side === 'LHS').map(l => l.key));
  // the layer asked only; a width change along the stretch splits the line; a plan line done (its own id) – a plan line not done is not offered
  const plan = [{ id: 'p1', work: 'W-002', layer: 'L1', side: 'RHS', from: 40000, to: 40500, qty: 500 }, { id: 'p2', work: 'W-002', layer: 'L1', side: 'RHS', from: 41000, to: 41100, qty: 100 }];
  o = mbOf([mbDoc('2026-11-03', [], 'b@x', plan, [{ plan: 'p1', side: 'RHS', from: 40000, to: 40250, qty: 250, left: 250, reason: 'rain' }, { plan: 'p2', side: 'RHS', from: null, to: null, qty: 0, left: 100, reason: 'no' }])], { layer: 'L2' });
  assert.strictEqual(o.lines.length, 0);
  o = mbOf([mbDoc('2026-11-03', [], 'b@x', plan, [{ plan: 'p1', side: 'RHS', from: 40000, to: 40250, qty: 250, left: 250, reason: 'rain' }, { plan: 'p2', side: 'RHS', from: null, to: null, qty: 0, left: 100, reason: 'no' }])]);
  assert.deepStrictEqual(o.lines.map(l => l.line + ' ' + l.outside + ' ' + lineOf(l)), ['p1 false 2026-11-03 RHS 40000 40250 7.5 300 562.5 cum']);
  // the Median kerb: no thickness → length × width (sq m)
  o = R.mbOffer({ docs: [mbDoc('2026-11-03', [{ work: 'W-007', layer: 'L1', side: 'Median', from: 10000, to: 10050 }])], masters: mbMasters(), work: 'W-007', layer: 'L1', sides: null, claimed: [], rfis: [], rule: null });
  assert.deepStrictEqual(o.lines.map(lineOf), ['2026-11-03 Median 10000 10050 2  100 sq m']);
});
test('(10-11-2026) MB: a reported quantity (sq m, cum, Nos) – one line, never split; without chainage: once by its report line; with chainage: whole or not at all', () => {
  const docs = [mbDoc('2026-11-02', [{ work: 'W-004', qty: 2 }, { work: 'W-004', qty: 1, side: 'LHS', from: 25300, to: 25312 }]), mbDoc('2026-11-03', [{ work: 'W-004', qty: 1, side: 'LHS', from: 25305, to: 25315 }])];
  let o = R.mbOffer({ docs: docs, masters: mbMasters(), work: 'W-004', layer: '', sides: null, claimed: [], rfis: [], rule: null });
  assert.deepStrictEqual(o.lines.map(l => [l.key, l.qty, l.unit, l.how, l.from, l.len].join(' ')), ['2026-11-02|a@x|x1| 2 Nos reported  ', '2026-11-02|a@x|x2|LHS 1 Nos reported 25300 12']);
  assert.deepStrictEqual(o.skipped.map(x => x.why), ['reported twice']);
  o = R.mbOffer({ docs: docs, masters: mbMasters(), work: 'W-004', layer: '', sides: null, claimed: [{ side: '', from: null, to: null, src: '2026-11-02|a@x|x1' }], rfis: [], rule: null });
  assert.deepStrictEqual(o.lines.map(l => l.line), ['x2'], 'the line without chainage already in the MB (by its report line)');
  // an area work on Both: one line (its reported quantity is of both sides); a later LHS line over it is not offered
  const pc = [mbDoc('2026-11-02', [{ work: 'W-006', qty: 6000, side: 'Both', from: 10000, to: 10400 }]), mbDoc('2026-11-03', [{ work: 'W-006', qty: 900, side: 'LHS', from: 10300, to: 10420 }])];
  o = R.mbOffer({ docs: pc, masters: mbMasters(), work: 'W-006', layer: '', sides: null, claimed: [], rfis: [], rule: null });
  assert.deepStrictEqual(o.lines.map(l => [l.side, l.qty, l.unit].join(' ')), ['Both 6000 sq m']);
  assert.deepStrictEqual(o.skipped.map(x => x.side + ' ' + x.why), ['LHS reported twice']);
});
test('(10-11-2026) MB and E1: the RFI rule on – a stretch done from its day without an approved RFI of the same layer is "not approved"; before its day not asked; the RFI no. on the line', () => {
  const docs = [mbDoc('2026-11-03', [{ work: 'W-002', layer: 'L1', side: 'Both', from: 32000, to: 32250 }]), mbDoc('2026-10-20', [{ work: 'W-002', layer: 'L1', side: 'LHS', from: 33000, to: 33100 }])];
  const rfis = [{ no: 'RFI-0007', status: 'Approved', work: 'W-002', layer: 'L1', side: 'Both', ch_from: 32000, ch_to: 32100 }, { no: 'RFI-0008', status: 'Approved', work: 'W-002', layer: 'L2', side: 'LHS', ch_from: 32000, ch_to: 32250 },
    { no: 'RFI-0009', status: 'Approved', work: 'W-002', layer: 'L1', side: 'RHS', ch_from: 32100, ch_to: 32249.8 }, { no: 'RFI-0010', status: 'Pending', work: 'W-002', layer: 'L1', side: 'LHS', ch_from: 32100, ch_to: 32250 }];
  const o = mbOf(docs, { rfis: rfis, rule: { on: true, from: '2026-11-01' } });
  assert.deepStrictEqual(o.lines.map(l => [l.day, l.side, l.from, l.to, l.appr, l.rfi.join('+')].join(' ')), ['2026-10-20 LHS 33000 33100 off ', '2026-11-03 LHS 32000 32100 yes RFI-0007', '2026-11-03 LHS 32100 32250 no ', '2026-11-03 RHS 32000 32250 yes RFI-0007+RFI-0009'],
    'before the rule\'s day: not asked; LHS: approved only to 32+100 (RFI-0008 is another layer, RFI-0010 waits); RHS: covered but for 0.2 m – approved');
  const off = mbOf(docs, { rfis: rfis, rule: { on: false, from: '2026-11-01' } });
  assert.ok(off.lines.every(l => l.appr === 'off') && off.lines.find(l => l.side === 'LHS' && l.from === 32000).rfi.join() === 'RFI-0007', 'the rule off: nothing asked, the RFI still shown');
  // an area work on Both: approved only when both sides are covered
  const pc = [mbDoc('2026-11-03', [{ work: 'W-006', qty: 3000, side: 'Both', from: 10000, to: 10200 }])], rf = side => [{ no: 'RFI-0011', status: 'Approved', work: 'W-006', layer: '', side: side, ch_from: 10000, ch_to: 10200 }];
  assert.strictEqual(R.mbOffer({ docs: pc, masters: mbMasters(), work: 'W-006', layer: '', claimed: [], rfis: rf('LHS'), rule: { on: true, from: '2026-11-01' } }).lines[0].appr, 'no');
  assert.strictEqual(R.mbOffer({ docs: pc, masters: mbMasters(), work: 'W-006', layer: '', claimed: [], rfis: rf('Both'), rule: { on: true, from: '2026-11-01' } }).lines[0].appr, 'yes');
});
test('(10-11-2026) MB: a line measured – the width / thickness measured needs a remark when it differs from the masters; not approved: only the Super Admin, with a reason', () => {
  const [l1] = mbOf([mbDoc('2026-10-30', [{ work: 'W-002', layer: 'L1', side: 'LHS', from: 30000, to: 30400 }])]).lines;
  assert.deepStrictEqual(R.mbLine(l1, {}, false, 1).qty, 750);
  assert.deepStrictEqual(R.mbLine(l1, { w: '7.5', mm: 250 }, false, 1).qty, 750, 'the masters\' figures typed again: no remark needed');
  assert.throws(() => R.mbLine(l1, { w: '7.4' }, false, 1), /^Error: Line 1 \(LHS 30\+000–30\+400\): the width differs from the masters \(7\.5 m\) – write a remark/);
  assert.throws(() => R.mbLine(l1, { mm: '240' }, false, 3), /Line 3 .*: the thickness differs from the masters \(250 mm\)/);
  const x = R.mbLine(l1, { w: '7.4', mm: '240', remark: 'as measured' }, false, 2);
  assert.deepStrictEqual([x.ln, x.w, x.mm, x.w_m, x.mm_m, x.qty, x.unit, x.how, x.remark], [2, 7.4, 240, 7.5, 250, 710.4, 'cum', 'LxWxT', 'as measured']);      // 400 × 7.4 × 0.24
  assert.throws(() => R.mbLine(l1, { w: '-1', remark: 'x x' }, false, 1), /the width is in metres/); assert.throws(() => R.mbLine(l1, { mm: '9000', remark: 'x x' }, false, 1), /the thickness is in mm/);
  const nw = Object.assign({}, l1, { w_m: null, qty: 400, unit: 'm', how: 'L' });
  assert.throws(() => R.mbLine(nw, { w: 7 }, false, 1), /differs from the masters \(not set\)/);
  assert.deepStrictEqual(R.mbLine(nw, { w: 7, remark: 'taped 7 m' }, false, 1).qty, 700, 'no width in the masters: the measured one (400 × 7 × 0.25)');
  const nos = { key: 'k', how: 'reported', qty: 2, unit: 'Nos', w_m: null, mm_m: null, len: null, from: null, side: '', appr: 'off' };
  assert.deepStrictEqual([R.mbLine(nos, { w: 5, mm: 5 }, false, 1).qty, R.mbLine(nos, { w: 5 }, false, 1).w], [2, null], 'a reported quantity: width / thickness do not apply');
  const no = Object.assign({}, l1, { appr: 'no' });
  assert.throws(() => R.mbLine(no, { skip: 'IE saw it' }, false, 1), /not approved by the IE – the layer is not finished \(E1\), so it is not measured/);
  assert.throws(() => R.mbLine(no, { skip: 'ok' }, true, 1), /write why it is measured anyway/);
  assert.strictEqual(R.mbLine(no, { skip: 'IE inspected, letter awaited' }, true, 1).skip, 'IE inspected, letter awaited');
});
test('(10-11-2026) MB: the abstract – check-measured only, by the MB date: up to the previous period, this period, cumulative', () => {
  const pg = (no, day, status, lines, work, layer) => ({ no: no, mb_day: day, status: status, work: work || 'W-002', layer: layer === undefined ? 'L1' : layer, lines: lines });
  const a = R.mbAbstract([pg('MB-0001', '2026-10-25', 'Check-measured', [{ unit: 'cum', qty: 740 }, { unit: 'cum', qty: 750.25 }]), pg('MB-0002', '2026-11-03', 'Check-measured', [{ unit: 'cum', qty: 225 }]), pg('MB-0003', '2026-11-04', 'Measured', [{ unit: 'cum', qty: 100 }]),
    pg('MB-0004', '2026-11-05', 'Sent back', [{ unit: 'cum', qty: 50 }]), pg('MB-0005', '2026-11-20', 'Check-measured', [{ unit: 'cum', qty: 999 }]), pg('MB-0006', '2026-10-02', 'Check-measured', [{ unit: 'Nos', qty: 2 }], 'W-004', ''), pg('MB-0007', '2026-11-02', 'Check-measured', [{ unit: 'sq m', qty: 10.5 }])], '2026-11-01', '2026-11-10');
  assert.deepStrictEqual(a.map(g => [g.work, g.layer, g.unit, g.prev, g.now, g.cum, g.pages.join('+')].join(' ')), ['W-002 L1 cum 1490.25 225 1715.25 MB-0002', 'W-004  Nos 2 0 2 ', 'W-002 L1 sq m 0 10.5 10.5 MB-0007']);
});
test('(10-11-2026) MB in the API: every action is the Admin\'s / the Super Admin\'s (checked first); never one\'s own check; every save noted; step 4 only adds, guarded, named before step 3', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/eng.js'), 'utf8');
  ['mbOffer', 'mbSave', 'mbCheck', 'mbBack', 'mbList', 'mbGet', 'mbAbstract'].forEach(a => assert.ok(new RegExp('A\\.' + a + ' = async \\(s, x, C\\) => \\{\n  needView\\(s\\);').test(src), a + ' starts with needView'));
  assert.ok(/const WRITES = new Set\(\[[^\]]*'mbSave', 'mbCheck', 'mbBack'\]\)/.test(src), 'the MB saves are writes (a fresh read; the activity record is checked by the LIVE test above)');
  assert.ok(src.includes("if (old.measured_by === s.email) throw fail(403, 'You measured ' + old.no"), 'never one\'s own check / send back');
  assert.ok(src.includes("if (old.measured_by !== s.email && !isSuper(s)) throw fail(403, 'Only the one who measured '"), 'a change: the one who measured it, or the Super Admin');
  assert.ok(src.includes("return R.mbLine(by[k], w, isSuper(s), i + 1);"), 'every line is worked out again on the server from the reports (never the page\'s figures)');
  assert.ok(src.includes("db('POST', 'rpc/eng_mb_put'"), 'saved through the one-step function (never twice, also at the same moment)');
  const db = fs.readFileSync(path.join(ROOT, 'lib/db.js'), 'utf8');
  assert.ok(db.indexOf('notinstalled4') > 0 && db.indexOf('notinstalled4') < db.indexOf('notinstalled3'), 'step 4 is named before step 3 (a missing function\'s hint names eng_next_no)');
  assert.match(db, /sql\/eng_step4_mb\.sql/);
  const q = fs.readFileSync(path.join(ROOT, 'sql/eng_step4_mb.sql'), 'utf8'), code = q.replace(/^--.*$/gm, '');
  assert.ok(!/\b(drop table|drop function|delete from|truncate|alter table [^;]* drop)\b/i.test(code), 'step 4 only adds');
  assert.ok(code.includes('create table if not exists public.eng_mb (') && code.includes('create or replace function public.eng_mb_put('), 'its table and its function, re-runnable');
  assert.ok(/to_regprocedure\('public\.eng_next_no\(text, text\)'\) is null then\s+raise exception 'Run sql\/eng_step3_qc_hindrance\.sql first/.test(code), 'it needs step 3 first');
  assert.ok(code.includes("pg_advisory_xact_lock(hashtext('eng_mb ' || p_site))") && code.includes("t.status <> 'Check-measured'"), 'one save of a site at a time; a check-measured page never changed');
  assert.match(code, /revoke all on function public\.eng_mb_put\(text, text, integer, jsonb\) from public, anon, authenticated;/);
  assert.match(code, /alter table public\.eng_mb enable row level security;\nrevoke all on public\.eng_mb from public, anon, authenticated;/);
  assert.match(q.trim().split('\n').slice(-2).join('\n'), /^select 'Engineering step 4 done · /);
  const page = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(page.includes('id="pg_mb"') && page.includes("const MB_TXT = ") && page.includes('<script src="voice.js"></script>'), 'the page has the MB and the voice script (every new box gets the 🎙 by itself)');
  assert.ok(!/data-novoice/.test(page.slice(page.indexOf('id="pg_mb"'), page.indexOf('<!-- SET-UP'))), 'no MB box is kept from the 🎙');
});
test('(10-11-2026) MB: before step 4 the database\'s answer names step 4 – the table or the function missing (also when its hint names step 3\'s eng_next_no); step 3 and step 1 as before', async () => {
  const { db } = require('../lib/db');
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  let body = '';
  global.fetch = async () => new Response(body, { status: 404 });
  const codeOf = async (t, m, p) => { body = t; try { await db(m || 'GET', p || 'eng_mb?select=no'); return 'none'; } catch (e) { return e.code; } };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production';
    // (the texts as the rig's PostgREST 12 gives them, and as a newer one names a table missing from its schema cache)
    assert.strictEqual(await codeOf('{"code":"42P01","details":null,"hint":null,"message":"relation \\"public.eng_mb\\" does not exist"}'), 'notinstalled4');
    assert.strictEqual(await codeOf('{"code":"PGRST205","details":null,"hint":"Perhaps you meant the table \'public.eng_days\'","message":"Could not find the table \'public.eng_mb\' in the schema cache"}'), 'notinstalled4');
    assert.strictEqual(await codeOf('{"code":"PGRST202","details":"Searched for the function public.eng_mb_put with parameters p_no, p_row, p_site, p_ver or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.","hint":"Perhaps you meant to call the function public.eng_next_no","message":"Could not find the function public.eng_mb_put(p_no, p_row, p_site, p_ver) in the schema cache"}', 'POST', 'rpc/eng_mb_put'), 'notinstalled4');
    assert.strictEqual(await codeOf('{"code":"42P01","details":null,"hint":null,"message":"relation \\"public.eng_rfi\\" does not exist"}', 'GET', 'eng_rfi?select=no'), 'notinstalled3');
    assert.strictEqual(await codeOf('{"code":"42P01","details":null,"hint":null,"message":"relation \\"public.eng_days\\" does not exist"}', 'GET', 'eng_days?select=day'), 'notinstalled');
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});

test('(10-11-2026, his animation brief) motion – the question box pops in (from 72 %), a page zooms in, a button is pressed in, the message slides in kept centred; transform / opacity only; off with reduced motion', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = html.slice(html.indexOf('(motion – his brief of 10-11-2026'), html.indexOf('</style>', html.indexOf('(motion – his brief of 10-11-2026')));
  assert.ok(css.length > 800 && html.indexOf('(motion – his brief of 10-11-2026') < html.indexOf('</style>'), 'in the page\'s stylesheet, last');
  assert.match(css, /\.dlg-back:not\(\[hidden\]\) \.dlg \{ animation: moPop \.26s/);
  assert.match(css, /@keyframes moPop \{ from \{ opacity: 0; transform: scale\(\.72\); \}/);
  assert.match(css, /div\[id\^="pg_"\]:not\(\[hidden\]\) \{ animation: moZoomIn \.22s/);
  assert.match(css, /@keyframes moToast \{ from \{ opacity: 0; transform: translate\(-50%, 10px\); \} to \{ opacity: 1; transform: translate\(-50%, 0\); \} \}/, 'the message stays centred');
  [...css.matchAll(/@keyframes (\w+) \{([^@]*?)\} \}/g)].forEach(k => assert.doesNotMatch(k[2], /\b(width|height|top|left|margin|padding)\s*:/, k[1] + ': transform / opacity only'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.dlg-back, \.dlg, div\[id\^="pg_"\], #toast \{ animation: none !important; \}/);
});
