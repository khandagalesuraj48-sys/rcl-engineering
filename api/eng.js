/* POST /api/eng { action, … } – every action of Engineering. The sign-in (cookie) says who, which site and which role:
 *   super – the Super Admin: sets Engineering up (road, sides, works and layers, mix designs, designs, who does which work) and
 *           may change any plan or report;
 *   admin – sees the progress and the performance of the site (dashboard, all reports, reports, performance);
 *   user  – makes his own plan, reports his own work, and sees the strip chart.
 * Every check is here, on the server; lib/rules.js holds the rules themselves. Dates are days in India. A report is of a WORK
 * DAY (what was done that day, sent the next morning); the dashboard of a day shows the work of the day before it and that
 * day's program – as in the site's daily report. */
'use strict';
const { handler, readBody, send, sameSite, fail, sendKept } = require('../lib/http');
const { db, enc } = require('../lib/db');
const ses = require('../lib/session');
const { activity } = require('../lib/activity');
const R = require('../lib/rules');

const isSuper = s => s.role === 'super';
const canView = s => s.role === 'super' || s.role === 'admin';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const needSuper = s => { if (!isSuper(s)) throw fail(403, 'Only the Super Admin sets up Engineering.', 'access'); };
const needView = s => { if (!canView(s)) throw fail(403, 'This page is for the Admin and the Super Admin.', 'access'); };
const nowIso = () => new Date().toISOString();
const istDay = ts => ts ? R.today(Date.parse(ts)) : '';
const DOC = 'day,email,name,plan,plan_at,plan_by,report,report_at,report_by,edited_at,edited_by,edits,ver';

// every row of a query, 1000 at a time (the database gives at most 1000 in one answer)
async function all(path) {
  const out = [];
  for (let off = 0; off < 500000; off += 1000) {
    const r = (await db('GET', path + '&limit=1000&offset=' + off)) || [];
    out.push(...r); if (r.length < 1000) break;
  }
  return out;
}
// what the site has set up (small): the versions of every master, the road, who does which work, the people
async function ctxOf(site) {
  const s = enc(site);
  const [masters, roads, assign, people] = await Promise.all([
    all('eng_masters?select=id,kind,item,data,valid_from,valid_to,active,created_by,created_at,updated_by,updated_at&site=eq.' + s + '&order=id'),
    db('GET', 'eng_roads?select=code,name,ch_from,ch_to,source,updated_by,updated_at&site=eq.' + s + '&code=eq.MAIN'),
    all('eng_assign?select=email,work,active,created_by,created_at,updated_by,updated_at&site=eq.' + s + '&order=email,work'),
    all('eng_people?select=email,name,role,added_by,first_seen,last_seen&site=eq.' + s + '&order=email')]);
  const road = (roads || [])[0] || null;
  if (road) { road.ch_from = Number(road.ch_from); road.ch_to = Number(road.ch_to); }
  masters.forEach(m => { m.id = Number(m.id); });
  return { site: site, masters: masters, road: road, assign: assign, people: people };
}
// the sides of the road on a day: their names (LHS, Median, RHS first) and the stretches of each
function sidesOn(C, d) {
  const on = R.itemsOn(C.masters, 'side', d), v = Object.keys(on).map(k => on[k]);
  const order = n => { const i = R.SIDE_NAMES.indexOf(n); return i < 0 ? 9 : i; };
  let names = [...new Set(v.map(x => x.data.name))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const set = names.length > 0;
  if (!set) names = R.SIDE_NAMES.slice();
  const road = C.road ? [[C.road.ch_from, C.road.ch_to]] : null;
  return { set: set, names: names, list: names.map(n => ({ name: n, iv: set ? v.filter(x => x.data.name === n).map(x => [x.data.from, x.data.to]) : road })) };
}
// a person was given a work on a day (the date it was given; still given, or taken back after that day)
const assignedOn = (a, d) => istDay(a.created_at) <= d && (a.active || istDay(a.updated_at) > d);
// what a plan or a report of a day is checked against
function dayCtx(C, d, s, email) {
  const mine = new Set(C.assign.filter(a => a.email === email && a.active).map(a => a.work));
  return { day: d, road: C.road, works: R.itemsOn(C.masters, 'work', d), worksAll: R.itemsOn(C.masters, 'work', d, true),
    sideNames: sidesOn(C, d).names, mayWork: w => isSuper(s) || mine.has(w) };
}
// whose day: one's own; another person's only for the Super Admin (to change), and the Admin (to look at)
function whoFor(s, C, email, look) {
  email = String(email || s.email).trim().toLowerCase();
  if (email === s.email) return { email: email, name: s.name };
  if (!(isSuper(s) || (look && canView(s)))) throw fail(403, 'Only the person himself or the Super Admin can change his plan or report.', 'access');
  const p = C.people.find(x => x.email === email);
  if (!p) throw fail(404, 'This person is not on the Engineering list of this site.', 'person');
  return { email: email, name: p.name || email };
}
const docs = (site, from, to, extra) => all('eng_days?select=' + DOC + '&site=eq.' + enc(site) + '&day=gte.' + from + '&day=lte.' + to + (extra || '') + '&order=day,email');
async function docOf(site, d, email) { return ((await db('GET', 'eng_days?select=' + DOC + ',history&site=eq.' + enc(site) + '&day=eq.' + d + '&email=eq.' + enc(email))) || [])[0] || null; }
const CHANGED = 'This day was changed meanwhile (on another phone, or by the Super Admin) – it is loaded again: check it and save once more.';
// one person's day is written only over the version that was read (two phones never overwrite each other)
async function writeDoc(site, d, email, old, ver, patch) {
  if ((old ? Number(old.ver) : 0) !== Number(ver || 0)) throw fail(409, CHANGED, 'changed');
  if (!old) {
    try { return ((await db('POST', 'eng_days', [Object.assign({ site: site, day: d, email: email, ver: 1 }, patch)], 'return=representation')) || [])[0]; }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, CHANGED, 'changed'); throw e; }
  }
  const r = await db('PATCH', 'eng_days?site=eq.' + enc(site) + '&day=eq.' + d + '&email=eq.' + enc(email) + '&ver=eq.' + Number(old.ver), Object.assign({}, patch, { ver: Number(old.ver) + 1 }), 'return=representation');
  if (!r || !r.length) throw fail(409, CHANGED, 'changed');
  return r[0];
}
function span(x, most) {
  const from = R.day(x.from, 'from'), to = R.day(x.to, 'to');
  if (to < from) throw fail(400, '"To" must be on or after "from".', 'date');
  if (R.daysBetween(from, to) + 1 > most) throw fail(400, 'Pick at most ' + most + ' days.', 'date');
  return { from: from, to: to };
}
const daysOf = (from, to) => { const out = []; for (let d = from; d <= to; d = R.addDays(d, 1)) out.push(d); return out; };
const nameOf = (C, email, fallback) => { const p = C.people.find(x => x.email === email); return (p && p.name) || fallback || email; };

