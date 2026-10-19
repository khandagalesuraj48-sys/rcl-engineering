/* THE RULES OF ENGINEERING – checked on the server for every save, and the figures of every view worked out from the saved days.
 * Plain functions (no database): the API reads, these decide, the API writes. The unit test runs them on their own.
 *
 * CHAINAGE is kept in metres (8+020 = 8020) and shown as km+m. A WORK has layers (Embankment: Layer 1, Layer 2, Top …) and an
 * order (sort): in the strip chart a place shows the highest layer finished there – the work with the higher order, and inside a
 * work the later layer. Everything the Super Admin sets is kept PERIOD BY PERIOD (valid from / to, Active / Inactive): a day is
 * always measured with the version of that day, so a new period never changes what was done before it.
 * A PERSON'S DAY: his plan (lines: work, layer, side, chainage from–to or a quantity) and his report of it (for every plan line
 * what was done and, when something is left, why; work outside the plan). */
'use strict';
const { fail } = require('./http');

/* ---------- dates (India) ---------- */
const IST = 330 * 60000;
const today = now => new Date((now || Date.now()) + IST).toISOString().slice(0, 10);
const hourIST = now => new Date((now || Date.now()) + IST).getUTCHours();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(v, what) {
  const s = String(v || '').trim();
  if (!DAY.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) throw fail(400, 'Pick a proper date' + (what ? ' for ' + what : '') + '.', 'date');
  return s;
}
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const showDay = d => d ? d.split('-').reverse().join('-') : '';

/* ---------- chainage ---------- */
// "8+020", "8020", "8.020 km" → 8020 (metres); '' → null
function chain(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 1000) / 1000 : NaN;
  const s = String(v).trim().replace(/\s+/g, '');
  if (!s) return null;
  let m = /^(\d{1,4})\+(\d{1,3}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 1000 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)km$/i.exec(s);
  if (m) return Math.round(Number(m[1]) * 1000 * 1000) / 1000;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
function showCh(m) {
  if (m === null || m === undefined || m === '' || !isFinite(m)) return '';
  const km = Math.floor(m / 1000), r = Math.round((m - km * 1000) * 1000) / 1000;
  const whole = Math.floor(r), part = r - whole;
  return km + '+' + String(whole).padStart(3, '0') + (part ? String(Math.round(part * 1000) / 1000).slice(1) : '');
}
const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;

