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
  const label = i === null ? what : what + ' ' + (i + 1);      // (09-11-2026) i = null: one line on its own (an RFI)
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

/* ---------- (09-11-2026, Engineering 2A) THE IE'S APPROVAL OF A LAYER (RFI) – his answer: "the next layer is stopped until the IE
 * approves the layer below" (the Super Admin can let it through, with a reason) ----------
 * The layer BELOW a layer on a side: the nearest lower layer of the strip chart's order (the order of the works, then the layers)
 * whose work is done on that side. A line of a layer is refused on the stretch where the layer below was REPORTED DONE (in the ERP,
 * from the day the rule is on) and no APPROVED RFI covers it. Where the layer below was never reported (the progress before the ERP,
 * or before the rule's day) nothing is stopped. */
const onSide = (w, sd) => !w.data.sides.length || w.data.sides.indexOf(sd) > -1 || (w.data.sides.indexOf(BOTH) > -1 && (sd === 'LHS' || sd === 'RHS'));
function layerBelow(works, id, sd) {
  const L = layerList(works), i = L.findIndex(l => l.id === id);
  for (let j = i - 1; i > 0 && j >= 0; j--) if (onSide(works[L[j].work], sd)) return L[j];
  return null;
}
// the parts of a set of intervals not covered by another set
function minus(a, b) {
  let cur = union(a);
  union(b).forEach(x => { const nx = []; cur.forEach(y => { if (x[1] <= y[0] || x[0] >= y[1]) { nx.push(y); return; } if (x[0] > y[0]) nx.push([y[0], x[0]]); if (x[1] < y[1]) nx.push([x[1], y[1]]); }); cur = nx; });
  return cur.filter(x => x[1] - x[0] > 0.001).map(x => [r3(x[0]), r3(x[1])]);
}
// the approved stretches: side → layer id → intervals (an RFI on "Both" counts on LHS and on RHS)
function approvedBy(rfis) {
  const by = {};
  (rfis || []).forEach(r => { if (r.status !== 'Approved' || r.ch_from === null || r.ch_to === null || r.ch_from === undefined) return;
    const id = r.work + '|' + (r.layer || ''), a = Number(r.ch_from), b = Number(r.ch_to);
    sidesOf(r.side).forEach(sd => { ((by[sd] = by[sd] || {})[id] = by[sd][id] || []).push([Math.min(a, b), Math.max(a, b)]); }); });
  return by;
}
/* the lines (of a plan or a report) that the rule stops: [{ i, side, below: { id, name }, miss: [[from, to] …] }] – done: side → layer
 * id → intervals reported done (doneBy, from the rule's day); ok: approvedBy(the site's RFIs). A gap of less than half a metre is
 * not counted (the chainage is written to the metre). */
