-- Snap Notes: security hardening (see docs/SECURITY_AUDIT.md).
--
-- This migration only adds objects and replaces the four API functions with
-- versions that keep their exact interface and behaviour for a legitimate
-- caller. No table, column or stored row is changed or removed.
--
--   1. Revoked sessions are refused. A Supabase access token stays
--      cryptographically valid until it expires (up to an hour), even after
--      "sign out" or "sign out on every device". Every API function now also
--      checks that the token's session still exists in auth.sessions, so a
--      token from a signed-out session can no longer read, write or delete
--      the account. Anonymous sessions (never used by the app) are refused too.
--   2. Storage is bounded per account. sync_push() rejects new or changed
--      records, one by one, once an account holds more rows or more text than
--      the limits below. Deletions are always accepted, so an account over the
--      limit can make room. Rejected records stay on the device (the app is
--      local-first); nothing already stored is touched.
--   3. AI generation has a project-wide cap as well as the per-account one,
--      so creating many accounts cannot run up an unbounded provider bill.
--
-- The limits live in snapnotes_private.settings and can be changed without a
-- migration, from the SQL editor:
--   update snapnotes_private.settings set value = 1000 where key = 'ai_project_per_day';

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table snapnotes_private.settings (
  key text primary key,
  value bigint not null check (value >= 0),
  description text not null
);

alter table snapnotes_private.settings enable row level security;
revoke all on table snapnotes_private.settings from public, anon, authenticated;

insert into snapnotes_private.settings (key, value, description) values
  ('ai_per_hour', 20, 'AI generation requests one account may make in any rolling hour.'),
  ('ai_per_day', 60, 'AI generation requests one account may make in any rolling 24 hours.'),
  ('ai_project_per_hour', 150,
   'AI generation requests all accounts together may make in any rolling hour.'),
  ('ai_project_per_day', 500,
   'AI generation requests all accounts together may make in any rolling 24 hours.'),
  ('storage_max_rows', 250000,
   'Rows (including deletion tombstones) one account may hold across all synced tables.'),
  ('storage_max_text_bytes', 26214400,
   'Bytes of synced text (deck names, card terms and definitions, session results, goal history) one account may hold.');

create function snapnotes_private.setting(name text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select value from snapnotes_private.settings where key = name;
$$;

-- ---------------------------------------------------------------------------
-- The signed-in account, from a session that still exists
-- ---------------------------------------------------------------------------

-- Returns the caller's account, or raises 28000 (reported to the app as "your
-- session has ended") when there is no user, the user is anonymous, or the
-- token's session has been signed out, revoked or has expired.
create function snapnotes_private.current_account()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  session uuid;
begin
  if account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if claims ->> 'is_anonymous' = 'true' then
    raise exception 'sign in with an email address' using errcode = '28000';
  end if;
  begin
    session := (claims ->> 'session_id')::uuid;
  exception when invalid_text_representation then
    session := null;
  end;
  if session is null or not exists (
    select 1 from auth.sessions s
    where s.id = session
      and s.user_id = account
      and (s.not_after is null or s.not_after > now())
  ) then
    raise exception 'your session has ended' using errcode = '28000', hint = 'session-ended';
  end if;
  return account;
end;
$$;

-- How much an account stores: every row it owns, and the bytes of the text it
-- has written. Read once per push.
create function snapnotes_private.account_usage(account uuid, out total_rows bigint, out text_bytes bigint)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) from public.decks where user_id = account)
      + (select count(*) from public.cards where user_id = account)
      + (select count(*) from public.card_progress where user_id = account)
      + (select count(*) from public.review_history where user_id = account)
      + (select count(*) from public.study_sessions where user_id = account)
      + (select count(*) from public.study_goals where user_id = account),
    (select coalesce(sum(octet_length(name)), 0) from public.decks
      where user_id = account and not deleted)
      + (select coalesce(sum(octet_length(term) + octet_length(definition)), 0) from public.cards
      where user_id = account and not deleted)
      + (select coalesce(sum(octet_length(results::text)), 0) from public.study_sessions
      where user_id = account and not deleted)
      + (select coalesce(sum(octet_length(changes::text)), 0) from public.study_goals
      where user_id = account and not deleted);
$$;

