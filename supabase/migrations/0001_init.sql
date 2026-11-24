-- mermaid.harsath.com database setup.
-- Paste the whole file into Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run: every statement is create-if-missing or replace.
--
-- Model
--   shares  one row per shared diagram: the mermaid source and when it expires.
--           Clients never read the table directly; create_share / get_share are
--           the only way in, so a share can only be read by someone with its id.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.shares (
  id          text primary key check (id ~ '^[2-9a-hjkmnp-z]{12}$'),
  code        text not null check (length(code) between 1 and 100000),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists shares_expires_idx on public.shares (expires_at);
create index if not exists shares_created_idx on public.shares (created_at);

alter table public.shares enable row level security;
revoke all on public.shares from anon, authenticated;

-- Health check for the keep-alive workflow (stops the free project pausing).
create or replace function public.ping()
returns text language sql stable as $$ select 'pong' $$;

-- Stores a diagram and returns its id. p_days must be one of the offered
-- lifetimes. A global cap of 500 shares per hour stops a script filling the database.
create or replace function public.create_share(p_code text, p_days int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';  -- no 0/1/i/l/o
  v_id text;
  b bytea;
begin
  if p_days not in (3, 7, 30, 180) then raise exception 'bad_days'; end if;
  if p_code is null or length(p_code) not between 1 and 100000 then raise exception 'bad_code'; end if;
  if (select count(*) from public.shares where created_at > now() - interval '1 hour') >= 500 then
    raise exception 'rate_limited';
  end if;

  loop
    b := extensions.gen_random_bytes(12);
    v_id := '';
    for i in 0..11 loop
      v_id := v_id || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    insert into public.shares (id, code, expires_at)
    values (v_id, p_code, now() + make_interval(days => p_days))
    on conflict (id) do nothing;
    exit when found;
  end loop;
  return v_id;
end $$;

-- Returns the diagram and its expiry, or nothing if it doesn't exist or expired.
create or replace function public.get_share(p_id text)
returns table (code text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.code, s.expires_at from public.shares s where s.id = p_id and s.expires_at > now();
$$;

create or replace function public.cleanup_shares()
returns void language sql security definer set search_path = '' as $$
  delete from public.shares where expires_at < now();
$$;

revoke execute on function public.create_share(text, int) from public;
revoke execute on function public.get_share(text)         from public;
revoke execute on function public.cleanup_shares()        from public, anon, authenticated;
grant  execute on function public.create_share(text, int) to anon, authenticated;
grant  execute on function public.get_share(text)         to anon, authenticated;
grant  execute on function public.ping()                  to anon, authenticated;

-- Hourly: delete expired shares. cron.schedule with the same name replaces the job.
select cron.schedule('mermaid-cleanup', '7 * * * *', $job$ select public.cleanup_shares(); $job$);