function rfiBlocks(lines, works, done, ok) {
  const out = [];
  (lines || []).forEach((ln, i) => {
    if (!ln || ln.from === null || ln.to === null || ln.from === undefined) return;
    const id = ln.work + '|' + (ln.layer || '');
    sidesOf(ln.side).forEach(sd => {
      const b = layerBelow(works, id, sd); if (!b) return;
      const d = within(((done[sd] || {})[b.id]) || [], [[Math.min(ln.from, ln.to), Math.max(ln.from, ln.to)]]);
      const miss = minus(d, ((ok[sd] || {})[b.id]) || []);
      if (lenOf(miss) >= 0.5) out.push({ i: i, side: sd, below: { id: b.id, name: b.name }, miss: miss });
    });
  });
  return out;
}
// what the person is told (the first three stretches; the rest counted)
function rfiSay(blocks, what) {
  return blocks.slice(0, 3).map(b => what + ' ' + (b.i + 1) + ' (' + b.side + '): ' + b.below.name + ' is not approved by the IE on ' + b.miss.slice(0, 3).map(x => showCh(x[0]) + '–' + showCh(x[1])).join(', ') + (b.miss.length > 3 ? ' and ' + (b.miss.length - 3) + ' more' : '')).join('; ')
    + (blocks.length > 3 ? '; and ' + (blocks.length - 3) + ' more' : '') + '. Its RFI must be approved first (RFI page) – or the Super Admin lets it through with a reason.';
}
// an RFI asked: a stretch of one layer on one side (or a quantity, for a work not in metres), checked as a plan line
function cleanRfi(x, w, road, sideNames) {
  const ln = cleanLine(x, w, road, null, 'The RFI', null, sideNames);
  return Object.assign(ln, { note: txt(x.note, 300) });
}
// the IE's answer, recorded
function cleanDecision(x, t) {
  const st = x.status === 'Approved' || x.status === 'Rejected' ? x.status : '';
  if (!st) throw fail(400, 'Say whether the IE approved or rejected it.', 'status');
  const d = day(x.ie_day, 'the IE\'s answer');
  if (d > t) throw fail(400, 'The day of the IE\'s answer cannot be after today.', 'date');
  const remark = txt(x.ie_remark, 300);
  if (st === 'Rejected' && remark.length < 3) throw fail(400, 'Write why the IE rejected it.', 'remark');
  return { status: st, ie_day: d, ie_name: txt(x.ie_name, 80), ie_ref: txt(x.ie_ref, 60), ie_remark: remark };
}
/* a hindrance: from / to (empty = still on), the stretch (empty = the whole road), the side (empty = every side), the works it stops
 * (empty = every work), what it is (typed – what others typed is suggested), detail, the letter */
function cleanHindrance(x, ctx) {
  const from = day(x.from_day, 'from'), to = x.to_day ? day(x.to_day, 'to') : null;
  if (from > ctx.today) throw fail(400, 'A hindrance starts today or a day before.', 'date');
  if (to && to < from) throw fail(400, '"To" must be on or after "from".', 'date');
  if (to && to > ctx.today) throw fail(400, 'The day it ended cannot be after today – leave "to" empty while it is still on.', 'date');
  const a = chain(x.ch_from), b = chain(x.ch_to);
  if ((a !== null && isNaN(a)) || (b !== null && isNaN(b))) throw fail(400, 'Write the chainage as 8+020 (km + metres).', 'ch');
  if ((a === null) !== (b === null)) throw fail(400, 'Give both chainages – from and to (or neither, for the whole road).', 'ch');
  if (a !== null && b <= a) throw fail(400, 'The chainage "to" must be after "from".', 'ch');
  if (a !== null && ctx.road && (a < ctx.road.ch_from - 0.001 || b > ctx.road.ch_to + 0.001)) throw fail(400, 'The road runs from ' + showCh(ctx.road.ch_from) + ' to ' + showCh(ctx.road.ch_to) + '.', 'ch');
  const side = txt(x.side, 30), sides = (ctx.sideNames || SIDE_NAMES).concat([BOTH]);
  if (side && sides.indexOf(side) < 0) throw fail(400, 'Pick the side (' + sides.join(', ') + '), or leave it empty for every side.', 'side');
  const works = [...new Set((Array.isArray(x.works) ? x.works : []).map(v => txt(v, 20)).filter(Boolean))].slice(0, 30);
  works.forEach(v => { if (!ctx.works[v]) throw fail(400, 'Pick the works it stops from the list (or none, for every work).', 'works'); });
  const kind = txt(x.kind, 80); if (kind.length < 2) throw fail(400, 'Say what the hindrance is (e.g. land not handed over, utility shifting, rain).', 'kind');
  return { from_day: from, to_day: to, ch_from: a, ch_to: b, side: side, works: works, kind: kind, detail: txt(x.detail, 500), letter: txt(x.letter, 80) };
}
// the days of a hindrance inside a period (both ends counted; still on = up to "upto")
function hindDays(h, from, to, upto) {
  const a = h.from_day > from ? h.from_day : from, end = h.to_day || upto, b = end < to ? end : to;
  return b >= a ? daysBetween(a, b) + 1 : 0;
}
/* PPC – PLANNED WORK DONE (the "per cent of the plan complete"): of the plan lines of the reported days, how many were done as planned
 * (all of it – or more). A line counts once whatever its unit. */
