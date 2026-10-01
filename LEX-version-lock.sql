-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- LEX database lock against old copies (v178). For the 2026-27 project (tpyeybxopmbvrfaffyik).
-- Run each part in the Supabase SQL editor only when its step in the rollout plan says so.
--
-- What it does: every write the app makes through the API (the anon key) carries the app's
-- version in the header x-lex-version. A trigger on every lex_ table refuses an insert, update
-- or delete whose version is missing or below lex_config.min_app_version, but only while
-- lex_config.enforce is true. It ships with enforce = false, so installing it changes nothing.
--
-- Never refused:
--   * the SQL editor and the Table Editor (they do not go through the API);
--   * the service_role key;
--   * lex_log and lex_signins (audit tables): the version is recorded in client_version, and
--     version_blocked says whether the write would have been refused.
-- Every API write is also counted in lex_lock_seen (table, version, browser, last seen), so you
-- can see which old copies are still writing BEFORE switching the lock on.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (a) INSTALL. Safe to run more than once. Changes nothing for the app (enforce = false).
-- ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.lex_config (
  id              int primary key default 1 check (id = 1),
  min_app_version numeric not null default 0,
  enforce         boolean not null default false,
  updated_at      timestamptz not null default now()
);
insert into public.lex_config (id) values (1) on conflict (id) do nothing;
alter table public.lex_config enable row level security;
drop policy if exists "lex_config read" on public.lex_config;
create policy "lex_config read" on public.lex_config for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.lex_config from anon, authenticated;
grant select on public.lex_config to anon, authenticated;

-- Which copies are writing: one row per table + version + browser.
create table if not exists public.lex_lock_seen (
  tbl            text not null,
  client_version text not null,          -- '' = no version sent (a copy older than v178)
  user_agent     text not null,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  n              bigint not null default 1,
  primary key (tbl, client_version, user_agent)
);
alter table public.lex_lock_seen enable row level security;
drop policy if exists "lex_lock_seen read" on public.lex_lock_seen;
create policy "lex_lock_seen read" on public.lex_lock_seen for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.lex_lock_seen from anon, authenticated;
grant select on public.lex_lock_seen to anon, authenticated;