/* ---------- the figures of one work day, work by work ---------- */
function perWork(C, dayDocs, d) {
  const out = {};
  const get = w => out[w] = out[w] || { work: w, planned: 0, done: 0, outside: 0, lines: [], senders: {}, missing: {} };
  dayDocs.forEach(doc => {
    R.dayFigures(doc).forEach(f => {
      const o = get(f.work); o.lines.push(f);
      if (f.outside) o.outside += f.done; else { o.planned += f.planned; o.done += f.done; }
      if (doc.report) o.senders[doc.email] = { email: doc.email, name: doc.name || nameOf(C, doc.email), at: doc.report_at, by: doc.report_by, edits: doc.edits || 0, late: R.lateOf(d, doc.report_at) };
      else o.missing[doc.email] = { email: doc.email, name: doc.name || nameOf(C, doc.email) };
    });
  });
  // a person given a work who sent no report of that day at all (with or without a plan): his report is missing for that work
  C.assign.filter(a => assignedOn(a, d)).forEach(a => {
    const doc = dayDocs.find(x => x.email === a.email);
    if (doc && doc.report) return;
    get(a.work).missing[a.email] = { email: a.email, name: (doc && doc.name) || nameOf(C, a.email) };
  });
  Object.keys(out).forEach(w => {
    const o = out[w]; Object.keys(o.senders).forEach(e => { delete o.missing[e]; });
    o.planned = R.r3(o.planned); o.done = R.r3(o.done); o.outside = R.r3(o.outside);
    o.senders = Object.keys(o.senders).map(e => o.senders[e]); o.missing = Object.keys(o.missing).map(e => o.missing[e]);
    o.reported = !o.missing.length && o.senders.length > 0;
    o.status = o.senders.length ? R.statusOf(o.planned, o.done + o.outside, true) : 'No report';
    if (o.senders.length && o.missing.length) o.status = 'Reports pending';
    o.pct = R.pct(o.done, o.planned);
  });
  return out;
}
// who had to send a report of a day: everyone with a plan for it, and everyone given a work on it. The report of a work day is
// due the next morning: for today only those who sent theirs already count.
function dueOn(C, dayDocs, d) {
  const due = {}, early = d >= R.today();
  dayDocs.forEach(doc => { if (((doc.plan || []).length && !early) || doc.report) due[doc.email] = doc.name || nameOf(C, doc.email); });
  if (!early) C.assign.filter(a => assignedOn(a, d)).forEach(a => { if (!due[a.email]) due[a.email] = nameOf(C, a.email); });
  return due;
}
const workInfo = (C, w, d) => { const v = R.versionOn(C.masters, 'work', w, d) || R.versionOn(C.masters, 'work', w, R.today()) || C.masters.filter(r => r.kind === 'work' && r.item === w).slice(-1)[0];
  return v ? { item: w, name: v.data.name, unit: v.data.unit, sort: v.data.sort, layers: v.data.layers } : { item: w, name: w, unit: 'm', sort: 999, layers: [] }; };
const bySort = (C, d) => (a, b) => { const x = workInfo(C, a, d), y = workInfo(C, b, d); return x.sort - y.sort || x.name.localeCompare(y.name); };

