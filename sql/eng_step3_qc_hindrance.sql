-- =====================================================================
-- RCL ERP – ENGINEERING, step 3: RFI (the IE's approval of a layer) and the HINDRANCE register (09-11-2026).
-- Asked 09-11-2026 (Engineering 2A): RFI / layer approval – his answer: the next layer is STOPPED on a chainage until the IE
-- approves the layer below (the Super Admin can let it through, with a reason); the hindrance register for an extension of time.
-- Written fresh for RCL – no code of any other project.
-- Run ONCE in the Engineering Supabase project (rcl-engineering – one project for EVERY site; every row carries its site).
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely: it only ADDS; nothing is changed or deleted.
-- Before it is run, Engineering works exactly as before (the RFI and Hindrance pages say this step is needed; the rule is off).
--
--   eng_settings    a setting of a site (the RFI rule: on / off and from which date – the Super Admin sets it)
--   eng_numbers     the last number of each kind of document of a site (RFI-0001, H-0001 – never given twice)
--   eng_rfi         an RFI: a stretch of a layer (work, layer, side, chainage from–to) asked for inspection; the IE's answer
--                   (Approved / Rejected, his name, date, remark, the RFI's own reference) recorded by the Admin / Super Admin;
--                   every change kept (history)
--   eng_hindrance   a hindrance: from / to date, chainage stretch, side, the works it stops, what it is, the letter; Open / Closed
--   eng_next_no()   the next number of a kind for a site, in one step (two people at the same moment never get the same number)
-- Every table is for the server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop function public.eng_next_no(text, text);
--   drop table public.eng_hindrance, public.eng_rfi, public.eng_numbers, public.eng_settings;
-- =====================================================================
create table if not exists public.eng_settings (
  site text not null, key text not null, value jsonb not null default '{}',
  updated_by text not null default '', updated_at timestamptz not null default now(),
  primary key (site, key)
);
create table if not exists public.eng_numbers (
  site text not null, kind text not null, last integer not null default 0,
  primary key (site, kind)
);
create table if not exists public.eng_rfi (
  site text not null, no text not null,
  day date not null, work text not null, layer text not null default '', side text not null default '',
  ch_from numeric, ch_to numeric, qty numeric, note text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  ie_day date, ie_name text not null default '', ie_ref text not null default '', ie_remark text not null default '',
  asked_by text not null default '', asked_name text not null default '', asked_at timestamptz not null default now(),
  decided_by text not null default '', decided_at timestamptz,
  updated_by text not null default '', updated_at timestamptz not null default now(),
  history jsonb not null default '[]', ver integer not null default 1,
  primary key (site, no)
);
create index if not exists eng_rfi_layer on public.eng_rfi (site, work, layer, status);
create index if not exists eng_rfi_day on public.eng_rfi (site, day);
create table if not exists public.eng_hindrance (
  site text not null, no text not null,
  from_day date not null, to_day date, ch_from numeric, ch_to numeric, side text not null default '',
  works jsonb not null default '[]', kind text not null, detail text not null default '', letter text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  created_by text not null default '', created_name text not null default '', created_at timestamptz not null default now(),
  updated_by text not null default '', updated_at timestamptz not null default now(),
  history jsonb not null default '[]', ver integer not null default 1,
  primary key (site, no),
  check (to_day is null or to_day >= from_day)
);
create index if not exists eng_hindrance_days on public.eng_hindrance (site, from_day);

create or replace function public.eng_next_no(p_site text, p_kind text) returns integer
language sql security definer set search_path = public as $$
  insert into public.eng_numbers (site, kind, last) values (p_site, p_kind, 1)
  on conflict (site, kind) do update set last = public.eng_numbers.last + 1
  returning last;
$$;
revoke all on function public.eng_next_no(text, text) from public, anon, authenticated;
grant execute on function public.eng_next_no(text, text) to service_role;

do $$ declare t text; begin
  foreach t in array array['eng_settings', 'eng_numbers', 'eng_rfi', 'eng_hindrance'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

select 'Engineering step 3 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public'
  and table_name in ('eng_settings', 'eng_numbers', 'eng_rfi', 'eng_hindrance')) || ' of 4' as result;
