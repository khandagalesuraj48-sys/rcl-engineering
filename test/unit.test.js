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
  assert.deepStrictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'user')).map(p => p.key), ['mywork', 'strip']);
  assert.strictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'admin')).length, 6); assert.strictEqual(m.PAGES.filter(p => m.mayOpen(p.who, 'super')).length, 7);
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
