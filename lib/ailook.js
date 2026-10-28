/* THE ASSISTANT'S ENGINEERING LOOK-UPS (28-10-2026, "AI la app cha main brain" – Mechanical's Ask answers about Engineering too).
 * Mechanical's page passes a look-up's name and what the AI asked for (action aiLook of api/eng.js); it is answered from
 * Engineering's own looks – the dashboard, the report, the performance (the Admin and the Super Admin), the strip chart's progress
 * and the person's own days – with every check of the person's Engineering access, and made SHORT for the AI. It only READS. */
'use strict';
const MAX = 14000;
const NAMES = ['eng_my_work', 'eng_dashboard', 'eng_report', 'eng_performance', 'eng_progress'];
const userErr = m => { const e = new Error(m); e.user = true; return e; };
const day = (v, what) => { const s = String(v || '').trim(); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw userErr('Give the ' + what + ' as yyyy-mm-dd.'); return s; };
const has = v => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length);
// a few fields of each row (only those that hold something)
const pick = (rows, keys, max) => (rows || []).slice(0, max).map(r => { const o = {}; keys.forEach(k => { if (has(r[k])) o[k] = typeof r[k] === 'string' && r[k].length > 200 ? r[k].slice(0, 200) + '…' : r[k]; }); return o; });
// the answer made to fit: while too long, its longest list is halved – and it says so
function fit(o) {
  for (let i = 0; i < 12 && JSON.stringify(o).length > MAX; i++) {
    let k = '', n = 0; Object.keys(o).forEach(x => { if (Array.isArray(o[x]) && o[x].length > n) { k = x; n = o[x].length; } });
    if (!k || n < 2) break;
    o[k] = o[k].slice(0, Math.floor(n / 2)); o.note = 'Only the first ' + o[k].length + ' of "' + k + '" are given here (the answer was too long).';
  }
  return o;
}
module.exports = { NAMES, day, pick, fit, userErr };
