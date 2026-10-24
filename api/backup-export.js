/* (with Mechanical's update-157, asked 24-10-2026) Engineering's data for the backup – only for Mechanical's backup, asked with
 * BACKUP_EXPORT_SECRET (lib/bkexport.js). A site's rows only (every table here carries its site): they go into that site's own
 * Google Sheets ("Engineering – …" tabs). The sign-ins and used tickets are never given. */
'use strict';
const { handler, readBody, send, fail } = require('../lib/http');
const { allowed, make } = require('../lib/bkexport');
const TABLES = {
  eng_roads: { title: 'Road', key: 'code' },
  eng_masters: { title: 'Masters', key: 'id' },
  eng_assign: { title: 'Works given', key: 'email,work' },
  eng_people: { title: 'People', key: 'email' },
  eng_days: { title: 'Plans and reports', key: 'day,email', since: s => '&or=(plan_at.gte.' + s + ',report_at.gte.' + s + ',edited_at.gte.' + s + ')' },
  eng_reasons: { title: 'Reasons', key: 'key' },
  eng_activity: { title: 'Activity', key: 'id', since: 'at' },
};
const run = make(TABLES, { site: true, usageStep: 'sql/eng_step2_usage.sql' });      // (update-158) usage: the Portal's Sites → Storage (the one database of every site)
module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  allowed(req);
  const c = { url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: String(process.env.SUPABASE_SECRET_KEY || '') };
  if (!c.url || !c.key) throw fail(500, 'The Engineering server is not set up: SUPABASE_URL and SUPABASE_SECRET_KEY are missing in Vercel.');
  send(res, 200, await run(c, await readBody(req)));
});
module.exports.TABLES = TABLES;
