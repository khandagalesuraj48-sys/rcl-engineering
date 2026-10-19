/* GET /menu.json (→ /api/menu) – the pages of Engineering for the menu of the screen around it (Mechanical's dark menu): only the
 * pages this person has (a User: My work and the Strip chart; the Admin also the views; the Super Admin also the set-up).
 * Before the first sign-in here nobody is known: every page is listed – the page itself then opens only what he has. */
'use strict';
const { handler, send } = require('../lib/http');
const ses = require('../lib/session');
const PAGES = [
  { key: 'mywork', name: 'My work', who: 'all' },
  { key: 'dashboard', name: 'Dashboard', who: 'view' },
  { key: 'strip', name: 'Strip chart', who: 'all' },
  { key: 'allreports', name: 'All reports', who: 'view' },
  { key: 'reports', name: 'Reports', who: 'view' },
  { key: 'perf', name: 'Performance', who: 'view' },
  { key: 'setup', name: 'Set-up (Super Admin)', who: 'super' },
];
const mayOpen = (who, role) => who === 'all' || (who === 'view' && (role === 'admin' || role === 'super')) || (who === 'super' && role === 'super');
module.exports = handler(async (req, res) => {
  let s = null; try { s = await ses.read(req); } catch (e) { s = null; }
  send(res, 200, { module: 'engineering', name: 'Engineering', pages: PAGES.filter(p => !s || mayOpen(p.who, s.role)).map(p => ({ key: p.key, name: p.name })) });
});
module.exports.PAGES = PAGES;
module.exports.mayOpen = mayOpen;