/* ---------- the reasons people typed (suggested to the others) ---------- */
async function saveReasons(site, list, oldList, by) {
  const had = new Set((oldList || []).map(R.reasonKey));
  const fresh = {}; list.forEach(t => { const k = R.reasonKey(t); if (k && !had.has(k) && !fresh[k]) fresh[k] = R.txt(t, 200); });
  const keys = Object.keys(fresh); if (!keys.length) return;
  const have = (await db('GET', 'eng_reasons?select=key,uses&site=eq.' + enc(site) + '&key=in.(' + keys.map(k => enc('"' + k.replace(/"/g, '') + '"')).join(',') + ')')) || [];
  const now = nowIso(), add = keys.filter(k => !have.some(h => h.key === k));
  if (add.length) await db('POST', 'eng_reasons?on_conflict=site,key', add.map(k => ({ site: site, key: k, text: fresh[k], uses: 1, first_by: by, last_used: now })), 'resolution=ignore-duplicates,return=minimal');
  await Promise.all(have.map(h => db('PATCH', 'eng_reasons?site=eq.' + enc(site) + '&key=eq.' + enc(h.key), { uses: Number(h.uses || 0) + 1, last_used: now }, 'return=minimal')));
}

/* ---------- the person's reminder: yesterday's report ---------- */
async function reminderOf(C, s, email) {
  const t = R.today(), y = R.addDays(t, -1);
  const doc = await docOf(C.site, y, email);
  const works = C.assign.filter(a => a.email === email && assignedOn(a, y)).map(a => a.work);
  const due = !!((doc && (doc.plan || []).length) || works.length) && !(doc && doc.report);
  return { day: y, due: due, hour: R.hourIST(), works: works };
}

const A = {};
/* the start of the page: what the site has set up, and what this person needs */
A.init = async (s, x, C) => {
  const reasons = (await db('GET', 'eng_reasons?select=text,uses&site=eq.' + enc(s.site) + '&order=uses.desc,last_used.desc&limit=300')) || [];
  const see = canView(s);
  return { today: R.today(), me: { email: s.email, name: s.name, role: s.role }, road: C.road, masters: C.masters,
    assign: see ? C.assign : C.assign.filter(a => a.email === s.email), people: see ? C.people : C.people.filter(p => p.email === s.email),
    reasons: reasons.map(r => r.text), units: R.UNITS, sides: sidesOn(C, R.today()).names, remind: await reminderOf(C, s, s.email) };
};
A.remind = async (s, x, C) => ({ remind: await reminderOf(C, s, s.email) });

/* ---------- SET-UP (the Super Admin) ---------- */
A.roadGet = async (s, x, C) => {
  const r = ((await db('GET', 'eng_roads?select=code,name,ch_from,ch_to,stations,source,updated_by,updated_at&site=eq.' + enc(s.site) + '&code=eq.MAIN')) || [])[0] || null;
  return { road: r };
};
// the road from its KML (read in the page: a point every 20 m – chainage, longitude, latitude)
A.roadSave = async (s, x, C) => {
  needSuper(s);
  const st = Array.isArray(x.stations) ? x.stations : [];
  if (st.length < 2 || st.length > 50000) throw fail(400, 'The KML gave no chainage line – pick the KML of the road (with its chainages 8+000, 8+020 …).', 'kml');
  let last = -Infinity;
  const clean = st.map(p => {
    const ch = Number(p && p[0]), lo = Number(p && p[1]), la = Number(p && p[2]);
    if (!(isFinite(ch) && ch >= 0 && ch < 1e7 && lo >= -180 && lo <= 180 && la >= -90 && la <= 90)) throw fail(400, 'The KML has a point that is not proper.', 'kml');
    if (ch <= last) throw fail(400, 'The chainages of the KML must go one way (8+000, 8+020 …).', 'kml');
    last = ch; return [R.r3(ch), Math.round(lo * 1e7) / 1e7, Math.round(la * 1e7) / 1e7];
  });
  const from = clean[0][0], to = clean[clean.length - 1][0];
  const out = C.masters.filter(m => m.kind === 'side' && (m.data.from < from - 0.001 || m.data.to > to + 0.001));
  if (out.length) throw fail(400, 'This KML runs from ' + R.showCh(from) + ' to ' + R.showCh(to) + ', but ' + out.length + ' side stretch(es) already set lie outside it (e.g. ' + out[0].data.name + ' ' + R.showCh(out[0].data.from) + '–' + R.showCh(out[0].data.to) + ') – change those first.', 'kml');
  const row = { site: s.site, code: 'MAIN', name: R.txt(x.name, 80) || 'Main road', ch_from: from, ch_to: to, stations: clean, source: R.txt(x.source, 120), updated_by: s.email, updated_at: nowIso() };
  await db('POST', 'eng_roads?on_conflict=site,code', [row], 'resolution=merge-duplicates,return=minimal');
  await activity(s.site, s.email, C.road ? 'Road changed' : 'Road set', row.name, { from: from, to: to, points: clean.length, was: C.road ? { from: C.road.ch_from, to: C.road.ch_to, source: C.road.source } : null });
  delete row.stations; delete row.site;
  return { road: row, points: clean.length };
};
const overlaps = (a1, a2, b1, b2) => a1 <= (b2 || '9999-12-31') && b1 <= (a2 || '9999-12-31');
/* a master (work / side / mix / design), PERIOD BY PERIOD:
 *   mode "new"    – a new item (its first period)
 *   mode "edit"   – correct one period (its parts, its dates)
 *   mode "period" – a new period from a date: the period running on that date ends the day before; nothing before it changes */
A.masterSave = async (s, x, C) => {
  needSuper(s);
  const kind = String(x.kind || ''); if (!R.KINDS[kind]) throw fail(400, 'Unknown kind.', 'kind');
  const from = R.day(x.valid_from, '"valid from"'), to = x.valid_to ? R.day(x.valid_to, '"valid to"') : null;
  if (to && to < from) throw fail(400, '"Valid to" must be on or after "valid from".', 'date');
  const vers = item => C.masters.filter(r => r.kind === kind && r.item === item);
  const floor = item => Math.max(0, ...[].concat(...vers(item).map(r => (r.data.layers || []).map(l => Number(String(l.key).slice(1)) || 0))));
  const mode = String(x.mode || '');
  const now = nowIso();
  let item, row, data;
  if (mode === 'new') {
    data = R.cleanData(kind, x.data, C.road, 0);
    item = R.nextItem(C.masters, kind);
  } else {
    const base = mode === 'edit' ? C.masters.find(r => r.id === Number(x.id) && r.kind === kind) : vers(String(x.item || ''))[0];
    if (!base) throw fail(404, 'This item is not there any more – open the page again.', 'item');
    item = base.item; data = R.cleanData(kind, x.data, C.road, floor(item));
    if (mode === 'edit') row = base;
    else if (mode !== 'period') throw fail(400, 'Unknown way of saving.', 'mode');
  }
  // the same name twice (works, mix designs, designs): refused
  if (kind !== 'side') {
    const same = C.masters.find(r => r.kind === kind && r.item !== item && String(r.data.name).toLowerCase() === data.name.toLowerCase());
    if (same) throw fail(409, '"' + data.name + '" is already there (' + same.item + ') – open it and add a new period instead.', 'exists');
  }
  // the periods of one item never overlap
  const others = vers(item).filter(r => !row || r.id !== row.id);
  let end = to;
  if (mode === 'period') {
    const prev = others.filter(r => r.valid_from < from).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    if (others.some(r => r.valid_from === from)) throw fail(409, 'A period of this item already starts on ' + R.showDay(from) + ' – change that one instead.', 'date');
    const next = others.filter(r => r.valid_from > from).sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0];
    if (next && (!end || end >= next.valid_from)) end = R.addDays(next.valid_from, -1);
    if (prev && (!prev.valid_to || prev.valid_to >= from)) {
      await db('PATCH', 'eng_masters?id=eq.' + prev.id + '&site=eq.' + enc(s.site), { valid_to: R.addDays(from, -1), updated_by: s.email, updated_at: now }, 'return=minimal');
      prev.valid_to = R.addDays(from, -1);
    }
  } else {
    const hit = others.find(r => overlaps(from, end, r.valid_from, r.valid_to));
    if (hit) throw fail(409, 'This period (' + R.showDay(from) + (end ? ' – ' + R.showDay(end) : ' onwards') + ') overlaps the period ' + R.showDay(hit.valid_from) + (hit.valid_to ? ' – ' + R.showDay(hit.valid_to) : ' onwards') + ' of the same item.', 'date');
  }
  // a side: one width at a place in a period (two stretches of the same side never overlap)
  if (kind === 'side') {
    const clash = C.masters.find(r => r.kind === 'side' && r.item !== item && r.active && r.data.name === data.name && overlaps(from, end, r.valid_from, r.valid_to) && r.data.from < data.to && data.from < r.data.to);
    if (clash) throw fail(409, data.name + ' already has a width from ' + R.showCh(clash.data.from) + ' to ' + R.showCh(clash.data.to) + ' in this period (' + clash.item + ').', 'overlap');
  }
  let saved;
  if (row) saved = ((await db('PATCH', 'eng_masters?id=eq.' + row.id + '&site=eq.' + enc(s.site), { data: data, valid_from: from, valid_to: end, updated_by: s.email, updated_at: now }, 'return=representation')) || [])[0];
  else {
    const prev = mode === 'period' ? others.filter(r => r.valid_from < from).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] : null;
    saved = ((await db('POST', 'eng_masters', [{ site: s.site, kind: kind, item: item, data: data, valid_from: from, valid_to: end, active: prev ? prev.active : true, created_by: s.email, updated_by: s.email }], 'return=representation')) || [])[0];
  }
  await activity(s.site, s.email, mode === 'new' ? 'Master added' : mode === 'edit' ? 'Master changed' : 'Master new period', item + ' ' + (data.name || ''), { kind: kind, from: from, to: end });
  return { item: item, saved: saved };
};
A.masterActive = async (s, x, C) => {
  needSuper(s);
  const row = C.masters.find(r => r.id === Number(x.id)); if (!row) throw fail(404, 'This item is not there any more – open the page again.', 'item');
  const on = x.active === true;
  await db('PATCH', 'eng_masters?id=eq.' + row.id + '&site=eq.' + enc(s.site), { active: on, updated_by: s.email, updated_at: nowIso() }, 'return=minimal');
  await activity(s.site, s.email, on ? 'Master active' : 'Master inactive', row.item + ' ' + (row.data.name || ''), { kind: row.kind, from: row.valid_from });
  return { id: row.id, active: on };
};
// a person on the list before his first sign-in (so his works can be given); he needs Engineering on this site in the Portal
A.personAdd = async (s, x, C) => {
  needSuper(s);
  const email = String(x.email || '').trim().toLowerCase(), name = R.txt(x.name, 80);
  if (!EMAIL.test(email) || email.length > 120) throw fail(400, 'Give the person\'s email (the one he signs in with).', 'email');
  if (name.length < 2) throw fail(400, 'Give the person\'s name.', 'name');
  if (C.people.some(p => p.email === email)) throw fail(409, email + ' is already on the list.', 'exists');
  await db('POST', 'eng_people', [{ site: s.site, email: email, name: name, role: 'user', added_by: s.email }], 'return=minimal');
  await activity(s.site, s.email, 'Person added', email, { name: name });
  return { person: { email: email, name: name, role: 'user', added_by: s.email } };
};
// which works a person does (more than one may be given); a work taken back stays in his past days
A.assignSave = async (s, x, C) => {
  needSuper(s);
  const email = String(x.email || '').trim().toLowerCase();
  if (!C.people.some(p => p.email === email)) throw fail(404, 'This person is not on the Engineering list of this site.', 'person');
  const want = [...new Set((Array.isArray(x.works) ? x.works : []).map(String))];
  want.forEach(w => { if (!C.masters.some(r => r.kind === 'work' && r.item === w)) throw fail(400, 'Unknown work ' + w + '.', 'work'); });
  const now = nowIso(), mine = C.assign.filter(a => a.email === email), changed = [];
  for (const w of want) {
    const a = mine.find(y => y.work === w);
    if (!a) { await db('POST', 'eng_assign', [{ site: s.site, email: email, work: w, active: true, created_by: s.email, updated_by: s.email }], 'return=minimal'); changed.push('+' + w); }
    else if (!a.active) { await db('PATCH', 'eng_assign?site=eq.' + enc(s.site) + '&email=eq.' + enc(email) + '&work=eq.' + enc(w), { active: true, created_at: now, updated_by: s.email, updated_at: now }, 'return=minimal'); changed.push('+' + w); }
  }
  for (const a of mine.filter(y => y.active && want.indexOf(y.work) === -1)) {
    await db('PATCH', 'eng_assign?site=eq.' + enc(s.site) + '&email=eq.' + enc(email) + '&work=eq.' + enc(a.work), { active: false, updated_by: s.email, updated_at: now }, 'return=minimal'); changed.push('-' + a.work);
  }
  if (changed.length) await activity(s.site, s.email, 'Works given', email, { changes: changed });
  return { email: email, works: want, changed: changed };
};

/* ---------- A PERSON'S DAYS: plan and report ---------- */
A.days = async (s, x, C) => {
  const who = whoFor(s, C, x.email, true), sp = span(x, 62);
  const list = await all('eng_days?select=' + DOC + ',history&site=eq.' + enc(s.site) + '&email=eq.' + enc(who.email) + '&day=gte.' + sp.from + '&day=lte.' + sp.to + '&order=day');
  const works = C.assign.filter(a => a.email === who.email && a.active).map(a => a.work);
  return { email: who.email, name: who.name, days: list, works: works, today: R.today(), remind: who.email === s.email ? await reminderOf(C, s, s.email) : null };
};
// the plan of a day: for today or the next 7 days (the Super Admin: any day); fixed once the report of that day is in
A.planSave = async (s, x, C) => {
  const d = R.day(x.day, 'the plan'), who = whoFor(s, C, x.email), t = R.today();
  if (!isSuper(s) && (d < t || d > R.addDays(t, 7))) throw fail(400, 'A plan is made for today or for the next days (up to 7 days ahead). For a day gone by, report the work done – outside the plan.', 'date');
  const old = await docOf(s.site, d, who.email);
  if (old && old.report) throw fail(400, 'The report of ' + R.showDay(d) + ' is in – its plan stays as it was. Change the report instead.', 'reported');
  const plan = R.cleanPlan(x.lines, Object.assign(dayCtx(C, d, s, who.email), { keep: [] }));
  const now = nowIso(), first = !old || !old.plan_at;
  const patch = { name: who.name, plan: plan, plan_at: first ? now : old.plan_at, plan_by: first ? s.email : old.plan_by };
  if (!first) patch.history = [{ at: now, by: s.email, what: 'plan', plan: old.plan }].concat(old.history || []).slice(0, 30);
  const doc = await writeDoc(s.site, d, who.email, old, x.ver, patch);
  await activity(s.site, s.email, first ? 'Plan made' : 'Plan changed', who.email + ' ' + d, { lines: plan.length });
  return { doc: doc };
};
// the report of a work day (today or before): by the person himself, or the Super Admin; a change after it was sent is kept (✎)
A.reportSave = async (s, x, C) => {
  const d = R.day(x.day, 'the report'), who = whoFor(s, C, x.email), t = R.today();
  if (d > t) throw fail(400, 'A report is of work done – today or a day before.', 'date');
  const old = await docOf(s.site, d, who.email);
  const rep = R.cleanReport(x.report, old ? old.plan : [], dayCtx(C, d, s, who.email));
  if (!rep.lines.length && !rep.extra.length && !rep.note) throw fail(400, 'Nothing was planned for ' + R.showDay(d) + ': add the work done (outside the plan), or write in the note what happened.', 'empty');
  const now = nowIso(), first = !old || !old.report;
  const patch = { name: who.name, report: rep, report_at: first ? now : old.report_at, report_by: first ? s.email : old.report_by };
  if (!first) Object.assign(patch, { edited_at: now, edited_by: s.email, edits: Number(old.edits || 0) + 1, history: [{ at: now, by: s.email, what: 'report', report: old.report }].concat(old.history || []).slice(0, 30) });
  const doc = await writeDoc(s.site, d, who.email, old, x.ver, patch);
  try { await saveReasons(s.site, R.reasonsOf(rep), first ? [] : R.reasonsOf(old.report), s.email); } catch (e) { console.error('[engineering reasons] ' + String((e && e.message) || e)); }
  await activity(s.site, s.email, first ? 'Report sent' : 'Report changed', who.email + ' ' + d, { lines: rep.lines.length, extra: rep.extra.length });
  return { doc: doc };
};
A.reasons = async (s) => ({ reasons: ((await db('GET', 'eng_reasons?select=text,uses&site=eq.' + enc(s.site) + '&order=uses.desc,last_used.desc&limit=300')) || []).map(r => r.text) });

/* ---------- THE VIEWS ---------- */
// the dashboard of a work day: each work planned against done, who sent it, what needs attention, and the next day's program
A.dash = async (s, x, C) => {
  needView(s);
  const W = R.day(x.day, 'the dashboard'), P = R.addDays(W, 1), from = R.addDays(W, -6);
  const list = await docs(s.site, from, P);
  const dW = list.filter(d => d.day === W), dP = list.filter(d => d.day === P);
  const pw = perWork(C, dW, W), due = dueOn(C, dW, W);
  // the last 7 days of each work
  const week = {};
  daysOf(from, W).forEach(d => { const o = perWork(C, list.filter(y => y.day === d), d); Object.keys(o).forEach(w => { const k = week[w] = week[w] || { planned: 0, done: 0, outside: 0 }; k.planned += o[w].planned; k.done += o[w].done; k.outside += o[w].outside; }); });
  // the program of the next day (every plan line)
  const prog = {};
  dP.forEach(doc => (doc.plan || []).forEach(p => { (prog[p.work] = prog[p.work] || []).push(Object.assign({ email: doc.email, name: doc.name || nameOf(C, doc.email), at: doc.plan_at }, p)); }));
  const keys = [...new Set(Object.keys(pw).concat(Object.keys(prog)))].sort(bySort(C, W));
  const works = keys.map(w => Object.assign(workInfo(C, w, W), pw[w] || { planned: 0, done: 0, outside: 0, lines: [], senders: [], missing: [], reported: false, status: 'Nothing planned', pct: 0 },
    { week: week[w] ? { planned: R.r3(week[w].planned), done: R.r3(week[w].done), outside: R.r3(week[w].outside), pct: R.pct(week[w].done, week[w].planned) } : null, program: prog[w] || [] }));
  // the tiles (metres only: works counted in Nos / sq m / cum are in their own lines)
  const m = works.filter(w => w.unit === 'm' && pw[w.item]);
  const people = Object.keys(due).map(e => { const doc = dW.find(y => y.email === e), nx = dP.find(y => y.email === e);
    return { email: e, name: due[e], planned: !!(doc && (doc.plan || []).length), reported: !!(doc && doc.report), at: doc && doc.report_at, by: doc && doc.report_by, late: !!(doc && R.lateOf(W, doc.report_at)), edits: (doc && doc.edits) || 0,
      program: !!(nx && (nx.plan || []).length), programAt: nx && nx.plan_at }; }).sort((a, b) => a.name.localeCompare(b.name));
  const withPlan = works.filter(w => pw[w.item] && w.planned > 0 && w.senders.length);
  const tiles = { planned: R.r3(m.reduce((a, w) => a + w.planned, 0)), done: R.r3(m.reduce((a, w) => a + w.done, 0)), outside: R.r3(m.reduce((a, w) => a + w.outside, 0)),
    reportsIn: people.filter(p => p.reported).length, reportsDue: people.length,
    worksTotal: works.filter(w => pw[w.item] && w.planned > 0).length,
    complete: withPlan.filter(w => w.done >= w.planned - 0.001).length, partly: withPlan.filter(w => w.done > 0 && w.done < w.planned - 0.001).length,
    notDone: withPlan.filter(w => w.done <= 0).length, more: withPlan.filter(w => w.done > w.planned + 0.001).length };
  tiles.pct = R.pct(tiles.done, tiles.planned);
  // what needs attention: missing reports, work left (and why), no program for the next day
  const attention = [];
  people.filter(p => !p.reported).forEach(p => attention.push({ kind: 'missing', email: p.email, text: 'No report from ' + p.name + ' for ' + R.showDay(W) }));
  works.forEach(w => w.lines.filter(l => !l.outside && l.reported && l.left > 0).forEach(l => attention.push({ kind: 'left', email: l.email, work: w.item, text: w.name + ': ' + l.left + ' ' + w.unit + ' left (' + l.name + ')' + (l.reason ? ' – ' + l.reason : '') })));
  C.assign.filter(a => assignedOn(a, P)).map(a => a.email).filter((e, i, arr) => arr.indexOf(e) === i).forEach(e => { if (!dP.some(y => y.email === e && (y.plan || []).length)) attention.push({ kind: 'program', email: e, text: 'No program for ' + R.showDay(P) + ' from ' + nameOf(C, e) }); });
  return { day: W, next: P, works: works, people: people, tiles: tiles, attention: attention, sides: sidesOn(C, W).names, road: C.road };
};
// one person's day as sent (for "View report"): the Admin and the Super Admin, or the person himself
A.dayView = async (s, x, C) => {
  const who = whoFor(s, C, x.email, true), d = R.day(x.day);
  return { doc: await docOf(s.site, d, who.email), name: who.name };
};
/* the strip chart up to a work day: on each side, the highest layer finished at every place; outlined = done that day; dashed =
 * the program of the next day; and how far each layer has got (of the length of its sides) – also this month */
A.strip = async (s, x, C) => {
  const W = R.day(x.day, 'the strip chart'), P = R.addDays(W, 1);
  const list = await all('eng_days?select=day,email,plan,report&site=eq.' + enc(s.site) + '&day=lte.' + W + '&report=not.is.null&order=day,email');
  const next = await all('eng_days?select=day,email,name,plan&site=eq.' + enc(s.site) + '&day=eq.' + P + '&order=email');
  const works = R.itemsOn(C.masters, 'work', W, true), sd = sidesOn(C, W);
  const now = R.strip(list, works, sd.list, W), m0 = R.addDays(W.slice(0, 8) + '01', -1), then = R.strip(list, works, sd.list, m0);
  const rank = {}; now.layers.forEach(l => { rank[l.id] = l.rank; });
  const one = d => { const by = {}; list.filter(y => y.day === d).forEach(y => R.dayFigures(y).forEach(f => { if (f.from === null || !f.done) return; const id = f.work + '|' + (f.layer || ''); if (!rank[id]) return; R.sidesOf(f.side).forEach(n => (by[n] = by[n] || []).push({ from: Math.min(f.from, f.to), to: Math.max(f.from, f.to), layer: id, outside: f.outside })); })); return by; };
  const prog = {}; next.forEach(y => (y.plan || []).forEach(p => { if (p.from === null) return; const id = p.work + '|' + (p.layer || ''); if (!rank[id]) return; R.sidesOf(p.side).forEach(n => (prog[n] = prog[n] || []).push({ from: p.from, to: p.to, layer: id })); }));
  // per layer: done on each side (km) and its per cent of the length of the sides the work is done on
  const stats = now.layers.map(l => {
    const w = works[l.work], on = sd.names.filter(n => !w.data.sides.length || w.data.sides.indexOf(n) > -1 || (w.data.sides.indexOf(R.BOTH) > -1 && (n === 'LHS' || n === 'RHS')));
    const per = {}; let done = 0, len = 0, before = 0;
    on.forEach(n => { const a = (now.sides[n].done[l.id] || 0), b = (then.sides[n].done[l.id] || 0); per[n] = R.r3(a / 1000); done += a; before += b; len += now.sides[n].length || 0; });
    return { id: l.id, name: l.name, per: per, done: R.r3(done), month: R.r3((done - before) / 1000), pct: len > 0 ? Math.round(done / len * 1000) / 10 : null };
  });
  const first = list.length ? list[0].day : W;
  const range = C.road ? { from: C.road.ch_from, to: C.road.ch_to } : (() => { const all2 = [].concat(...Object.keys(now.sides).map(n => now.sides[n].pieces)); return all2.length ? { from: Math.min(...all2.map(p => p.from)), to: Math.max(...all2.map(p => p.to)) } : { from: 0, to: 1000 }; })();
  return { day: W, next: P, first: first, range: range, sides: sd.names, sidesSet: sd.set, layers: now.layers, strip: now.sides, yesterday: one(W), program: prog, stats: stats, road: C.road ? { name: C.road.name, from: C.road.ch_from, to: C.road.ch_to } : null };
};
// ALL REPORTS: day by day (newest first), for each work who sent its report when, and how much of the plan was done
A.grid = async (s, x, C) => {
  needView(s);
  const sp = span(x, 62), list = await docs(s.site, sp.from, sp.to), rows = [], cols = new Set();
  daysOf(sp.from, sp.to).reverse().forEach(d => {
    const dd = list.filter(y => y.day === d), pw = perWork(C, dd, d), cells = {};
    Object.keys(pw).forEach(w => { cols.add(w); const o = pw[w]; cells[w] = { pct: o.planned > 0 ? o.pct : null, planned: o.planned, done: o.done, outside: o.outside, senders: o.senders, missing: o.missing }; });
    const due = dueOn(C, dd, d);
    rows.push({ day: d, cells: cells, due: Object.keys(due).length, sent: dd.filter(y => y.report).length });
  });
  return { from: sp.from, to: sp.to, works: [...cols].sort(bySort(C, sp.to)).map(w => workInfo(C, w, sp.to)), rows: rows };
};
// PERFORMANCE: each person – reports due and sent, late, corrected, planned against done – and who sent which work day by day
A.perf = async (s, x, C) => {
  needView(s);
  const sp = span(x, 93), list = await docs(s.site, sp.from, sp.to), P = {}, matrix = {};
  const get = (e, n) => P[e] = P[e] || { email: e, name: n || nameOf(C, e), due: 0, sent: 0, late: 0, edits: 0, missing: 0, planned: 0, done: 0, outside: 0, last: null, works: {}, days: [] };
  daysOf(sp.from, sp.to).forEach(d => {
    const dd = list.filter(y => y.day === d), due = dueOn(C, dd, d);
    Object.keys(due).forEach(e => {
      const p = get(e, due[e]), doc = dd.find(y => y.email === e); p.due++;
      if (!doc || !doc.report) { p.missing++; p.days.push({ day: d, state: 'missing' }); return; }
      p.sent++; p.edits += Number(doc.edits || 0); const late = R.lateOf(d, doc.report_at); if (late) p.late++;
      if (!p.last || doc.report_at > p.last) p.last = doc.report_at;
      let pl = 0, dn = 0;
      R.dayFigures(doc).forEach(f => { const w = workInfo(C, f.work, d); if (w.unit !== 'm') return; if (f.outside) p.outside += f.done; else { p.planned += f.planned; p.done += f.done; pl += f.planned; dn += f.done; } });
      [...new Set(R.dayFigures(doc).map(f => workInfo(C, f.work, d).name))].forEach(n => { p.works[n] = (p.works[n] || 0) + 1; });
      p.days.push({ day: d, state: late ? 'late' : 'sent', at: doc.report_at, edits: doc.edits || 0, pct: pl > 0 ? R.pct(dn, pl) : null });
    });
    const pw = perWork(C, dd, d);
    Object.keys(pw).forEach(w => { if (d >= R.today() && !pw[w].senders.length) return; const r = matrix[w] = matrix[w] || {}; r[d] = { senders: pw[w].senders.map(y => y.name), missing: d >= R.today() ? [] : pw[w].missing.map(y => y.name), pct: pw[w].planned > 0 ? pw[w].pct : null }; });
  });
  const people = Object.keys(P).map(e => { const p = P[e]; p.planned = R.r3(p.planned); p.done = R.r3(p.done); p.outside = R.r3(p.outside); p.pct = R.pct(p.done, p.planned); return p; }).sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  return { from: sp.from, to: sp.to, days: daysOf(sp.from, sp.to), people: people, works: Object.keys(matrix).sort(bySort(C, sp.to)).map(w => Object.assign(workInfo(C, w, sp.to), { days: matrix[w] })) };
};
// THE REPORT of a period (a day, a week, 15 days, a month): each work – planned, done, outside the plan, by person, the reasons
A.report = async (s, x, C) => {
  needView(s);
  const sp = span(x, 93), list = await docs(s.site, sp.from, sp.to), W = {};
  const get = w => W[w] = W[w] || Object.assign(workInfo(C, w, sp.to), { planned: 0, done: 0, outside: 0, people: {}, reasons: {}, days: {} });
  daysOf(sp.from, sp.to).forEach(d => {
    list.filter(y => y.day === d).forEach(doc => R.dayFigures(doc).forEach(f => {
      const o = get(f.work), p = o.people[doc.email] = o.people[doc.email] || { email: doc.email, name: doc.name || nameOf(C, doc.email), planned: 0, done: 0, outside: 0, days: {} };
      const dy = o.days[d] = o.days[d] || { planned: 0, done: 0, outside: 0 };
      if (f.outside) { o.outside += f.done; p.outside += f.done; dy.outside += f.done; } else { o.planned += f.planned; o.done += f.done; p.planned += f.planned; p.done += f.done; dy.planned += f.planned; dy.done += f.done; }
      p.days[d] = 1;
      if (f.reason) { const k = R.reasonKey(f.reason), r = o.reasons[k] = o.reasons[k] || { text: f.reason, times: 0, left: 0 }; r.times++; r.left += f.left || 0; }
    }));
  });
  const works = Object.keys(W).sort(bySort(C, sp.to)).map(w => { const o = W[w];
    return Object.assign(o, { planned: R.r3(o.planned), done: R.r3(o.done), outside: R.r3(o.outside), pct: R.pct(o.done, o.planned),
      people: Object.keys(o.people).map(e => { const p = o.people[e]; return { email: e, name: p.name, planned: R.r3(p.planned), done: R.r3(p.done), outside: R.r3(p.outside), pct: R.pct(p.done, p.planned), days: Object.keys(p.days).length }; }).sort((a, b) => b.done - a.done),
      reasons: Object.keys(o.reasons).map(k => Object.assign(o.reasons[k], { left: R.r3(o.reasons[k].left) })).sort((a, b) => b.times - a.times),
      days: Object.keys(o.days).sort().map(d => ({ day: d, planned: R.r3(o.days[d].planned), done: R.r3(o.days[d].done), outside: R.r3(o.days[d].outside) })) }); });
  const sent = list.filter(y => y.report).length;
  let due = 0; daysOf(sp.from, sp.to).forEach(d => { due += Object.keys(dueOn(C, list.filter(y => y.day === d), d)).length; });
  return { from: sp.from, to: sp.to, works: works, reports: { sent: sent, due: due } };
};

/* (28-10-2026) THE ASSISTANT'S LOOK-UPS ("AI la app cha main brain": Mechanical's Ask answers about Engineering too) – read only,
 * each through the look of this file with its own check of the person's access (the dashboard, the report and the performance:
 * the Admin and the Super Admin; the progress and his own days: everybody of Engineering) – lib/ailook.js makes them short. */
const AL = require('../lib/ailook');
A.aiLook = async (s, x, C) => {
  const name = String(x.name || ''), a = x.args && typeof x.args === 'object' && !Array.isArray(x.args) ? x.args : {};
  let to, from;
  try {
    to = AL.day(a.to, 'To date') || R.today(); from = AL.day(a.from, 'From date') || R.addDays(to, -6);
    if (AL.NAMES.indexOf(name) < 0) throw AL.userErr('There is no such look-up of Engineering.');
  } catch (e) { if (e.user) throw fail(400, e.message, 'field'); throw e; }
  const nm = (w, d) => workInfo(C, w, d || to).name;
  if (name === 'eng_my_work') {
    const d = await A.days(s, { from: from, to: to }, C);
    return AL.fit({ person: d.name, from: from, to: to, worksGiven: d.works.map(w => nm(w)), reportOfYesterdayDue: d.remind ? d.remind.due : undefined,
      days: d.days.map(doc => ({ day: doc.day, planned: !!(doc.plan || []).length, reported: !!doc.report, reportAt: doc.report_at || '', edits: doc.edits || 0,
        lines: AL.pick(R.dayFigures(doc).map(f => Object.assign({}, f, { work: nm(f.work, doc.day) })), ['work', 'layer', 'side', 'pFrom', 'pTo', 'planned', 'from', 'to', 'done', 'left', 'reason', 'outside'], 20) })) });
  }
  if (name === 'eng_dashboard') {
    const d = await A.dash(s, { day: AL.day(a.day, 'day') || R.addDays(R.today(), -1) }, C);
    return AL.fit({ workDay: d.day, programDay: d.next, tiles: d.tiles, meaning: 'planned / done / outside are metres of the works counted in m; reportsIn of reportsDue',
      works: AL.pick(d.works.map(w => Object.assign({}, w, { left: w.lines ? w.lines.filter(l => l.left > 0).map(l => l.name + ' ' + l.left + ' ' + w.unit + (l.reason ? ' – ' + l.reason : '')).join('; ') : '', missing: (w.missing || []).map(p => p.name || p).join(', '), week: w.week ? w.week.pct + '% of the week\'s plan done' : '' })),
        ['name', 'unit', 'planned', 'done', 'outside', 'pct', 'status', 'left', 'missing', 'week'], 40),
      people: AL.pick(d.people, ['name', 'planned', 'reported', 'late', 'edits', 'program'], 60), attention: d.attention.map(t => t.text).slice(0, 40) });
  }
  if (name === 'eng_report') {
    const d = await A.report(s, { from: from, to: to }, C);
    return AL.fit({ from: d.from, to: d.to, reportsSent: d.reports.sent, reportsDue: d.reports.due,
      works: AL.pick(d.works.map(w => Object.assign({}, w, { people: (w.people || []).map(p => p.name + ' ' + p.done + ' of ' + p.planned + ' (' + p.pct + '%)').join('; '), reasons: (w.reasons || []).slice(0, 8).map(r => r.text + ' ×' + r.times).join('; ') })),
        ['name', 'unit', 'planned', 'done', 'outside', 'pct', 'people', 'reasons'], 40) });
  }
  if (name === 'eng_performance') {
    const d = await A.perf(s, { from: from, to: to }, C);
    return AL.fit({ from: d.from, to: d.to, people: AL.pick(d.people.map(p => Object.assign({}, p, { works: Object.keys(p.works || {}).join(', ') })), ['name', 'due', 'sent', 'late', 'edits', 'missing', 'planned', 'done', 'outside', 'pct', 'last', 'works'], 60),
      meaning: 'due = reports to send; sent; late = sent after the morning; missing = not sent; planned / done in metres' });
  }
  const d = await A.strip(s, { day: AL.day(a.day, 'day') || R.today() }, C);
  return AL.fit({ upTo: d.day, road: d.road, sides: d.sides, layers: AL.pick(d.stats, ['name', 'per', 'done', 'month', 'pct'], 40), meaning: 'per = km finished on each side; done = metres in all; month = km this month; pct = % of the length of its sides' });
};

/* (24-10-2026, Mechanical's update-155: "Engineering मधील अनावश्यक Requests कमी कर") WHAT THE SITE HAS SET UP (the masters, the
 * road, who does which work, the people – at least 4 reads) was read again for EVERY action – a page that opens asks several at
 * once. Now the looks (the page's lists, the dashboard, the reports, the reminder) that come within 2 SECONDS of each other share
 * one read of this server (each gets its own copy, so nothing a request does can change another's). 2 seconds: what another
 * person saves shows within the owner's 2 seconds (02-10-2026), on any of Vercel's servers. EVERY SAVE reads it afresh, as before –
 * what is checked is always what the database has – and its end drops the shared read (also one that started during the save).
 * Per site: a site's read is never used for another. */
const WRITES = new Set(['roadSave', 'masterSave', 'masterActive', 'personAdd', 'assignSave', 'planSave', 'reportSave']);
const CTX = new Map();      // site → { at, p: the read (a promise) }
const CTX_MS = 2000;
async function ctxFor(site, fresh) {
  if (fresh) return ctxOf(site);
  const k = CTX.get(site);
  if (k && Date.now() - k.at < CTX_MS) return structuredClone(await k.p);
  if (CTX.size > 50) CTX.clear();
  const e = { at: Date.now(), p: ctxOf(site) };      // kept from its START: a save that ends meanwhile drops it
  CTX.set(site, e);
  e.p.catch(() => { if (CTX.get(site) === e) CTX.delete(site); });      // a read that failed is not shared
  return structuredClone(await e.p);
}
const ctxDrop = site => CTX.delete(site);
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const s = await ses.need(req), x = await readBody(req), fn = A[String(x.action || '')];
  if (!fn || !Object.prototype.hasOwnProperty.call(A, x.action)) throw fail(400, 'Unknown action.', 'action');
  const w = WRITES.has(String(x.action));
  const C = await ctxFor(s.site, w);
  let out;
  try { out = await fn(s, x, C); } finally { if (w) ctxDrop(s.site); }
  // (update-155) a look from a page that keeps its answers: "the same" / only what changed / whole (lib/http.js sendKept)
  if (!w && x.m === 1) return sendKept(res, s, x, Object.assign({ ok: true }, out));
  send(res, 200, Object.assign({ ok: true }, out));
});
module.exports.forgetCtx = () => CTX.clear();
module.exports.ctxFor = ctxFor; module.exports.ctxDrop = ctxDrop;
module.exports.A = A;
module.exports.perWork = perWork;