/* ---------- what the Super Admin sets ---------- */
const KINDS = { work: 'W', side: 'S', mix: 'M', design: 'D' };
const UNITS = ['m', 'Nos', 'sq m', 'cum'];
const SIDE_NAMES = ['LHS', 'Median', 'RHS'];
const txt = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120);
const num = v => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; };
// the parts of a version, checked and cleaned; a mistake is said plainly
function cleanData(kind, d, road, keyFloor) {
  d = d && typeof d === 'object' ? d : {};
  if (kind === 'work') {
    const name = txt(d.name, 80); if (name.length < 2) throw fail(400, 'Give the work a name.', 'name');
    const unit = UNITS.indexOf(d.unit) > -1 ? d.unit : 'm';
    const sides = (Array.isArray(d.sides) ? d.sides : []).map(x => txt(x, 30)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 8);
    const sort = num(d.sort); if (d.sort !== undefined && d.sort !== '' && !(sort >= 0 && sort <= 999)) throw fail(400, 'The order must be a number from 0 to 999.', 'sort');
    const seen = {};
    const layers = (Array.isArray(d.layers) ? d.layers : []).slice(0, 20).map((l, i) => {
      const nm = txt(l && l.name, 60); if (!nm) throw fail(400, 'Give layer ' + (i + 1) + ' of ' + name + ' a name.', 'layer');
      const key = /^L\d{1,3}$/.test(String(l.key || '')) ? l.key : '';
      const mm = num(l.mm); if (l.mm !== undefined && l.mm !== '' && l.mm !== null && !(mm >= 0 && mm <= 5000)) throw fail(400, 'The thickness of ' + nm + ' must be in mm (0 to 5000).', 'mm');
      if (seen[nm.toLowerCase()]) throw fail(400, name + ' has the layer "' + nm + '" twice.', 'layer'); seen[nm.toLowerCase()] = 1;
      return { key: key, name: nm, mm: mm === null || isNaN(mm) ? null : mm };
    });
    // every layer gets its own key (L1, L2 …) once – a key never changes, so the days done keep their layer
    // (keyFloor: the highest key any version of this work used – a new layer never takes the key of a layer taken out before)
    let next = layers.reduce((a, l) => Math.max(a, l.key ? Number(l.key.slice(1)) : 0), Number(keyFloor) || 0);
    const keys = {};
    layers.forEach(l => { if (!l.key || keys[l.key]) l.key = 'L' + (++next); keys[l.key] = 1; });
    return { name: name, unit: unit, sides: sides, strip: d.strip !== false, sort: sort === null || isNaN(sort) ? 100 : sort, layers: layers, note: txt(d.note, 300) };
  }
  if (kind === 'side') {
    const name = txt(d.name, 30); if (!name) throw fail(400, 'Pick the side (LHS, Median, RHS …).', 'name');
    const from = chain(d.from), to = chain(d.to), width = num(d.width);
    if (from === null || to === null || isNaN(from) || isNaN(to)) throw fail(400, 'Give the chainage from and to (e.g. 8+000 and 61+055).', 'ch');
    if (to <= from) throw fail(400, 'The chainage "to" must be after "from".', 'ch');
    if (road && (from < road.ch_from - 0.001 || to > road.ch_to + 0.001)) throw fail(400, 'The road runs from ' + showCh(road.ch_from) + ' to ' + showCh(road.ch_to) + ' – the stretch must be inside it.', 'ch');
    if (width === null || isNaN(width) || width <= 0 || width > 100) throw fail(400, 'Give the width in metres (e.g. 7.5).', 'width');
    return { name: name, from: from, to: to, width: width, note: txt(d.note, 300) };
  }
  // a mix design or a design: a name and its lines (what / how much / unit)
  const name = txt(d.name, 80); if (name.length < 2) throw fail(400, kind === 'mix' ? 'Give the mix design a name (e.g. PQC M40).' : 'Give the design a name (e.g. Dowel bar).', 'name');
  const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 40).map(r => ({ label: txt(r && r.label, 80), value: txt(r && r.value, 40), unit: txt(r && r.unit, 20) })).filter(r => r.label || r.value);
  rows.forEach((r, i) => { if (!r.label) throw fail(400, 'Line ' + (i + 1) + ': say what it is.', 'row'); });
  return kind === 'mix' ? { name: name, grade: txt(d.grade, 40), per: txt(d.per, 30) || 'per cum', rows: rows, note: txt(d.note, 300) } : { name: name, rows: rows, note: txt(d.note, 300) };
}
// the version of an item on a day (active or not – the caller decides); null when none covers that day
function versionOn(rows, kind, item, d) {
  let best = null;
  rows.forEach(r => { if (r.kind === kind && r.item === item && r.valid_from <= d && (!r.valid_to || r.valid_to >= d) && (!best || r.valid_from > best.valid_from)) best = r; });
  return best;
}
// every item of a kind as it stands on a day: { item: version } (active ones only unless all)
function itemsOn(rows, kind, d, all) {
  const out = {};
  [...new Set(rows.filter(r => r.kind === kind).map(r => r.item))].forEach(it => { const v = versionOn(rows, kind, it, d); if (v && (all || v.active)) out[it] = v; });
  return out;
}
const nextItem = (rows, kind) => KINDS[kind] + '-' + String(rows.filter(r => r.kind === kind).reduce((a, r) => Math.max(a, Number(String(r.item).split('-')[1]) || 0), 0) + 1).padStart(3, '0');

