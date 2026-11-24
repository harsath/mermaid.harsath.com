-- Shares become end-to-end encrypted: the server stores only ciphertext.
-- Run after 0001 (SQL Editor -> paste -> Run). Safe to re-run.
--
-- The browser picks a random secret, keeps it in the link after '#', and derives
-- from it both the share id (sent here) and the AES key (never sent). So the id
-- is now chosen by the client and is a 32-char hex hash.

-- Rows from 0001 hold plaintext diagrams; drop them.
delete from public.shares where id !~ '^[0-9a-f]{32}$';

alter table public.shares drop column if exists code;
alter table public.shares add column if not exists data text not null
  check (length(data) <= 140000 and data ~ '^[A-Za-z0-9_-]+$');  -- base64url(iv || ciphertext)
alter table public.shares drop constraint if exists shares_id_check;
alter table public.shares add constraint shares_id_check check (id ~ '^[0-9a-f]{32}$');

drop function if exists public.create_share(text, int);
drop function if exists public.get_share(text);

-- Stores an encrypted diagram and returns when it expires. p_days must be one of
-- the offered lifetimes. A global cap of 500 shares per hour stops a script
-- filling the database.
create or replace function public.create_share(p_id text, p_data text, p_days int)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_expires timestamptz := now() + make_interval(days => p_days);
begin
  if p_days not in (3, 7, 30, 180) then raise exception 'bad_days'; end if;
  if (select count(*) from public.shares where created_at > now() - interval '1 hour') >= 500 then
    raise exception 'rate_limited';
  end if;
  insert into public.shares (id, data, expires_at) values (p_id, p_data, v_expires);  -- checks validate id/data
  return v_expires;
end $$;

-- Returns the ciphertext and its expiry, or nothing if it doesn't exist or expired.
create or replace function public.get_share(p_id text)
returns table (data text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.data, s.expires_at from public.shares s where s.id = p_id and s.expires_at > now();
$$;

revoke execute on function public.create_share(text, text, int) from public;
revoke execute on function public.get_share(text)               from public;
grant  execute on function public.create_share(text, text, int) to anon, authenticated;
grant  execute on function public.get_share(text)               to anon, authenticated;