-- Audit columns on the two tables that are never refused.
do $$
declare t text;
begin
  foreach t in array array['lex_log', 'lex_signins'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists client_version numeric', t);
      execute format('alter table public.%I add column if not exists version_blocked boolean', t);
    end if;
  end loop;
end $$;

-- The version this API request carries: '178' or 'v178' -> 178. NULL when missing or malformed.
create or replace function public.lex_client_version() returns numeric
language sql stable security definer set search_path = public as $$
  select nullif(substring(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-lex-version', '')
                          from '^\s*v?([0-9]+(\.[0-9]+)?)\s*$'), '')::numeric
$$;

-- true when the write must be refused; NULL when the lock does not apply (not an API request,
-- service_role, or no lex_config row).
create or replace function public.lex_lock_decision() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare h text; cfg record; v numeric;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return null; end if;                       -- SQL editor / Table Editor
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role' then return null; end if;
  select min_app_version, enforce into cfg from public.lex_config where id = 1;
  if not found then return null; end if;
  v := public.lex_client_version();
  return cfg.enforce and (v is null or v < cfg.min_app_version);
end $$;

-- Statement-level: one check per request, and it fires even when a PATCH or DELETE matches no rows.
create or replace function public.lex_version_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text; cfg record; v numeric;
begin
  h := current_setting('request.headers', true);
  if h is null or h = '' then return null; end if;
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role' then return null; end if;
  v := public.lex_client_version();
  begin                                                                   -- counting must never stop a write
    insert into public.lex_lock_seen as s (tbl, client_version, user_agent)
    values (tg_table_name, coalesce(v::text, ''), left(coalesce(h::json ->> 'user-agent', ''), 300))
    on conflict (tbl, client_version, user_agent) do update set last_seen = now(), n = s.n + 1;
  exception when others then null;
  end;
  if public.lex_lock_decision() then
    select min_app_version into cfg from public.lex_config where id = 1;
    raise exception using errcode = 'P0001', message = 'LEX_VERSION_BLOCKED',
      detail = format('min=%s client=%s table=%s', cfg.min_app_version, coalesce(v::text, 'none'), tg_table_name),
      hint = 'This copy of LEX is out of date. Reload (Ctrl+Shift+R).';
  end if;
  return null;
end $$;

-- Row-level, audit tables only: record the version, never refuse.
create or replace function public.lex_version_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.client_version := public.lex_client_version();
  new.version_blocked := public.lex_lock_decision();
  return new;
end $$;

-- Attach to every lex_ table. Re-run "select public.lex_lock_attach_all();" after creating a new
-- lex_ table, so it is locked too.
create or replace function public.lex_lock_attach_all() returns text
language plpgsql security definer set search_path = public as $$
declare t record; locked text := ''; recorded text := '';
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and left(c.relname, 4) = 'lex_'
             and c.relname not in ('lex_config', 'lex_lock_seen') order by c.relname
  loop
    execute format('drop trigger if exists lex_version_gate on public.%I', t.relname);
    execute format('drop trigger if exists lex_version_record on public.%I', t.relname);
    if t.relname in ('lex_log', 'lex_signins') then
      execute format('create trigger lex_version_record before insert on public.%I for each row execute function public.lex_version_record()', t.relname);
      recorded := recorded || t.relname || ' ';
    else
      execute format('create trigger lex_version_gate before insert or update or delete on public.%I for each statement execute function public.lex_version_gate()', t.relname);
      locked := locked || t.relname || ' ';
    end if;
  end loop;
  return 'locked: ' || locked || '| recorded only: ' || recorded;
end $$;

revoke execute on function public.lex_client_version(), public.lex_lock_decision(), public.lex_lock_attach_all() from public, anon, authenticated;

select public.lex_lock_attach_all();
-- Expect: locked: lex_attendance lex_block_members lex_block_sets lex_data lex_date_overrides
--         lex_feedback lex_overview lex_sa | recorded only: lex_log lex_signins
-- (exact list = whatever lex_ tables this project has)


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (f) SELF-TEST (optional, after (a)). Saves nothing: it ends with a deliberate error, which
--     undoes everything it did. Read the result in that error message.
--     Expect: ok x7 and no FAIL.
-- ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare r text := ''; k text := 'lex12-__lock_selftest__'; cv numeric; vb boolean;
begin
  update public.lex_config set enforce = true, min_app_version = 178 where id = 1;

  perform set_config('request.headers', '{"user-agent":"self-test"}', true);          -- no version
  begin insert into public.lex_data (key, value, updated_at) values (k, '{}', now()); r := r || 'FAIL no version accepted; ';
  exception when others then r := r || case when sqlerrm = 'LEX_VERSION_BLOCKED' then 'ok no version refused; ' else 'FAIL ' || sqlerrm || '; ' end; end;

  perform set_config('request.headers', '{"x-lex-version":"177"}', true);              -- old version
  begin insert into public.lex_data (key, value, updated_at) values (k, '{}', now()); r := r || 'FAIL old version accepted; ';
  exception when others then r := r || case when sqlerrm = 'LEX_VERSION_BLOCKED' then 'ok old version refused; ' else 'FAIL ' || sqlerrm || '; ' end; end;

  begin delete from public.lex_data where key = k; r := r || 'FAIL old-version delete accepted; ';  -- matches no rows: still refused
  exception when others then r := r || case when sqlerrm = 'LEX_VERSION_BLOCKED' then 'ok old delete refused; ' else 'FAIL ' || sqlerrm || '; ' end; end;

  perform set_config('request.headers', '{"x-lex-version":"178"}', true);              -- current version
  begin insert into public.lex_data (key, value, updated_at) values (k, '{}', now()); r := r || 'ok current accepted; ';
  exception when others then r := r || 'FAIL current refused: ' || sqlerrm || '; '; end;

  perform set_config('request.headers', '{}', true);                                   -- lex_log: kept, version recorded
  insert into public.lex_log (id, pfx, ts, action) values (gen_random_uuid(), 'lex12', now(), 'LOCK_SELFTEST')
    returning client_version, version_blocked into cv, vb;
  r := r || case when cv is null and vb then 'ok log kept and marked; ' else 'FAIL log record ' || coalesce(cv::text,'null') || '/' || coalesce(vb::text,'null') || '; ' end;

  update public.lex_config set enforce = false where id = 1;                            -- switched off
  begin update public.lex_data set updated_at = updated_at where key = k; r := r || 'ok off accepts no version; ';
  exception when others then r := r || 'FAIL off refused: ' || sqlerrm || '; '; end;

  perform set_config('request.headers', '', true);                                     -- SQL editor
  update public.lex_config set enforce = true where id = 1;
  begin update public.lex_data set updated_at = updated_at where key = k; r := r || 'ok SQL editor never refused; ';
  exception when others then r := r || 'FAIL SQL editor refused: ' || sqlerrm || '; '; end;

  raise exception 'LEX LOCK SELF-TEST — nothing was saved. %', r;
end $$;


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- BEFORE SWITCHING ON: which copies are still writing without a current version?
-- Rows with client_version '' (no version) or below the minimum you are about to set, seen
-- recently, are copies that have not reloaded. Wait until there are none (or none recent).
-- ───────────────────────────────────────────────────────────────────────────────────────────
select client_version, user_agent, string_agg(tbl, ', ' order by tbl) as tables, max(last_seen) as last_seen, sum(n) as writes
from public.lex_lock_seen where last_seen > now() - interval '3 days'
group by client_version, user_agent order by max(last_seen) desc;


-- (b) SWITCH ON at the current version:
update public.lex_config set min_app_version = 178, enforce = true, updated_at = now() where id = 1;

-- (c) RAISE THE MINIMUM after a release has been live long enough (replace 179):
update public.lex_config set min_app_version = 179, updated_at = now() where id = 1;

-- (d) SWITCH OFF in an emergency (every copy can save again at once; no reload needed):
update public.lex_config set enforce = false, updated_at = now() where id = 1;


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (e) UNINSTALL. Removes the triggers, functions and the two lock tables. Keeps the
--     client_version / version_blocked columns on lex_log and lex_signins (history); the last
--     two lines (commented) drop those too.
-- ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare t record;
begin
  for t in select distinct event_object_table as tbl from information_schema.triggers
           where trigger_schema = 'public' and trigger_name in ('lex_version_gate', 'lex_version_record')
  loop
    execute format('drop trigger if exists lex_version_gate on public.%I', t.tbl);
    execute format('drop trigger if exists lex_version_record on public.%I', t.tbl);
  end loop;
end $$;
drop function if exists public.lex_lock_attach_all();
drop function if exists public.lex_version_gate();
drop function if exists public.lex_version_record();
drop function if exists public.lex_lock_decision();
drop function if exists public.lex_client_version();
drop table if exists public.lex_lock_seen;
drop table if exists public.lex_config;
-- alter table public.lex_log drop column if exists client_version, drop column if exists version_blocked;
-- alter table public.lex_signins drop column if exists client_version, drop column if exists version_blocked;