function ppcOf(docs) {
  let lines = 0, done = 0;
  (docs || []).forEach(d => { if (!d.report) return; dayFigures(d).forEach(f => { if (f.outside || !(f.planned > 0)) return; lines++; if (f.done >= f.planned - 0.001) done++; }); });
  return { lines: lines, done: done, pct: lines ? Math.round(done / lines * 100) : null };
}

/* ---------- (10-11-2026, Engineering 2B) THE MEASUREMENT BOOK – his choice: "Measurement Book – पूर्ण झालेल्या layer चे काम आपोआप
 * (chainage × रुंदी × जाडी) → MB (मोजले / तपासले) → RA bill साठी" ----------
 * The quantity of what was REPORTED DONE, worked out with the masters of the DAY it was done (a day is always measured with the
 * version of that day):
 *   a work in metres:  length (chainage) × width (the side's width at that place on that day) × thickness (the layer's mm on that
 *                      day) → cum; a layer with no thickness set: length × width → sq m; no width set for that side there: the length → m
 *   a work in sq m, cum or Nos: the quantity the person reported, as one line (the masters hold no width / thickness of its own for it)
 * "Both" = LHS + RHS: a work in metres gives a line on each side, each with its own width; a reported quantity stays one line.
 * A stretch already in the MB (the same work, layer and side, overlapping chainage) is never offered again – nor a report line
 * without chainage already in it; two reports of the same stretch: the earlier day's is offered, the later one only where it goes
 * beyond ("reported twice"); a reported quantity with chainage is never split – it is offered whole or not at all. E1 (the RFI, 09-11-2026): with the RFI rule on from a day, a stretch done from that day that no approved RFI of the same
 * layer covers is "Not approved by the IE" – not finished, so not measured (the Super Admin may, with a reason). */
// the lines a report says were done (quantity > 0), with their own id: p1 … (a plan line), x1 … (outside the plan)
function doneLines(doc) {
  const plan = doc.plan || [], rep = doc.report, out = [];
  if (!rep) return out;
  (rep.lines || []).forEach(l => { const p = plan.find(y => y.id === l.plan); if (!p || !(l.qty > 0)) return; out.push({ id: p.id, work: p.work, layer: p.layer || '', side: l.side || p.side || '', from: l.from, to: l.to, qty: l.qty, outside: false }); });
  (rep.extra || []).forEach(x => { if (!(x.qty > 0)) return; out.push({ id: x.id, work: x.work, layer: x.layer || '', side: x.side || '', from: x.from, to: x.to, qty: x.qty, outside: true }); });
  return out;
}
// the width of one side along a stretch, as set for that day (that day's version of the side's stretches): [{ from, to, width | null }]
function widthPieces(masters, side, d, a, b) {
  const on = itemsOn(masters, 'side', d), v = Object.keys(on).map(k => on[k]).filter(x => x.data.name === side).sort((x, y) => x.data.from - y.data.from);
  const out = [], put = (f, t, w) => { const l = out[out.length - 1]; if (l && l.width === w && Math.abs(l.to - f) < 0.0005) l.to = t; else out.push({ from: f, to: t, width: w }); };
  let at = a;
  v.forEach(x => { const f = Math.max(at, x.data.from), t = Math.min(b, x.data.to); if (t - f < 0.0005) return; if (f > at + 0.0005) put(at, f, null); put(f, t, Number(x.data.width)); at = t; });
  if (b > at + 0.0005) put(at, b, null);
  return out.map(p => ({ from: r3(p.from), to: r3(p.to), width: p.width }));
}
// the quantity of a line: unit of the work, length (m), width (m), thickness (mm), the reported quantity
function mbQty(unit, len, w, mm, rep) {
  if (unit !== 'm' || len === null || len === undefined) return { qty: r3(Number(rep) || 0), unit: unit, how: 'reported' };
  if (w > 0 && mm > 0) return { qty: r3(len * w * mm / 1000), unit: 'cum', how: 'LxWxT' };
  if (w > 0) return { qty: r3(len * w), unit: 'sq m', how: 'LxW' };
  return { qty: r3(len), unit: 'm', how: 'L' };
}
// the sides a line is in the way of: its own; "Both" is LHS and RHS
const mbSides = side => side === BOTH ? ['LHS', 'RHS'] : [side || ''];
/* the lines offered for an MB page: o = { docs (the reports of the period), masters, work, layer, sides (null = every side),
 *   claimed (the lines of the OTHER MB pages of this work and layer: { side, from, to, src }), rfis (the APPROVED RFIs of this work and
 *   layer), rule ({ on, from } or null), mine (the page's own lines, when it is changed) } → { lines, skipped, gone } */
