-- =====================================================================
-- RCL ERP – ENGINEERING, step 1: everything the module keeps (19-10-2026).
-- Run ONCE in the Engineering Supabase project (rcl-engineering – one project for EVERY site; every row carries its site).
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely: it only ADDS; nothing is changed or deleted.
--
--   eng_roads     the road of a site: its chainage line from the KML (a point every 20 m: chainage, longitude, latitude)
--   eng_masters   what the Super Admin sets, PERIOD BY PERIOD (valid from / to) and Active / Inactive:
--                   work   – a work and its layers (name, unit, thickness of each layer, its sides, shown in the strip chart)
--                   side   – a side of the road (LHS / Median / RHS …) on a stretch of chainage, with its width
--                   mix    – a mix design (PQC, DLC …): what goes into one unit
--                   design – a design (dowel bar, tie bar …): its sizes
--                 a work done on a day is measured with the version of that day; a new period never changes the past
--   eng_assign    which person does which work (the Super Admin decides)
--   eng_people    the people of the module on a site (who signed in, or added by the Super Admin)
--   eng_days      one person's day: his PLAN (the lines he plans) and his REPORT of it (what was done, what is left and why,
--                 work outside the plan); who sent it when, every change after it (✎)
--   eng_reasons   the reasons people typed for work left (suggested to the others)
--   eng_sessions, eng_tickets, eng_activity – the sign-ins (a fingerprint only), the Portal tickets used, who did what
-- Every table is for the server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop table public.eng_activity, public.eng_tickets, public.eng_sessions,
--   public.eng_reasons, public.eng_days, public.eng_people, public.eng_assign, public.eng_masters, public.eng_roads;
-- =====================================================================
create table if not exists public.eng_roads (
  site text not null, code text not null default 'MAIN', name text not null,
  ch_from numeric not null, ch_to numeric not null, stations jsonb not null, source text not null default '',
  updated_by text not null default '', updated_at timestamptz not null default now(),
  primary key (site, code)
);
create table if not exists public.eng_masters (
  id bigserial primary key, site text not null,
  kind text not null check (kind in ('work', 'side', 'mix', 'design')), item text not null,
  data jsonb not null, valid_from date not null, valid_to date, active boolean not null default true,
  created_by text not null default '', created_at timestamptz not null default now(),
  updated_by text not null default '', updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create unique index if not exists eng_masters_period on public.eng_masters (site, kind, item, valid_from);
create table if not exists public.eng_assign (
  site text not null, email text not null, work text not null, active boolean not null default true,
  created_by text not null default '', created_at timestamptz not null default now(),
  updated_by text not null default '', updated_at timestamptz not null default now(),
  primary key (site, email, work)
);
create table if not exists public.eng_people (
  site text not null, email text not null, name text not null default '', role text not null default 'user',
  added_by text not null default '', first_seen timestamptz, last_seen timestamptz,
  primary key (site, email)
);
create table if not exists public.eng_days (
  site text not null, day date not null, email text not null, name text not null default '',
  plan jsonb not null default '[]', plan_at timestamptz, plan_by text not null default '',
  report jsonb, report_at timestamptz, report_by text not null default '',
  edited_at timestamptz, edited_by text not null default '', edits integer not null default 0,
  history jsonb not null default '[]', ver integer not null default 0,
  primary key (site, day, email)
);
create index if not exists eng_days_site_day on public.eng_days (site, day);
create table if not exists public.eng_reasons (
  site text not null, key text not null, text text not null, uses integer not null default 1,
  first_by text not null default '', last_used timestamptz not null default now(),
  primary key (site, key)
);
create table if not exists public.eng_sessions (
  id_hash text primary key, site text not null, email text not null, name text not null default '',
  role text not null check (role in ('super', 'admin', 'user')), info jsonb not null default '{}',
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index if not exists eng_sessions_email on public.eng_sessions (email);
create table if not exists public.eng_tickets (jti text primary key, expires_at timestamptz not null);
create table if not exists public.eng_activity (
  id bigserial primary key, at timestamptz not null default now(), site text not null, email text not null default '',
  action text not null, target text not null default '', detail jsonb
);
create index if not exists eng_activity_at on public.eng_activity (site, at desc);

do $$ declare t text; begin
  foreach t in array array['eng_roads', 'eng_masters', 'eng_assign', 'eng_people', 'eng_days', 'eng_reasons', 'eng_sessions', 'eng_tickets', 'eng_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.eng_masters_id_seq, public.eng_activity_id_seq from public, anon, authenticated;
grant usage, select on sequence public.eng_masters_id_seq, public.eng_activity_id_seq to service_role;

notify pgrst, 'reload schema';
select 'Engineering step 1 done · roads ' || (select count(*) from public.eng_roads) || ' · masters ' || (select count(*) from public.eng_masters) || ' · days ' || (select count(*) from public.eng_days) as done;
