# RCL ERP – Engineering

The Engineering module of RCL ERP, built for 18B first (19-10-2026). **Phase 1:** the road and its works (set up by the Super
Admin), each person's daily plan and report, the dashboard, the strip chart, all reports, the reports and performance.

* **Sign-in only through the Portal.** The Portal sends the person here with a one-minute signed ticket (role: Super Admin,
  Engineering Admin or Engineering User of that site). Nobody signs in here.
* **A sign-in lasts 15 minutes** (23-10-2026; it was 12 hours): the open page asks the Portal for a fresh ticket every 10 minutes
  (`/api/go?…&json=1&renew=1` → `api/sso` with `renew`) and signs in again by itself. Whom the Super Admin removes in the Portal is
  out within 15 minutes ("You no longer have Engineering on this site"); a new role shows at the next renewal. Rig test:
  `test/renew.test.js` (one-address mode).
* **One database for every site** (the Supabase project `rcl-engineering`). Every row carries its site; VTR's work is never seen
  at 18B. **Change site** at the top of the dark menu goes to another of his sites through the Portal.

## What each person does
| Who | Pages |
|---|---|
| **User** | **My work** – his plan of today (and the next 7 days); his report of yesterday: for every plan line "Done as planned", "Other chainage / part" or "Not done", and why something is left; work outside the plan; a note. **Strip chart.** |
| **Admin** | also **Dashboard** (the work of the day before against its plan, who sent it when, what needs attention, today's program), **All reports** (day by day, work by work: time, %, sender, ✎), **Reports** (daily, weekly, 15 days, monthly – print), **Performance** (reports sent / missing / late / corrected, plan against done, who sent each work day by day). He may look at a person's day, not change it. |
| **Super Admin** | also **Set-up**: Road (the KML), Sides & widths, Works & layers, Mix design, Design, People & works. He may change any plan or report. |

* **A plan** is made for today or the next 7 days (the Super Admin: any day). It can be changed until the report of that day is
  in; every change is kept. A day gone by is reported as work outside the plan.
* **A report** is of a work day (today or before), usually sent the next morning. Work left needs a reason. A change after it was
  sent counts as a correction (✎) and the report as sent is kept. A report after 9 in the morning of the next day is "late".
* **Lines** of a plan or report: work, layer, side (LHS, Median, RHS, or "Both" = LHS + RHS), chainage from–to (works in metres)
  or a quantity (Nos, sq m, cum). Every line is checked: the work is given to him, the layer is the work's, the side is one the
  work is done on, the chainage is inside the road and "to" is after "from".
* **Two phones** never overwrite each other: a day is written only over the version that was read.
* **Reminder:** everyone given a work whose report of yesterday is not in sees "Submit report" from 9 to 20 h (and, when he
  allowed it, a browser notification every hour). The phone app reminds the same way.

## Set-up (Super Admin) – period by period, Active / Inactive
* **Road:** choose the KML (e.g. `ACAD-PN-II-18B_WITH_CHAINAGES.kml`). It is read in the browser (`public/kml.js`): every
  chainage label (8+000, 8+020 …) gets the place of its major tick on the centre line. 18B: 2654 points, 8+000 to 61+055 (the
  line measures 52.98 km for 53.055 km of chainage). Only the result is sent.
* **Sides & widths:** a side (LHS, Median, RHS …) on a stretch of chainage with its width.
* **Works & layers:** name, unit (m / Nos / sq m / cum), its layers bottom first with the thickness of each, the sides it is
  done on, shown in the strip chart or not, its order (which work lies above which).
* **Mix design / Design:** forms the Super Admin fills; saved = they apply from their "valid from".
* **New period** of an item from a date: the period running on that date ends the day before; nothing before it changes.
  A layer keeps its key in every period, so the days done keep their layer.
* **People & works:** everyone with Engineering on the site comes here at his first sign-in (or is added first); the Super Admin
  ticks the works each person does (more than one is fine).

## The strip chart
For each side, the colour of a place is the highest layer finished there (the order of the works, then the layers). Black
outline = done on the work day; dashed gold = today's program. "Progress as on" moves through the days. Progress by layer: km
done on each side and the per cent of the length of the sides the work is done on, and this month. 18B starts from zero (its
earlier progress is not known).

## The assistant (Mechanical's Ask) reads Engineering (28-10-2026, with Mechanical's update-185)
* Mechanical's Ask (the robot, web and phone app) answers about this site's Engineering too: the person's own work (plans, reports),
  the progress (the strip chart's layers), and – for the Admin and the Super Admin – the dashboard of a day, the report of a period and
  the performance. It asks Engineering itself – action `aiLook` of `api/eng.js` (`lib/ailook.js`) – with the person's own Engineering
  sign-in, through the same looks and checks as the pages. It only reads. No database step, no new setting.

## Parts
| Part | File |
|---|---|
| The page (dark menu, every page) | `public/index.html`; the KML reader `public/kml.js` |
| Sign-in with the Portal's ticket / who is signed in / sign out | `api/sso.js`, `api/me.js`, `api/logout.js` |
| The menu for the screen around it (`/menu.json` → `api/menu.js`, per person) | `api/menu.js` |
| Every action (set-up, plan, report, views) and its access | `api/eng.js` |
| The rules (lines, periods, figures, strip chart) | `lib/rules.js` |
| Database, ticket check, sign-ins, activity record | `lib/db.js`, `lib/portal.js`, `lib/session.js`, `lib/activity.js` |
| Database (run once in the Engineering Supabase) | `sql/eng_step1.sql`; `sql/eng_step2_usage.sql` (update-158: how full the database is – the Portal's Sites → Storage) |

## A user's report only of today or yesterday (29-10-2026 – urgent; no database step)
Asked: "admin ani super admin fkt back dated entry kru shakto baki konich nahi … modual wise"; his answer for Engineering: a user's report
of yesterday and today. **An Engineering User** sends or changes the report only of **today or yesterday** (`A.reportSave`, refused in his
words); the page shows the report of an earlier day without the form and says who sends it. **The Engineering Admin and the Super Admin:**
any day. The plan as before (today and the next 7 days; the Super Admin any day). With Mechanical update-187, the Store and the phone app.
Tests: unit; rig `test/today.test.js` (the rule on) 3/3; `test/api.test.js` 89/90 and `test/browser.test.js` 23/24 with `ENG_DAY_RULE=off`
(only the rig sets it – its story is dated over a week; the one line of each fails the same on main).
**Put right the same day (the review; with Mechanical update-188):** a page left open past midnight reads "today" again from the server
on the new day (`dayCheck` – every 10 minutes and when the page comes back to the front), so a user's today / yesterday follow the day;
`ENG_DAY_RULE=off` is never obeyed on Vercel (`process.env.VERCEL`).

## 🎙 Speak into a box (29-10-2026; no database step)
Asked: "jithe jithe type krun entry hotat … tithe voice mick banaw user apla voice madhe bolel … text madhe add krel ok hindi english
marathi"; his answers: the app AND the website; words and numbers. `public/voice.js` (the same file in the Store and the Portal; inline in
Mechanical): a box where an entry is typed (text, number, phone, a note), when it is in use, shows a 🎙 at its right end. Pressed, the
browser's own speech recognition (Chrome / Edge) listens in **मराठी / हिंदी / English** (chips while it listens; the one chosen is
kept in the browser). What was said goes in as if typed (the page's input / change): a number box gets the **number** – "साडे तीन हजार"
→ 3500, "बारा पॉइंट पाच" → 12.5, "डेढ़ सौ" → 150 (`RclVoice.toNumber`); a phone box the digits; a text box the words at the cursor.
Never in a password box or where a page says `data-novoice`; a browser that cannot listen: no 🎙. `vercel.json` now lets the site's own
pages use the microphone (`microphone=(self)`; the camera and the place stay off). Tests: unit (the number cases, the page loads it, the
rule); `test/voice.browser.test.js` 21/21 (a stand-in for the browser's listening); the rig's `api.test.js` and `browser.test.js` the
same as on main (89/1 and 23/1 – the one each that fails on main too comes from the rig's state).

## Live: another person's report or plan shows by itself (29-10-2026; no database step)
Asked: "supabase 2 second cha vishay … saving mahtwachi aahe but data real time disne user laa he pn mahtwach aahe … niyojan tu kar". On
the views that show other people's work – **Dashboard, Strip chart, All reports** – the page asks only "what changed at this site?"
(`live` – the newest row of the site's activity, by its index (site, at); every save notes one, the unit test checks it) every 2 s while
it is used, every 15 s after 5 quiet minutes, nothing while the tab is hidden, at once when seen again – and reads its view again only
when it changed. The server answers it from one read in 2 s for every open page of the site, **without** the site's whole read (`C`);
its own save reads it again at once. My work (a plan or a report being typed) and the Set-up are never redrawn by it; a dialog open:
after it. Tests: unit; rig `test/live.test.js` 7/7 (the Dashboard read again within 4 s of a save at its site, not of another site's;
hidden tab; My work nothing); `api.test.js` 89/1 and `browser.test.js` 23/1 – as main. (The phone app has no Engineering screens yet – only its assistant reads Engineering.)

## Settings (Vercel → the Engineering project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `SUPABASE_URL` | the Engineering project's address: `https://peiddqvyxzujgpwuntwj.supabase.co` |
| `SUPABASE_SECRET_KEY` | the Engineering project's secret key (Supabase → Project Settings → API Keys) |
| `PORTAL_URL` | the same value as in the Store project |
| `PUBLIC_URL` | `https://oneclicksolution-erp.vercel.app/engineering` |
| `BACKUP_EXPORT_SECRET` | (with Mechanical's update-157) a long secret word (at least 24 letters and digits) – the SAME value in rclerp and rcl-portal. Mechanical's nightly backup asks `/api/backup-export` with it for one site's Engineering rows (into that site's backup Sheet). Not set = nothing is given. |

## One address
Mechanical's `vercel.json` rewrites `/engineering/…` to this project, so Engineering opens inside Mechanical's screen (its own
menu and top bar hidden – `?embed=1`), like the Store. Every address of the page is relative. `/menu.json` gives the pages of
the person signed in; Ctrl K in Mechanical searches Engineering's pages, works and people (`window.rclModule`).

## A Preview = the staging (TEST) copy (21-10-2026, as Mechanical, the Portal and the Store)
* On a Vercel **Preview** (`VERCEL_ENV=preview`), `lib/preview.js` asks the database first: it must have the row
  `app_settings.THIS_IS_A_TEST_DATABASE = 'yes'`. Only the staging database has it (the live Engineering database has no
  `app_settings` table at all).
* A database without it is refused with 503, "This is a Preview …". Nothing is read or written. The page shows an orange TEST band.
* Live (`production`) asks nothing.
* For a Preview of Engineering: its Preview settings in Vercel point to the staging database, where `sql/eng_step1.sql` is run
  once too (after Mechanical's `staging/rcl_staging_all.sql`, which puts the mark in).

## Tests (local test rig only – never the live databases)
```
timeout 300 node --test test/unit.test.js     # no database (ENG_KML=<the 18B KML> also reads the real drawing)
timeout 300 node test/api.test.js             # rig (plain mode): Portal :3010, Engineering :3040, database :3108
timeout 400 node test/browser.test.js         # rig + Chromium, after api.test.js; pictures in test/shots/
timeout 300 node test/inmech.test.js          # rig in gateway mode (GATEWAY=1 PORTAL=1 bash rig/all.sh), after api.test.js
timeout 300 node test/cache155.test.js        # rig: the site's set-up read once for several looks, lost answers (own server :3041; SRC=<tree>)
```

## Fewer reads, no second copy (24-10-2026, with Mechanical's update-155)
* **What the site has set up** (masters, road, who does which work, people – at least 4 reads) is read once for the looks that
  come within 2 seconds of each other – a page that opens asks several at once (`api/eng.js` `ctxFor` – a copy per request, per
  site; 2 seconds, so another person's save shows within the owner's 2 seconds). Every save reads it afresh, as before, and its
  end drops the shared read.
* **The looks answer "the same" / only what changed** to the page (`lib/delta.js` – the same file as Mechanical's; `lib/http.js`
  `sendKept`; the page's `look`): kept in the page's memory only, checked against the server's fingerprint, emptied at every
  sign-in and sign-out.
* **A new row is not sent twice:** after no answer at all from the database it may have been saved – the person is told to look
  (no second copy); a change or a delete is asked again as before, and so is a new row that never left this server (no
  connection at all).
* **A tab in the background does not renew the sign-in;** the reminder is asked only from 9 to 20 h (was all night too).
