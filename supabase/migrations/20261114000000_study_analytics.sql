-- Snap Notes, Milestone 9: learning analytics.
--
-- Adds two kinds of synced record, alongside the four from Milestone 8:
--
--   * study_sessions: one row per study session (Review, Quiz, Learn or Match),
--     with its answers, active time and per-card results. Written only by the
--     device the session happened on, under its own random ID.
--   * study_goals: one row per kind of goal ("cards per day"…), with the
--     current target and the history of changes to it.
--
-- This migration only adds: no existing table, row or column is changed or
-- removed. Both tables follow the Milestone 8 rules exactly: every change gets
-- a revision from the account's counter, deletions are tombstones, Row Level
-- Security allows users to read only their own rows, and every write goes
-- through sync_push(), which takes the account from the verified JWT.
--
-- sync_pull() gains a `kinds` parameter. An app from before this migration
-- does not send it and receives only the four kinds it understands, so it
-- keeps working while other devices sync sessions and goals. (When such a
-- device is updated, it reads the account again from the start, once, to pick
-- up the rows it was not sent. See loadSyncState in src/storage/syncStore.ts.)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.study_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  mode text,
  -- The deck the session was started on; null for a session over every deck.
  -- Not a foreign key: a session outlives the deck (and cards) it covered.
  deck_id text,
  -- The local calendar day of the session, as the app names it.
  day text,
  -- Milliseconds since the epoch, and durations in milliseconds, as recorded by the app.
  started_at bigint,
  ended_at bigint,
  duration_ms bigint,
  answered integer,
  correct integer,
  response_ms bigint,
  timed_answers integer,
  -- [{ "cardId": text, "correct": n, "incorrect": n }, …], validated by sync_push().
  results jsonb,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_sessions_id_format check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint study_sessions_live check (
    deleted
    or (
      mode in ('review', 'quiz', 'learn', 'match')
      and (deck_id is null or deck_id ~ '^[A-Za-z0-9_-]{1,64}$')
      and day ~ '^\d{4}-\d{2}-\d{2}$'
      and started_at > 0
      and ended_at >= started_at
      and duration_ms >= 0
      and answered >= 0
      and correct >= 0
      and correct <= answered
      and response_ms >= 0
      and timed_answers >= 0
      and timed_answers <= answered
      and jsonb_typeof(results) = 'array'
      and jsonb_array_length(results) <= 500
    )
  ),
  constraint study_sessions_tombstone check (
    not deleted
    or (
      mode is null
      and deck_id is null
      and day is null
      and started_at is null
      and ended_at is null
      and duration_ms is null
      and answered is null
      and correct is null
      and response_ms is null
      and timed_answers is null
      and results is null
    )
  )
);

create table public.study_goals (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The kind of goal.
  id text not null,
  -- The current target; null while the goal is switched off.
  target integer,
  updated_at bigint,
  -- [{ "at": ms, "target": n | null }, …], oldest first, validated by sync_push().
  changes jsonb,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_goals_kind check (
    id in ('cards-per-day', 'minutes-per-day', 'sessions-per-week', 'days-per-week')
  ),
  constraint study_goals_live check (
    deleted
    or (
      (target is null or target between 1 and 100000)
      and updated_at > 0
      and jsonb_typeof(changes) = 'array'
      and jsonb_array_length(changes) <= 50
    )
  ),
  constraint study_goals_tombstone check (
    not deleted or (target is null and updated_at is null and changes is null)
  )
);

create index study_sessions_user_revision on public.study_sessions (user_id, revision);
create index study_goals_user_revision on public.study_goals (user_id, revision);

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------

alter table public.study_sessions enable row level security;
alter table public.study_goals enable row level security;

revoke all on table public.study_sessions, public.study_goals from anon, authenticated;
grant select on table public.study_sessions, public.study_goals to authenticated;

create policy "Users read their own study sessions" on public.study_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own study goals" on public.study_goals
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