/* ---------- a person's plan and report ---------- */
const BOTH = 'Both';
const sidesOf = side => side === BOTH ? ['LHS', 'RHS'] : [side];
// the sides a line of this work may name: the work's own (when set), else the road's; "Both" when LHS and RHS are among them
function sidesFor(w, sideNames) {
  const L = (w && w.data.sides.length ? w.data.sides : sideNames || SIDE_NAMES).filter(x => x !== BOTH);
  return L.indexOf('LHS') > -1 && L.indexOf('RHS') > -1 ? L.concat([BOTH]) : L;
}
const qtyOf = (unit, from, to, qty) => unit === 'm' && from !== null && to !== null ? r3(Math.abs(to - from)) : qty;
// one line of chainage / quantity, checked against the work of that day
function cleanLine(x, w, road, i, what, d, sideNames) {
  const label = what + ' ' + (i + 1);
  const layer = String(x.layer || '');
  if (w.data.layers.length && !w.data.layers.some(l => l.key === layer)) throw fail(400, label + ': pick the layer of ' + w.data.name + '.', 'layer');
  if (!w.data.layers.length && layer) throw fail(400, label + ': ' + w.data.name + ' has no layers.', 'layer');
  // the side: one of the sides the work is done on (or of the road); "Both" = LHS and RHS at once (as BHS in the site's reports).
  // A work counted in Nos / sq m / cum may leave it empty (a culvert crosses the road).
  const side = txt(x.side, 30), allowed = sidesFor(w, sideNames);
  if (!side && w.data.unit === 'm') throw fail(400, label + ': pick the side (' + allowed.join(', ') + ').', 'side');
  if (side && allowed.indexOf(side) === -1) throw fail(400, label + ': ' + w.data.name + ' is done on ' + allowed.join(' / ') + ' – not on ' + side + '.', 'side');
  const from = chain(x.from), to = chain(x.to);
  if ((from !== null && isNaN(from)) || (to !== null && isNaN(to))) throw fail(400, label + ': write the chainage as 8+020 (km + metres).', 'ch');
  if ((from === null) !== (to === null)) throw fail(400, label + ': give both chainages – from and to.', 'ch');
  if (from !== null && to <= from) throw fail(400, label + ': the chainage "to" (' + showCh(to) + ') must be after "from" (' + showCh(from) + ').', 'ch');
  if (from !== null && road && (from < road.ch_from - 0.001 || to > road.ch_to + 0.001)) throw fail(400, label + ': the road runs from ' + showCh(road.ch_from) + ' to ' + showCh(road.ch_to) + '.', 'ch');
  if (w.data.unit === 'm' && from === null) throw fail(400, label + ': ' + w.data.name + ' is measured in metres – give the chainage from and to.', 'ch');
  let qty = num(x.qty);
  if (w.data.unit === 'm') qty = qtyOf('m', from, to, qty);
  else if (qty === null || isNaN(qty) || qty < 0 || qty > 1e7) throw fail(400, label + ': give the quantity (' + w.data.unit + ').', 'qty');
  return { work: w.item, layer: layer, side: side, from: from, to: to, qty: r3(qty) };
}
function cleanPlan(lines, ctx) {
  if (!Array.isArray(lines) || lines.length > 60) throw fail(400, 'A plan has 60 lines at most.', 'lines');
  const used = {};
  return lines.map((x, i) => {
    x = x || {};
    const w = ctx.works[String(x.work || '')];
    if (!w) throw fail(400, 'Line ' + (i + 1) + ': pick the work.', 'work');
    if (!ctx.mayWork(w.item)) throw fail(403, 'Line ' + (i + 1) + ': ' + w.data.name + ' is not given to you – the Super Admin gives the works.', 'assign');
    const ln = cleanLine(x, w, ctx.road, i, 'Line', ctx.day, ctx.sideNames);
    let id = /^p\d{1,4}$/.test(String(x.id || '')) && !used[x.id] ? x.id : '';
    if (!id) { let n = 1; while (used['p' + n] || (ctx.keep || []).indexOf('p' + n) > -1) n++; id = 'p' + n; }
    used[id] = 1;
    return Object.assign({ id: id }, ln, { note: txt(x.note, 300) });
  });
}
// the report of a day: every plan line once (done – or not – and why something is left), and the work outside the plan
function cleanReport(rep, plan, ctx) {
  rep = rep && typeof rep === 'object' ? rep : {};
  const got = {};
  (Array.isArray(rep.lines) ? rep.lines : []).forEach(x => { if (x && x.plan) got[x.plan] = x; });
  const lines = plan.map((p, i) => {
    const x = got[p.id] || { plan: p.id, none: true };
    const w = ctx.worksAll[p.work];
    if (!w) throw fail(400, 'Plan line ' + (i + 1) + ': its work is not set for ' + showDay(ctx.day) + ' any more – ask the Super Admin.', 'work');
    let ln;
    if (x.none || (x.from === '' && x.to === '' && (x.qty === '' || x.qty === undefined))) ln = { from: null, to: null, qty: 0 };
    else {
      const c = cleanLine(Object.assign({}, x, { work: p.work, layer: p.layer, side: x.side || p.side }), w, ctx.road, i, 'Plan line', ctx.day, ctx.sideNames);
      ln = { side: c.side, from: c.from, to: c.to, qty: c.qty };
    }
    const left = r3(Math.max(0, p.qty - ln.qty)), reason = txt(x.reason, 200);
    if (left > 0 && !reason) throw fail(400, 'Plan line ' + (i + 1) + ' (' + w.data.name + '): ' + (ln.qty ? 'not all of it was done' : 'nothing was done') + ' – say why.', 'reason');
    return Object.assign({ plan: p.id, side: p.side }, ln, { left: left, reason: reason });
  });
  if ((rep.extra || []).length > 40) throw fail(400, 'At most 40 lines of work outside the plan.', 'extra');
  const extra = (Array.isArray(rep.extra) ? rep.extra : []).map((x, i) => {
    x = x || {};
    const w = ctx.works[String(x.work || '')];
    if (!w) throw fail(400, 'Outside the plan, line ' + (i + 1) + ': pick the work.', 'work');
    if (!ctx.mayWork(w.item)) throw fail(403, 'Outside the plan, line ' + (i + 1) + ': ' + w.data.name + ' is not given to you.', 'assign');
    const c = cleanLine(x, w, ctx.road, i, 'Outside the plan, line', ctx.day, ctx.sideNames);
    return Object.assign({ id: 'x' + (i + 1) }, c, { reason: txt(x.reason, 200) });
  });
  return { lines: lines, extra: extra, note: txt(rep.note, 500) };
}
// the reasons of a report (for the list suggested to the others)
const reasonsOf = rep => !rep ? [] : [...rep.lines.map(l => l.reason), ...rep.extra.map(l => l.reason)].map(r => txt(r, 200)).filter(Boolean);
const reasonKey = r => txt(r, 200).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