function mbOffer(o) {
  // cl: what the other MB pages hold; of: what is offered above (an earlier report of the same stretch) – side → intervals
  const lines = [], skipped = [], cl = {}, of = {}, srcs = new Set(), id = o.work + '|' + (o.layer || '');
  const take = (T, side, a, b) => mbSides(side).forEach(sd => (T[sd] = T[sd] || []).push([a, b]));
  const ivOf = (T, side) => [].concat(...mbSides(side).map(sd => T[sd] || []));
  (o.claimed || []).forEach(c => { if (c.from === null || c.from === undefined) srcs.add(c.src); else take(cl, c.side, Number(c.from), Number(c.to)); });
  const rfis = (o.rfis || []).filter(r => r.status === 'Approved' && r.work === o.work && (r.layer || '') === (o.layer || '')), ok = approvedBy(rfis);
  const rfiNos = (sd, a, b) => a === null ? [] : rfis.filter(r => r.ch_from !== null && r.ch_from !== undefined && mbSides(r.side).some(x => mbSides(sd).indexOf(x) > -1) && Math.min(b, Number(r.ch_to)) - Math.max(a, Number(r.ch_from)) > 0.001).map(r => r.no);
  const okIv = sd => [].concat(...mbSides(sd).map(x => ((ok[x] || {})[id]) || []));
  const want = sd => !o.sides || (sd ? mbSides(sd).some(x => o.sides.indexOf(x) > -1) || o.sides.indexOf(sd) > -1 : false);
  const docs = (o.docs || []).filter(d => d.report).slice().sort((a, b) => a.day.localeCompare(b.day) || String(a.email).localeCompare(String(b.email)));
  docs.forEach(doc => doneLines(doc).filter(l => l.work === o.work && (l.layer || '') === (o.layer || '')).forEach(ln => {
    const v = versionOn(o.masters, 'work', o.work, doc.day), unit = v ? v.data.unit : 'm', lay = v && v.data.layers.find(l => l.key === ln.layer), mm = lay && lay.mm > 0 ? Number(lay.mm) : null;
    const src = doc.day + '|' + doc.email + '|' + ln.id, ruleOn = !!(o.rule && o.rule.on && o.rule.from && doc.day >= o.rule.from);
    const base = { src: src, day: doc.day, email: doc.email, name: doc.name || doc.email, line: ln.id, outside: ln.outside, rep: ln.qty };
    const hasCh = ln.from !== null && ln.from !== undefined && ln.to !== null && ln.to !== undefined;
    const a = hasCh ? Math.min(ln.from, ln.to) : null, b = hasCh ? Math.max(ln.from, ln.to) : null;
    if (unit === 'm' && hasCh) {
      sidesOf(ln.side).forEach(sd => {
        // (a side not asked for is still worked through – what it takes is taken for the next lines, as when every side is asked)
        const show = want(sd), free0 = minus([[a, b]], cl[sd] || []), free = minus(free0, of[sd] || []), inMb = r3((b - a) - lenOf(free0)), twice = r3(lenOf(free0) - lenOf(free));
        if (show && inMb >= 0.001) skipped.push(Object.assign({}, base, { side: sd, from: a, to: b, len: inMb, why: 'in the MB' }));
        if (show && twice >= 0.001) skipped.push(Object.assign({}, base, { side: sd, from: a, to: b, len: twice, why: 'reported twice' }));
        free.forEach(f => {
          widthPieces(o.masters, sd, doc.day, f[0], f[1]).forEach(wp => {
            let parts = [{ from: wp.from, to: wp.to, appr: 'off' }];
            if (ruleOn) {
              const no = minus([[wp.from, wp.to]], okIv(sd));
              parts = lenOf(no) < 0.5 ? [{ from: wp.from, to: wp.to, appr: 'yes' }]
                : within([[wp.from, wp.to]], okIv(sd)).map(x => ({ from: r3(x[0]), to: r3(x[1]), appr: 'yes' })).concat(no.map(x => ({ from: x[0], to: x[1], appr: 'no' }))).filter(x => x.to - x.from >= 0.001).sort((x, y) => x.from - y.from);
            }
            parts.forEach(p => {
              const len = r3(p.to - p.from), q = mbQty('m', len, wp.width, mm);
              if (show) lines.push(Object.assign({ key: src + '|' + sd + '|' + p.from + '|' + p.to }, base, { side: sd, from: p.from, to: p.to, len: len, w_m: wp.width, mm_m: mm, qty: q.qty, unit: q.unit, how: q.how, appr: p.appr, rfi: rfiNos(sd, p.from, p.to) }));
            });
          });
          take(of, sd, f[0], f[1]);
        });
      });
      return;
    }
    // a reported quantity (a work in sq m, cum or Nos): one line, never split
    const side = ln.side || '', show = want(side);
    if (hasCh) {
      const why = lenOf(within([[a, b]], ivOf(cl, side))) >= 0.5 ? 'in the MB' : lenOf(within([[a, b]], ivOf(of, side))) >= 0.5 ? 'reported twice' : '';
      if (why) { if (show) skipped.push(Object.assign({}, base, { side: side, from: a, to: b, len: r3(b - a), why: why })); return; }
      take(of, side, a, b);
    } else {
      if (srcs.has(src)) { if (show) skipped.push(Object.assign({}, base, { side: side, from: null, to: null, len: null, why: 'in the MB' })); return; }
      srcs.add(src);
    }
    if (!show) return;
    const appr = hasCh && ruleOn ? (mbSides(side).every(sd => lenOf(minus([[a, b]], ((ok[sd] || {})[id]) || [])) < 0.5) ? 'yes' : 'no') : 'off';
    lines.push(Object.assign({ key: src + '|' + side }, base, { side: side, from: a, to: b, len: hasCh ? r3(b - a) : null, w_m: null, mm_m: null, qty: r3(ln.qty), unit: unit, how: 'reported', appr: appr, rfi: hasCh ? rfiNos(side, a, b) : [] }));
  }));
  const keys = new Set(lines.map(l => l.key)), gone = (o.mine || []).filter(l => !keys.has(l.key));
  return { lines: lines, skipped: skipped, gone: gone };
}
// one line of an MB page as measured: the offered line, the width / thickness actually measured (only where the quantity is worked
// out: a work in metres) – a remark when it differs from the masters; a line not approved by the IE: only the Super Admin, with a reason
function mbLine(off, x, sup, n) {
  x = x || {};
  const label = 'Line ' + n + ' (' + (off.side || '–') + (off.from !== null && off.from !== undefined ? ' ' + showCh(off.from) + '–' + showCh(off.to) : '') + ')';
  let skip = '';
  if (off.appr === 'no') {
    if (!sup) throw fail(400, label + ': not approved by the IE – the layer is not finished (E1), so it is not measured. Its RFI must be approved first (RFI page) – or the Super Admin measures it with a reason.', 'notapproved');
    skip = txt(x.skip, 200);
    if (skip.length < 3) throw fail(400, label + ': not approved by the IE – write why it is measured anyway.', 'notapproved');
  }
  let w = off.w_m === undefined ? null : off.w_m, mm = off.mm_m === undefined ? null : off.mm_m;
  if (off.how !== 'reported') {
    const wv = num(x.w), mv = num(x.mm);
    if (wv !== null) { if (isNaN(wv) || wv <= 0 || wv > 100) throw fail(400, label + ': the width is in metres – more than 0, at most 100.', 'width'); w = r3(wv); }
    if (mv !== null) { if (isNaN(mv) || mv <= 0 || mv > 5000) throw fail(400, label + ': the thickness is in mm – more than 0, at most 5000.', 'mm'); mm = r3(mv); }
  }
  const remark = txt(x.remark, 200);
  if (off.how !== 'reported' && (w !== off.w_m || mm !== off.mm_m) && remark.length < 3)
    throw fail(400, label + ': the ' + (w !== off.w_m ? 'width' : 'thickness') + ' differs from the masters (' + (w !== off.w_m ? (off.w_m === null ? 'not set' : off.w_m + ' m') : (off.mm_m === null ? 'not set' : off.mm_m + ' mm')) + ') – write a remark: what was measured on site.', 'remark');
  const q = off.how === 'reported' ? { qty: off.qty, unit: off.unit, how: 'reported' } : mbQty('m', off.len, w, mm);
  return { ln: n, key: off.key, src: off.src, day: off.day, email: off.email, name: off.name, line: off.line, outside: !!off.outside, side: off.side, from: off.from, to: off.to, len: off.len,
    w_m: off.w_m, mm_m: off.mm_m, w: w, mm: mm, qty: q.qty, unit: q.unit, how: q.how, rep: off.rep, appr: off.appr, rfi: off.rfi || [], skip: skip, remark: remark };
}
const MB_UNITS = ['cum', 'sq m', 'm', 'Nos'];
// the quantity of a page, unit by unit
function mbTotals(lines) {
  const t = {}, ord = u => { const i = MB_UNITS.indexOf(u); return i < 0 ? 9 : i; };
  (lines || []).forEach(l => { t[l.unit] = (t[l.unit] || 0) + Number(l.qty || 0); });
  return Object.keys(t).sort((a, b) => ord(a) - ord(b)).map(u => ({ unit: u, qty: r3(t[u]) }));
}
/* the ABSTRACT for the RA bill: per work, layer and unit, the CHECK-MEASURED quantity of the period (by the MB page's date), up to the
 * previous period (before "from") and cumulative (up to "to"); a page only measured or sent back is not counted */