-- A field that must be present, and is either JSON null or text.
create function snapnotes_private.nullable_string(data jsonb, field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (data ? field) then
    perform snapnotes_private.invalid(field || ' is missing');
  end if;
  if jsonb_typeof(data -> field) = 'null' then
    return null;
  end if;
  return snapnotes_private.require_string(data, field);
end;
$$;

-- A field that must be present, and is either JSON null or a whole number.
create function snapnotes_private.nullable_integer(data jsonb, field text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (data ? field) then
    perform snapnotes_private.invalid(field || ' is missing');
  end if;
  if jsonb_typeof(data -> field) = 'null' then
    return null;
  end if;
  return snapnotes_private.require_integer(data, field);
end;
$$;

-- Checks a session's per-card results and returns them holding only the
-- fields the app defines, in their original order.
create function snapnotes_private.session_results(data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  items jsonb := data -> 'results';
  item jsonb;
  card_id text;
  normalized jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' then
    perform snapnotes_private.invalid('results must be a list');
  end if;
  if jsonb_array_length(items) > 500 then
    perform snapnotes_private.invalid('results can hold at most 500 cards');
  end if;
  for item in
    select value from jsonb_array_elements(items) with ordinality as e(value, n) order by n
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      perform snapnotes_private.invalid('each result must be an object');
    end if;
    card_id := snapnotes_private.require_string(item, 'cardId');
    if card_id !~ '^[A-Za-z0-9_-]{1,64}$' then
      perform snapnotes_private.invalid('result cardId is not a valid ID');
    end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'cardId', card_id,
      'correct', snapnotes_private.require_integer(item, 'correct'),
      'incorrect', snapnotes_private.require_integer(item, 'incorrect')
    ));
  end loop;
  return normalized;
end;
$$;

-- Checks a goal's change history and returns it holding only the fields the
-- app defines, in their original order.
create function snapnotes_private.goal_changes(data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  items jsonb := data -> 'changes';
  item jsonb;
  change_at bigint;
  change_target bigint;
  normalized jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(items) is distinct from 'array' then
    perform snapnotes_private.invalid('changes must be a list');
  end if;
  if jsonb_array_length(items) > 50 then
    perform snapnotes_private.invalid('changes can hold at most 50 entries');
  end if;
  for item in
    select value from jsonb_array_elements(items) with ordinality as e(value, n) order by n
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      perform snapnotes_private.invalid('each change must be an object');
    end if;
    change_at := snapnotes_private.require_integer(item, 'at');
    if change_at <= 0 then
      perform snapnotes_private.invalid('a change needs a time');
    end if;
    change_target := snapnotes_private.nullable_integer(item, 'target');
    if change_target is not null and (change_target < 1 or change_target > 100000) then
      perform snapnotes_private.invalid('a target must be from 1 to 100000');
    end if;
    normalized := normalized || jsonb_build_array(
      jsonb_build_object('at', change_at, 'target', change_target)
    );
  end loop;
  return normalized;
end;
$$;

create function snapnotes_private.session_json(s public.study_sessions)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'session',
    'id', s.id,
    'revision', s.revision,
    'deleted', s.deleted,
    'data', case when s.deleted then null else jsonb_build_object(
      'id', s.id,
      'mode', s.mode,
      'deckId', s.deck_id,
      'day', s.day,
      'startedAt', s.started_at,
      'endedAt', s.ended_at,
      'durationMs', s.duration_ms,
      'answered', s.answered,
      'correct', s.correct,
      'responseMs', s.response_ms,
      'timedAnswers', s.timed_answers,
      'results', s.results
    ) end
  );
$$;

create function snapnotes_private.goal_json(g public.study_goals)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'goal',
    'id', g.id,
    'revision', g.revision,
    'deleted', g.deleted,
    'data', case when g.deleted then null else jsonb_build_object(
      'id', g.id,
      'target', g.target,
      'updatedAt', g.updated_at,
      'changes', g.changes
    ) end
  );
