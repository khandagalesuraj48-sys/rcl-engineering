-- =====================================================================
-- RCL ERP – ENGINEERING, step 4: the MEASUREMENT BOOK (10-11-2026).
-- Asked 10-11-2026 (Engineering 2B): "Measurement Book – पूर्ण झालेल्या layer चे काम आपोआप (chainage × रुंदी × जाडी) → MB
-- (मोजले / तपासले) → RA bill साठी". Written fresh for RCL – no code of any other project.
-- Run ONCE in the Engineering Supabase project (rcl-engineering – one project for EVERY site; every row carries its site), AFTER
-- step 3 (sql/eng_step3_qc_hindrance.sql – the MB page numbers come from its eng_numbers / eng_next_no).
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely: it only ADDS; nothing is changed or deleted.
-- Before it is run, Engineering works exactly as before (the Measurement Book page says this step is needed).
--
--   eng_mb        an MB page of a site: MB-0001 … (numbered by eng_next_no(site, 'MB') of step 3 – never given twice), one work and
--                 layer, the days of the reports it was made from, the date it was measured, its LINES (each stretch: the report it
--                 came from, side, chainage, length × width × thickness = the quantity and its unit, the masters' width / thickness
--                 and the ones measured with a remark, the IE's RFI), its status (Measured → Check-measured; or Sent back → corrected
--                 → Measured again), who measured / sent back / check-measured it and when; every change kept (history)
--   eng_mb_put()  saves an MB page in one step, only over the version that was read: the same stretch of a layer on a side
--                 (overlapping chainage) – or a report line without chainage – is never in two MB pages, also when two people save
--                 at the same moment (one save of a site at a time); a check-measured page is never changed
-- Every table is for the server only: row level security on, nothing for anon / authenticated.
-- Rollback (only while nothing is entered): drop function public.eng_mb_put(text, text, integer, jsonb); drop table public.eng_mb;
-- =====================================================================
do $$ begin
  if to_regclass('public.eng_numbers') is null or to_regprocedure('public.eng_next_no(text, text)') is null then
    raise exception 'Run sql/eng_step3_qc_hindrance.sql first (the MB page numbers come from its eng_numbers / eng_next_no).';
  end if;
end $$;

create table if not exists public.eng_mb (
  site text not null, no text not null,
  work text not null, layer text not null default '',
  from_day date not null, to_day date not null, mb_day date not null,
  status text not null default 'Measured' check (status in ('Measured', 'Sent back', 'Check-measured')),
  note text not null default '', lines jsonb not null default '[]',
  measured_by text not null default '', measured_name text not null default '', measured_at timestamptz,
  back_by text not null default '', back_name text not null default '', back_at timestamptz, back_why text not null default '',
  checked_by text not null default '', checked_name text not null default '', checked_at timestamptz, chk_day date,
  chk_remark text not null default '',
  created_by text not null default '', created_at timestamptz not null default now(),
  updated_by text not null default '', updated_at timestamptz not null default now(),
  history jsonb not null default '[]', ver integer not null default 1,
  primary key (site, no),
  check (to_day >= from_day),
  check (chk_day is null or chk_day >= mb_day)
);
create index if not exists eng_mb_layer on public.eng_mb (site, work, layer);
create index if not exists eng_mb_day on public.eng_mb (site, mb_day);

-- p_ver 0 = a new page; else the version that was read. Answers the page saved, or { "clash": … } (that stretch is in another page),
-- or { "changed": true } (someone saved it meanwhile, or it is check-measured)
create or replace function public.eng_mb_put(p_site text, p_no text, p_ver integer, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.eng_mb; hit record;
begin
  perform pg_advisory_xact_lock(hashtext('eng_mb ' || p_site));
  r := jsonb_populate_record(null::public.eng_mb, p_row);
  r.site := p_site; r.no := p_no;
  select m.no as no, a->>'side' as side, a->>'from' as ch_from, a->>'to' as ch_to into hit
    from public.eng_mb m, jsonb_array_elements(m.lines) a, jsonb_array_elements(r.lines) b
   where m.site = p_site and m.no <> p_no and m.work = r.work and m.layer = r.layer
     and (coalesce(a->>'side', '') = coalesce(b->>'side', '')
       or (a->>'side' = 'Both' and b->>'side' in ('LHS', 'RHS')) or (b->>'side' = 'Both' and a->>'side' in ('LHS', 'RHS')))
     and (((a->>'from') is not null and (b->>'from') is not null
           and (a->>'from')::numeric < (b->>'to')::numeric and (b->>'from')::numeric < (a->>'to')::numeric)
       or ((a->>'from') is null and (b->>'from') is null and a->>'src' = b->>'src'))
   limit 1;
  if found then
    return jsonb_build_object('clash', jsonb_build_object('no', hit.no, 'side', hit.side, 'from', hit.ch_from, 'to', hit.ch_to));
  end if;
  if p_ver = 0 then
    r.ver := 1; r.created_at := coalesce(r.created_at, now()); r.updated_at := now();
    insert into public.eng_mb select (r).*;
    return to_jsonb(r);
  end if;
  update public.eng_mb t set mb_day = r.mb_day, status = r.status, note = r.note, lines = r.lines,
      measured_by = r.measured_by, measured_name = r.measured_name, measured_at = r.measured_at,
      history = r.history, updated_by = r.updated_by, updated_at = now(), ver = p_ver + 1
   where t.site = p_site and t.no = p_no and t.ver = p_ver and t.status <> 'Check-measured'
  returning t.* into r;
  if not found then return jsonb_build_object('changed', true); end if;
  return to_jsonb(r);
end $$;
revoke all on function public.eng_mb_put(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.eng_mb_put(text, text, integer, jsonb) to service_role;

alter table public.eng_mb enable row level security;
revoke all on public.eng_mb from public, anon, authenticated;
grant select, insert, update, delete on public.eng_mb to service_role;

notify pgrst, 'reload schema';
select 'Engineering step 4 done · tables ' || (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'eng_mb')
  || ' of 1 · function ' || (select count(*) from pg_proc where proname = 'eng_mb_put') || ' of 1' as result;
