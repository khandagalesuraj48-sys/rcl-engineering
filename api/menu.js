/* GET /menu.json (→ /api/menu) – the pages of Engineering for the menu of the screen around it (Mechanical's dark menu): only the
 * pages this person has (a User: My work, the Strip chart, RFI, Hindrances; the Admin also the views and the Measurement Book; the
 * Super Admin also the set-up).
 * Before the first sign-in here nobody is known: every page is listed – the page itself then opens only what he has. */
'use strict';
const { handler, send } = require('../lib/http');
const ses = require('../lib/session');
const PAGES = [
  { key: 'mywork', name: 'My work', who: 'all' },
  { key: 'dashboard', name: 'Dashboard', who: 'view' },
  { key: 'strip', name: 'Strip chart', who: 'all' },
  { key: 'rfi', name: 'RFI', who: 'all' },      // (09-11-2026) the IE's approval of a layer
  { key: 'hind', name: 'Hindrances', who: 'all' },      // (09-11-2026) the evidence for an extension of time
  { key: 'allreports', name: 'All reports', who: 'view' },
  { key: 'reports', name: 'Reports', who: 'view' },
  { key: 'perf', name: 'Performance', who: 'view' },
  { key: 'mb', name: 'Measurement Book', who: 'view' },      // (10-11-2026) the quantity of a finished layer → measured → check-measured → the RA bill's abstract
  { key: 'setup', name: 'Set-up (Super Admin)', who: 'super' },
];
const mayOpen = (who, role) => who === 'all' || (who === 'view' && (role === 'admin' || role === 'super')) || (who === 'super' && role === 'super');
module.exports = handler(async (req, res) => {
  let s = null; try { s = await ses.read(req); } catch (e) { s = null; }
  send(res, 200, { module: 'engineering', name: 'Engineering', pages: PAGES.filter(p => !s || mayOpen(p.who, s.role)).map(p => ({ key: p.key, name: p.name })) });
});
module.exports.PAGES = PAGES;
module.exports.mayOpen = mayOpen;