$$;

-- ---------------------------------------------------------------------------
-- Applying one change (the same rules as the Milestone 8 kinds: see
-- apply_deck in 20261112000000_accounts_and_sync.sql)
-- ---------------------------------------------------------------------------

create function snapnotes_private.apply_session(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.study_sessions;
  found_row boolean;
  incoming public.study_sessions;
  updated_row public.study_sessions;
begin
  if not is_delete then
    if data ->> 'id' is distinct from record_id then
      perform snapnotes_private.invalid('data.id must match id');
    end if;
    incoming.mode := snapnotes_private.require_string(data, 'mode');
    incoming.deck_id := snapnotes_private.nullable_string(data, 'deckId');
    incoming.day := snapnotes_private.require_string(data, 'day');
    incoming.started_at := snapnotes_private.require_integer(data, 'startedAt');
    incoming.ended_at := snapnotes_private.require_integer(data, 'endedAt');
    incoming.duration_ms := snapnotes_private.require_integer(data, 'durationMs');
    incoming.answered := snapnotes_private.require_integer(data, 'answered');
    incoming.correct := snapnotes_private.require_integer(data, 'correct');
    incoming.response_ms := snapnotes_private.require_integer(data, 'responseMs');
    incoming.timed_answers := snapnotes_private.require_integer(data, 'timedAnswers');
    incoming.results := snapnotes_private.session_results(data);
  end if;

  select * into current_row from public.study_sessions
  where user_id = account and id = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.mode = incoming.mode
        and current_row.deck_id is not distinct from incoming.deck_id
        and current_row.day = incoming.day
        and current_row.started_at = incoming.started_at
        and current_row.ended_at = incoming.ended_at
        and current_row.duration_ms = incoming.duration_ms
        and current_row.answered = incoming.answered
        and current_row.correct = incoming.correct
        and current_row.response_ms = incoming.response_ms
        and current_row.timed_answers = incoming.timed_answers
        and current_row.results = incoming.results
      )
    ) then
      return snapnotes_private.applied('session', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'session', record_id, 'changed',
      case when found_row then snapnotes_private.session_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('session', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('session', record_id, current_row.revision);
    end if;
    update public.study_sessions
    set deleted = true, mode = null, deck_id = null, day = null, started_at = null,
        ended_at = null, duration_ms = null, answered = null, correct = null,
        response_ms = null, timed_answers = null, results = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and id = record_id
    returning * into updated_row;
    return snapnotes_private.applied('session', record_id, updated_row.revision);
  end if;

  insert into public.study_sessions (
    user_id, id, mode, deck_id, day, started_at, ended_at, duration_ms, answered, correct,
    response_ms, timed_answers, results, deleted, revision
  )
  values (
    account, record_id, incoming.mode, incoming.deck_id, incoming.day, incoming.started_at,
    incoming.ended_at, incoming.duration_ms, incoming.answered, incoming.correct,
    incoming.response_ms, incoming.timed_answers, incoming.results, false,
    snapnotes_private.next_revision(account)
  )
  on conflict (user_id, id) do update
  set mode = excluded.mode,
      deck_id = excluded.deck_id,
      day = excluded.day,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_ms = excluded.duration_ms,
      answered = excluded.answered,
      correct = excluded.correct,
      response_ms = excluded.response_ms,
      timed_answers = excluded.timed_answers,
      results = excluded.results,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('session', record_id, updated_row.revision);
end;
$$;

create function snapnotes_private.apply_goal(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.study_goals;
  found_row boolean;
  new_target bigint;
  new_updated bigint;
  new_changes jsonb;
  updated_row public.study_goals;
begin
  if not is_delete then
    if data ->> 'id' is distinct from record_id then
      perform snapnotes_private.invalid('data.id must match id');
    end if;
    new_target := snapnotes_private.nullable_integer(data, 'target');
    new_updated := snapnotes_private.require_integer(data, 'updatedAt');
    new_changes := snapnotes_private.goal_changes(data);
  end if;

  select * into current_row from public.study_goals
  where user_id = account and id = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.target is not distinct from new_target
        and current_row.updated_at = new_updated
        and current_row.changes = new_changes
      )
    ) then
      return snapnotes_private.applied('goal', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'goal', record_id, 'changed',
      case when found_row then snapnotes_private.goal_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('goal', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('goal', record_id, current_row.revision);
    end if;
    update public.study_goals
    set deleted = true, target = null, updated_at = null, changes = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and id = record_id
    returning * into updated_row;
    return snapnotes_private.applied('goal', record_id, updated_row.revision);
  end if;

  insert into public.study_goals (user_id, id, target, updated_at, changes, deleted, revision)
  values (
    account, record_id, new_target, new_updated, new_changes, false,
    snapnotes_private.next_revision(account)
  )
  on conflict (user_id, id) do update
  set target = excluded.target,
      updated_at = excluded.updated_at,
      changes = excluded.changes,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('goal', record_id, updated_row.revision);
end;
$$;

-- The Milestone 8 dispatcher, with the two new kinds. Unchanged otherwise.
create or replace function snapnotes_private.apply_change(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  kind text := change ->> 'kind';
  record_id text := change ->> 'id';
begin
  begin
    if jsonb_typeof(change) is distinct from 'object' then
      perform snapnotes_private.invalid('a change must be an object');
    end if;
    if jsonb_typeof(change -> 'id') is distinct from 'string' then
      perform snapnotes_private.invalid('id must be text');
    end if;
    if jsonb_typeof(change -> 'deleted') is distinct from 'boolean' then
      perform snapnotes_private.invalid('deleted must be true or false');
    end if;
    if jsonb_typeof(change -> 'baseRevision') not in ('number', 'null')
      or (change ? 'baseRevision') is false then
      perform snapnotes_private.invalid('baseRevision must be a number or null');
    end if;
    if not (change ->> 'deleted')::boolean
      and jsonb_typeof(change -> 'data') is distinct from 'object' then
      perform snapnotes_private.invalid('data must be an object');
    end if;

    if kind = 'deck' then
      return snapnotes_private.apply_deck(account, change);
    elsif kind = 'card' then
      return snapnotes_private.apply_card(account, change);
    elsif kind = 'progress' then
      return snapnotes_private.apply_progress(account, change);
    elsif kind = 'history' then
      return snapnotes_private.apply_history(account, change);
    elsif kind = 'session' then
      return snapnotes_private.apply_session(account, change);
    elsif kind = 'goal' then
      return snapnotes_private.apply_goal(account, change);
    end if;
    perform snapnotes_private.invalid('unknown kind');
  exception
    when invalid_parameter_value or check_violation or not_null_violation
      or invalid_text_representation or numeric_value_out_of_range
      or foreign_key_violation or string_data_right_truncation then
      return jsonb_build_object(
        'kind', kind, 'id', record_id, 'status', 'rejected', 'reason', 'invalid',
        'message', sqlerrm
      );
  end;
  return null;
end;
$$;

revoke all on all functions in schema snapnotes_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The API
-- ---------------------------------------------------------------------------

-- Replaced to read the two new tables. `kinds` names the kinds of record the
-- caller understands; left out (by an app from before this migration), it is
-- the four Milestone 8 kinds, so such an app is never sent a row it cannot read.
drop function public.sync_pull(bigint, integer);

create function public.sync_pull(
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
  account uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(max_rows, 500), 1), 1000);
  wanted text[] := coalesce(kinds, array['deck', 'card', 'progress', 'history']);
  latest bigint;
  page jsonb;
  more boolean;
  next_cursor bigint;
begin
  if account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
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

revoke all on function public.sync_pull(bigint, integer, text[]) from public, anon;
grant execute on function public.sync_pull(bigint, integer, text[]) to authenticated;
