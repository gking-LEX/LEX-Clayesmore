-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- LEX cloud snapshots (v179). For the 2026-27 project (tpyeybxopmbvrfaffyik).
-- Run part (a) in the Supabase SQL editor BEFORE merging v179. Safe to run more than once.
--
-- One row per snapshot: the full backup (the same content as "Download full backup", less this
-- browser's local snapshots), gzipped and base64-encoded in `data`, with counts in `summary`.
-- Through the API key the table takes inserts and reads only: no update, no delete. Old rows
-- are removed by the database itself, after each insert: it keeps the 14 newest daily snapshots
-- and the 20 newest others (before an action, or taken by hand), per year system (pfx).
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (a) INSTALL
-- ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.lex_snapshots (
  id           uuid primary key,
  pfx          text not null,                                   -- year system: lex12
  kind         text not null check (kind in ('daily', 'action', 'manual')),
  day          date not null,                                   -- the school's date (Europe/London) it was taken
  created_at   timestamptz not null default now(),
  created_by   text,                                            -- signed-in email
  device       text,                                            -- e.g. "Chrome on Windows"
  app_version  text,
  reason       text check (reason is null or char_length(reason) <= 200),
  summary      jsonb,
  size_bytes   integer,
  data         text not null                                    -- gzip, then base64
);
-- One daily snapshot per day per system: when two admins load at once, the second insert is
-- refused (23505) and the app treats it as "today's is already taken".
create unique index if not exists lex_snapshots_one_daily on public.lex_snapshots (pfx, day) where kind = 'daily';
create index if not exists lex_snapshots_pfx_created on public.lex_snapshots (pfx, created_at desc);

alter table public.lex_snapshots enable row level security;
drop policy if exists "lex_snapshots insert" on public.lex_snapshots;
create policy "lex_snapshots insert" on public.lex_snapshots for insert to anon, authenticated with check (true);
drop policy if exists "lex_snapshots read" on public.lex_snapshots;
create policy "lex_snapshots read" on public.lex_snapshots for select to anon, authenticated using (true);
revoke update, delete, truncate on public.lex_snapshots from anon, authenticated;
grant select, insert on public.lex_snapshots to anon, authenticated;

-- The time is the database's, not the device's (a device's clock can be wrong). clock_timestamp,
-- not now(): now() is the same for every row in one transaction, which would leave the order of
-- snapshots taken together (the self-test below) to chance.
create or replace function public.lex_snapshots_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists lex_snapshots_stamp on public.lex_snapshots;
create trigger lex_snapshots_stamp before insert on public.lex_snapshots for each row execute function public.lex_snapshots_stamp();

-- Retention, after every insert: the 14 newest daily and the 20 newest others, per system.
-- security definer: it deletes as the table's owner, so the API key itself never can.
create or replace function public.lex_snapshots_prune() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lex_snapshots s
  using (select id, kind,
                row_number() over (partition by pfx, (kind = 'daily') order by created_at desc, id) as rn
           from public.lex_snapshots) r
  where s.id = r.id and r.rn > case when r.kind = 'daily' then 14 else 20 end;
  return null;
end $$;
drop trigger if exists lex_snapshots_prune on public.lex_snapshots;
create trigger lex_snapshots_prune after insert on public.lex_snapshots for each statement execute function public.lex_snapshots_prune();

-- v178 lock: every lex_ table, the new one included.
select public.lex_lock_attach_all();


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (f) SELF-TEST (optional, after (a)). Saves nothing: it ends with a deliberate error, which
--     undoes everything it did. Read the result in that error message. Expect ok x6, no FAIL.
--     It works on a separate system name (lex12-selftest), so real snapshots are not counted.
-- ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare r text := ''; n int; nd int; sid uuid := gen_random_uuid(); i int;
begin
  perform set_config('request.headers', '{"x-lex-version":"179","user-agent":"self-test"}', true);
  execute 'set local role anon';                                                    -- as the app's key

  insert into public.lex_snapshots (id, pfx, kind, day, reason, data) values (sid, 'lex12-selftest', 'manual', current_date, 'self-test', 'x');
  r := r || 'ok anon insert; ';
  select count(*) into n from public.lex_snapshots where id = sid;
  r := r || case when n = 1 then 'ok anon read; ' else 'FAIL anon read; ' end;

  begin update public.lex_snapshots set reason = 'changed' where id = sid; r := r || 'FAIL anon update accepted; ';
  exception when insufficient_privilege then r := r || 'ok anon update refused; '; end;
  begin delete from public.lex_snapshots where id = sid; r := r || 'FAIL anon delete accepted; ';
  exception when insufficient_privilege then r := r || 'ok anon delete refused; '; end;

  for i in reverse 16..1 loop                                                       -- 16 daily (yesterday newest), 22 others
    insert into public.lex_snapshots (id, pfx, kind, day, data) values (gen_random_uuid(), 'lex12-selftest', 'daily', current_date - i, 'x');
  end loop;
  for i in 1..21 loop
    insert into public.lex_snapshots (id, pfx, kind, day, data) values (gen_random_uuid(), 'lex12-selftest', 'action', current_date, 'x');
  end loop;
  select count(*) filter (where kind = 'daily'), count(*) filter (where kind <> 'daily') into nd, n
    from public.lex_snapshots where pfx = 'lex12-selftest';
  r := r || case when nd = 14 and n = 20 then 'ok pruned to 14 + 20; ' else 'FAIL kept ' || nd || ' daily + ' || n || ' others; ' end;

  begin insert into public.lex_snapshots (id, pfx, kind, day, data) values (gen_random_uuid(), 'lex12-selftest', 'daily', current_date - 1, 'x');
    r := r || 'FAIL second daily for one day accepted; ';
  exception when unique_violation then r := r || 'ok one daily per day; '; end;

  execute 'reset role';
  raise exception 'LEX SNAPSHOTS SELF-TEST — nothing was saved. %', r;
end $$;


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- Useful while you are away: what is there, without the data column.
-- ───────────────────────────────────────────────────────────────────────────────────────────
select created_at, kind, reason, created_by, device, app_version, size_bytes, summary
from public.lex_snapshots where pfx = 'lex12' order by created_at desc;


-- ───────────────────────────────────────────────────────────────────────────────────────────
-- (e) UNINSTALL. Deletes every cloud snapshot. Download any you want to keep first.
-- ───────────────────────────────────────────────────────────────────────────────────────────
-- drop table if exists public.lex_snapshots;
-- drop function if exists public.lex_snapshots_prune();
-- drop function if exists public.lex_snapshots_stamp();