revoke all on all functions in schema snapnotes_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The API, replaced with the same signatures
-- ---------------------------------------------------------------------------

-- As in 20261114000000_study_analytics.sql, with the session check.
create or replace function public.sync_pull(
  since bigint default 0,
  max_rows integer default 500,
  kinds text[] default array['deck', 'card', 'progress', 'history']
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := snapnotes_private.current_account();
  row_limit integer := least(greatest(coalesce(max_rows, 500), 1), 1000);
  wanted text[] := coalesce(kinds, array['deck', 'card', 'progress', 'history']);
  latest bigint;
  page jsonb;
  more boolean;
  next_cursor bigint;
begin
  if since is null or since < 0 then
    raise exception 'since must be zero or more' using errcode = '22023';
  end if;

  -- Waits for a push to this account that is still running (see Milestone 8).
  perform 1 from public.sync_accounts where user_id = account for share;
  select revision into latest from public.sync_accounts where user_id = account;

  with changes as (
    select d.revision, snapnotes_private.deck_json(d) as item
    from public.decks d
    where d.user_id = account and d.revision > since and 'deck' = any (wanted)
    union all
    select c.revision, snapnotes_private.card_json(c)
    from public.cards c
    where c.user_id = account and c.revision > since and 'card' = any (wanted)
    union all
    select p.revision, snapnotes_private.progress_json(p)
    from public.card_progress p
    where p.user_id = account and p.revision > since and 'progress' = any (wanted)
    union all
    select h.revision, snapnotes_private.history_json(h)
    from public.review_history h
    where h.user_id = account and h.revision > since and 'history' = any (wanted)
    union all
    select s.revision, snapnotes_private.session_json(s)
    from public.study_sessions s
    where s.user_id = account and s.revision > since and 'session' = any (wanted)
    union all
    select g.revision, snapnotes_private.goal_json(g)
    from public.study_goals g
    where g.user_id = account and g.revision > since and 'goal' = any (wanted)
  ),
  limited as (
    select revision, item from changes order by revision limit row_limit + 1
  ),
  numbered as (
    select revision, item, row_number() over (order by revision) as n from limited
  )
  select
    coalesce(jsonb_agg(item order by revision) filter (where n <= row_limit), '[]'::jsonb),
    count(*) > row_limit,
    max(revision) filter (where n <= row_limit)
  into page, more, next_cursor
  from numbered;

  return jsonb_build_object(
    'changes', page,
    'cursor', coalesce(next_cursor, since),
    'hasMore', more,
    'latest', coalesce(latest, 0)
  );
end;
$$;

-- As in 20261112000000_accounts_and_sync.sql, with the session check and the
-- per-account storage limits.
create or replace function public.sync_push(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := snapnotes_private.current_account();
  max_rows bigint := snapnotes_private.setting('storage_max_rows');
  max_bytes bigint := snapnotes_private.setting('storage_max_text_bytes');
  used_rows bigint;
  used_bytes bigint;
  change jsonb;
  is_write boolean;
  incoming bigint;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception 'changes must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 500 then
    raise exception 'at most 500 changes can be pushed at once' using errcode = '22023';
  end if;

  insert into public.sync_accounts (user_id) values (account) on conflict (user_id) do nothing;
  -- One push at a time per account; pulls wait until this one commits.
  perform 1 from public.sync_accounts where user_id = account for update;

  select u.total_rows, u.text_bytes into used_rows, used_bytes
  from snapnotes_private.account_usage(account) u;

  for change in select value from jsonb_array_elements(changes) loop
    is_write := jsonb_typeof(change) = 'object' and change -> 'deleted' is distinct from 'true'::jsonb;
    incoming := case when is_write then coalesce(octet_length((change -> 'data')::text), 0) else 0 end;

    if is_write and (used_rows >= max_rows or used_bytes + incoming > max_bytes) then
      -- Counted conservatively (an edit counts as new data until the next
      -- push re-reads the account), so a push can never overshoot the limit.
      result := jsonb_build_object(
        'kind', change ->> 'kind', 'id', change ->> 'id', 'status', 'rejected',
        'reason', 'quota',
        'message', 'This account has reached its storage limit. Delete cards you no longer need to make room.'
      );
    else
      result := snapnotes_private.apply_change(account, change);
      if is_write and result ->> 'status' = 'applied' then
        used_rows := used_rows + 1;
        used_bytes := used_bytes + incoming;
      end if;
    end if;
    results := results || jsonb_build_array(result);
  end loop;

  return jsonb_build_object('results', results);
end;
$$;

-- As in 20261112000000_accounts_and_sync.sql, with the session check: a token
-- from a signed-out session cannot delete the account.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := snapnotes_private.current_account();
  recent boolean;
begin
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as method(entry)
    where jsonb_typeof(method.entry -> 'timestamp') = 'number'
      and (method.entry ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 600
  ) into recent;
  if not recent then
    raise exception 'sign in again to delete your account'
      using errcode = '42501', hint = 'reauthentication-required';
  end if;

  delete from auth.users where id = account;
end;
$$;

-- As in 20261116000000_ai_generation_quota.sql, with the session check and a
-- project-wide cap. Returns the same fields, plus `reason` ('account' or
-- 'project') when a request is refused.
create index ai_generation_requests_time
  on snapnotes_private.ai_generation_requests (requested_at);

create or replace function public.ai_generation_begin()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := snapnotes_private.current_account();
  per_hour constant bigint := snapnotes_private.setting('ai_per_hour');
  per_day constant bigint := snapnotes_private.setting('ai_per_day');
  project_hour constant bigint := snapnotes_private.setting('ai_project_per_hour');
  project_day constant bigint := snapnotes_private.setting('ai_project_per_day');
  last_hour integer;
  last_day integer;
  all_hour integer;
  all_day integer;
  oldest timestamptz;
  refused_by text;
  retry_after integer;
begin
  -- One reservation at a time across the whole project, so parallel calls
  -- (from one account or many) cannot both take the last free slot.
  perform pg_advisory_xact_lock(hashtextextended('ai_generation:project', 0));

  delete from snapnotes_private.ai_generation_requests
  where requested_at <= now() - interval '24 hours';

  select
    count(*) filter (where user_id = account and requested_at > now() - interval '1 hour'),
    count(*) filter (where user_id = account),
    count(*) filter (where requested_at > now() - interval '1 hour'),
    count(*)
  into last_hour, last_day, all_hour, all_day
  from snapnotes_private.ai_generation_requests;

  if last_day >= per_day then
    refused_by := 'account';
    select min(requested_at) + interval '24 hours' into oldest
    from snapnotes_private.ai_generation_requests where user_id = account;
  elsif last_hour >= per_hour then
    refused_by := 'account';
    select min(requested_at) + interval '1 hour' into oldest
    from snapnotes_private.ai_generation_requests
    where user_id = account and requested_at > now() - interval '1 hour';
  elsif all_day >= project_day then
    refused_by := 'project';
    select min(requested_at) + interval '24 hours' into oldest
    from snapnotes_private.ai_generation_requests;
  elsif all_hour >= project_hour then
    refused_by := 'project';
    select min(requested_at) + interval '1 hour' into oldest
    from snapnotes_private.ai_generation_requests
    where requested_at > now() - interval '1 hour';
  end if;

  if refused_by is not null then
    retry_after := greatest(1, ceil(extract(epoch from (coalesce(oldest, now()) - now())))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', refused_by,
      'userId', account,
      'retryAfterSeconds', retry_after,
      'remainingHour', greatest(0, per_hour - last_hour),
      'remainingDay', greatest(0, per_day - last_day)
    );
  end if;

  insert into snapnotes_private.ai_generation_requests (user_id) values (account);

  return jsonb_build_object(
    'allowed', true,
    'userId', account,
    'retryAfterSeconds', 0,
    'remainingHour', per_hour - last_hour - 1,
    'remainingDay', per_day - last_day - 1
  );
end;
$$;

-- `create or replace` keeps the grants of 20261112000000 and 20261116000000;
-- they are restated so this file alone shows who may call what.
revoke all on function public.sync_pull(bigint, integer, text[]) from public, anon;
revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.delete_account() from public, anon;
revoke all on function public.ai_generation_begin() from public, anon;
grant execute on function public.sync_pull(bigint, integer, text[]) to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.delete_account() to authenticated;
grant execute on function public.ai_generation_begin() to authenticated;