function mbAbstract(pages, from, to) {
  const G = {};
  (pages || []).forEach(p => { if (p.status !== 'Check-measured' || p.mb_day > to) return; const k2 = p.mb_day < from ? 'prev' : 'now';
    (p.lines || []).forEach(l => { const k = p.work + '|' + (p.layer || '') + '|' + l.unit, g = G[k] = G[k] || { work: p.work, layer: p.layer || '', unit: l.unit, prev: 0, now: 0, cum: 0, pages: [] };
      g[k2] += Number(l.qty || 0); if (k2 === 'now' && g.pages.indexOf(p.no) < 0) g.pages.push(p.no); }); });
  return Object.keys(G).map(k => { const g = G[k]; g.prev = r3(g.prev); g.now = r3(g.now); g.cum = r3(g.prev + g.now); g.pages.sort(); return g; });
}

module.exports = { doneLines, widthPieces, mbQty, mbSides, mbOffer, mbLine, mbTotals, mbAbstract, MB_UNITS,
  layerBelow, minus, approvedBy, rfiBlocks, rfiSay, cleanRfi, cleanDecision, cleanHindrance, hindDays, ppcOf, doneBy, onSide,
  today, hourIST, day, addDays, daysBetween, showDay, chain, showCh, r2, r3, KINDS, UNITS, SIDE_NAMES, txt, num, cleanData, versionOn, itemsOn, nextItem,
  qtyOf, cleanLine, cleanPlan, cleanReport, reasonsOf, reasonKey, dayFigures, statusOf, pct, lateOf, union, within, lenOf, layerList, strip, BOTH, sidesOf, sidesFor };
