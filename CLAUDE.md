# CLAUDE.md – RCL ERP Engineering module

Read this first, then `README.md`. The same owner and rules as the Mechanical module (`rclerp/CLAUDE.md`), the Portal and the
Store; the short version:

## The owner and how to talk to him
* Sujit Mule, MD of Rachana Construction Limited (RCL).
* **Reply in Marathi (Devanagari).** Answer first. Simple. One step at a time.
* "adhi charcha kar" = discuss first, no code. "fkt check kr" = only check, change nothing.

## Rules
1. **Exactly what he asks, nothing extra.** He decides each step.
2. **Simple screens**, clear at a glance.
3. **Live and business-critical:** never delete, reset or overwrite live data; no destructive SQL; no push to `main` / deploy
   without his yes; a database change is justified and approved separately and he runs the SQL himself (in the Engineering
   Supabase); existing features and permissions keep working.
4. **Evidence, not claims:** read the code, run the tests, say plainly what was not run or not verified.
5. **Every shell / test / network command has a `timeout`.** A hang: run the one test alone, find the case, fix it. Never just re-run.
6. **Fix a thing everywhere it is used** – also in the phone app (`rcl-mobile`): whatever is added here gets its app screen in
   the same piece of work.
7. **The repository is PUBLIC** for now: no secret, key, password or personal data in any file (the site's KML stays out of
   the repository too). Keys live only in Vercel → Environment Variables and are never pasted in chat.
8. Work arrives as a branch + pull request; he merges; Vercel deploys.

## Decisions that shape this repository (asked 18/19-10-2026; full list: `rclerp/architecture/RCL_ERP_Decisions.md`)
* **One Supabase project for Engineering for EVERY site** (`rcl-engineering`, Mumbai): every row carries its site; this server
  reads and writes only the site of the person's sign-in.
* **The Portal** is the one sign-in and the one place access is given (Engineering Admin / User per site; the Super Admin is
  the Portal's). Engineering trusts a Portal ticket only after checking its ES256 signature with `/api/jwks`, its `aud`
  ("engineering"), `exp`, and that its `jti` is used once.
* **The Super Admin fills everything** (road from the KML, sides and widths, works and their layers and thickness, mix designs,
  designs, who does which work) – **period by period** (valid from / to) and **Active / Inactive**, like machinery. A day is
  always measured with the version of that day.
* **A person's day:** he makes his own plan; the next day he reports it – done, what is left and why; work outside the plan.
  Reasons have no fixed list: what people type is suggested to the others. Only the sender or the Super Admin changes a report
  (kept as ✎ with the earlier version).
* **Reminder:** a person given a work whose report of yesterday is not in gets "Submit report" every hour, 9 to 20 h.
* **Views:** a User sees his own work and the strip chart; the Admin and the Super Admin see the dashboard, all reports, the
  reports (daily, weekly, 15 days, monthly) and performance.
* **Later (not built):** Phase 2 – the detailed PQC day (checks every 2 hours, materials, photos, RMC PDF); Phase 3 – machinery
  request (needs his answers: who approves, do drivers have the app, where the vehicle's place comes from).