/* ---------- the figures ---------- */
// a day's lines: planned and done, per work (and layer / side) – for the dashboard, the reports and the grid
function dayFigures(doc) {
  const plan = doc.plan || [], rep = doc.report, out = [];
  plan.forEach(p => {
    const r = rep && rep.lines.find(x => x.plan === p.id);
    out.push({ email: doc.email, name: doc.name, day: doc.day, work: p.work, layer: p.layer, side: p.side, pFrom: p.from, pTo: p.to, planned: p.qty, from: r ? r.from : null, to: r ? r.to : null, done: r ? r.qty : 0, left: r ? r.left : p.qty, reason: r ? r.reason : '', reported: !!rep, outside: false });
  });
  if (rep) rep.extra.forEach(x => out.push({ email: doc.email, name: doc.name, day: doc.day, work: x.work, layer: x.layer, side: x.side, pFrom: null, pTo: null, planned: 0, from: x.from, to: x.to, done: x.qty, left: 0, reason: x.reason, reported: true, outside: true }));
  return out;
}
// the status of a work on a day, as the dashboard says it
function statusOf(planned, done, reported) {
  if (!reported) return 'No report';
  if (planned <= 0) return done > 0 ? 'Outside the plan' : 'Nothing planned';
  if (done <= 0) return 'Not done';
  if (done > planned + 0.001) return 'More than planned';
  if (done >= planned - 0.001) return 'As planned';
  return 'Partly done';
}
const pct = (done, planned) => planned > 0 ? Math.round(done / planned * 100) : (done > 0 ? 100 : 0);
// a report sent after 9 in the morning of the next day is late (the hourly reminder starts then)
const lateOf = (d, at) => !!at && new Date(Date.parse(at) + IST).toISOString().slice(0, 16) > addDays(d, 1) + 'T09:00';

