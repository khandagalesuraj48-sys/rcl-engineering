/* POST /api/sso { ticket } – the Portal sent the person here: the ticket is checked (lib/portal.js), used ONCE (its number is
 * written into eng_tickets), the person is noted on the site's list of people, and an Engineering sign-in for that site starts. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const portal = require('../lib/portal');
const { db } = require('../lib/db');
const ses = require('../lib/session');
const { activity } = require('../lib/activity');
const { isPreview } = require('../lib/preview');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), c = await portal.verify(x.ticket);
  try { await db('POST', 'eng_tickets', [{ jti: c.jti, expires_at: new Date((c.exp + 300) * 1000).toISOString() }], 'return=minimal'); }
  catch (e) {
    if (e && e.code === 'duplicate') throw fail(401, 'The Portal sign-in could not be accepted (this ticket was already used) – open Engineering again from the Portal.', 'ticket');
    throw e;
  }
  if (Math.random() < 0.05) { const old = new Date(Date.now() - 86400000).toISOString(); db('DELETE', 'eng_tickets?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); db('DELETE', 'eng_sessions?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); }
  // the people of the site: who signed in (name and role as the Portal says them now)
  const now = new Date().toISOString();
  const had = ((await db('GET', 'eng_people?select=email,first_seen&site=eq.' + encodeURIComponent(c.site) + '&email=eq.' + encodeURIComponent(c.email))) || [])[0];
  await db('POST', 'eng_people?on_conflict=site,email', [{ site: c.site, email: c.email, name: c.name, role: c.role, first_seen: (had && had.first_seen) || now, last_seen: now }], 'resolution=merge-duplicates,return=minimal');
  const cookie = await ses.create(req, c);
  await activity(c.site, c.email, 'Sign-in', c.site, { role: c.role });
  send(res, 200, { ok: true, preview: isPreview() || undefined, user: { email: c.email, name: c.name, role: c.role }, site: c.site, siteName: c.siteName, mods: c.mods, sites: c.sites, portal: portal.url() }, { 'Set-Cookie': cookie });
});