/* the strip chart: on each side, which places are finished in which layer (as on a day). Intervals per side and layer are joined
 * (one place done twice counts once); the highest layer at a place is the one of the work with the higher order (and the later
 * layer inside it). */
function union(iv) {
  const s = iv.filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]), out = [];
  s.forEach(x => { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 0.001) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); });
  return out;
}
const lenOf = iv => r3(iv.reduce((a, x) => a + (x[1] - x[0]), 0));
function layerList(works) {
  const L = [];
  Object.keys(works).map(k => works[k]).filter(w => w.data.strip && w.data.unit === 'm').sort((a, b) => a.data.sort - b.data.sort || a.item.localeCompare(b.item)).forEach(w => {
    (w.data.layers.length ? w.data.layers : [{ key: '', name: w.data.name }]).forEach(l => L.push({ id: w.item + '|' + l.key, work: w.item, layer: l.key, name: w.data.layers.length ? w.data.name + ' · ' + l.name : w.data.name, workName: w.data.name }));
  });
  return L.map((x, i) => Object.assign(x, { rank: i + 1 }));
}
// the part of a set of intervals inside another set (both joined)
function within(iv, by) {
  const out = [];
  union(iv).forEach(a => union(by).forEach(b => { const x = Math.max(a[0], b[0]), y = Math.min(a[1], b[1]); if (y > x) out.push([x, y]); }));
  return union(out);
}
// the done places of the reports: side → layer id → intervals ("Both" counts on LHS and on RHS)
function doneBy(docs, rank, test) {
  const by = {};
  docs.forEach(d => { if (!d.report || !test(d.day)) return; dayFigures(d).forEach(f => {
    if (f.from === null || f.to === null || !f.done) return;
    const id = f.work + '|' + (f.layer || ''); if (!rank[id]) return;
    sidesOf(f.side).forEach(sd => { ((by[sd] = by[sd] || {})[id] = by[sd][id] || []).push([Math.min(f.from, f.to), Math.max(f.from, f.to)]); });
  }); });
  return by;
}
/* sides: [{ name, iv }] – iv: the stretches of that side (its length for the per cent; null = not set: not clipped) */
function strip(docs, works, sides, upto) {
  const layers = layerList(works), rank = {}; layers.forEach(l => { rank[l.id] = l.rank; });
  const by = doneBy(docs, rank, d => d <= upto), out = {};
  sides.forEach(sd => {
    const per = by[sd.name] || {}, U = {};
    Object.keys(per).forEach(id => { U[id] = sd.iv ? within(per[id], sd.iv) : union(per[id]); });
    const cuts = [...new Set([].concat(...Object.keys(U).map(id => [].concat(...U[id]))))].sort((a, b) => a - b), pieces = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
      let top = null; Object.keys(U).forEach(id => { if (U[id].some(x => x[0] <= mid && mid <= x[1]) && (!top || rank[id] > rank[top])) top = id; });
      if (!top) continue;
      const l = pieces[pieces.length - 1]; if (l && l.layer === top && Math.abs(l.to - a) < 0.001) l.to = b; else pieces.push({ from: r3(a), to: r3(b), layer: top });
    }
    pieces.forEach(x => { x.to = r3(x.to); });
    out[sd.name] = { pieces: pieces, done: Object.keys(U).reduce((o, id) => { o[id] = lenOf(U[id]); return o; }, {}), length: sd.iv ? lenOf(union(sd.iv)) : null };
  });
  return { layers: layers, sides: out };
}

module.exports = { today, hourIST, day, addDays, daysBetween, showDay, chain, showCh, r2, r3, KINDS, UNITS, SIDE_NAMES, txt, num, cleanData, versionOn, itemsOn, nextItem,
  qtyOf, cleanLine, cleanPlan, cleanReport, reasonsOf, reasonKey, dayFigures, statusOf, pct, lateOf, union, within, lenOf, layerList, strip, BOTH, sidesOf, sidesFor };
