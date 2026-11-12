-- Snap Notes, Milestone 8: accounts and cloud sync.
--
-- One table per kind of record the app keeps: decks, cards, learning progress
-- and the day-by-day review log. Every row belongs to one account (user_id),
-- and every change to a row gives it a new *revision*: a number from a counter
-- kept per account on the server. Devices pull "everything after revision N"
-- and push "this change, made on top of revision M". Ordering never depends on
-- a device's clock.
--
-- Deleted records stay as tombstones (deleted = true, content cleared), so a
-- device that was offline when something was deleted still learns about it.
--
-- Security model:
--   * Row Level Security is on for every table. Signed-in users may read only
--     their own rows; nobody may insert, update or delete rows directly.
--   * All writes go through sync_push(), which takes the account from the
--     verified JWT (auth.uid()) and never from the request body.
--   * Deleting the account removes the auth user, and every row cascades.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The revision counter for each account. Pushes lock this row, so changes to
-- one account are applied one push at a time, and pulls wait for a push in
-- progress to finish before reading.
create table public.sync_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);

comment on table public.sync_accounts is
  'Per-account revision counter for Snap Notes sync. Written only by sync_push().';

create table public.decks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text,
  -- Milliseconds since the epoch, as recorded by the app (the domain timestamps).
  created_at bigint,
  updated_at bigint,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint decks_id_format check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint decks_live check (
    deleted
    or (
      name is not null
      and name ~ '[^[:space:]]'
      and char_length(name) <= 1000
      and created_at > 0
      and updated_at >= created_at
    )
  ),
  constraint decks_tombstone check (
    not deleted or (name is null and created_at is null and updated_at is null)
  )
);

create table public.cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  deck_id text,
  term text,
  definition text,
  created_at bigint,
  updated_at bigint,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- A card can only name a deck row of the same account. Whether that deck is
  -- live is checked by sync_push(), which can explain the problem to the app.
  foreign key (user_id, deck_id) references public.decks (user_id, id) on delete cascade,
  constraint cards_id_format check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint cards_live check (
    deleted
    or (
      deck_id is not null
      and term is not null
      and definition is not null
      and (term ~ '[^[:space:]]' or definition ~ '[^[:space:]]')
      and char_length(term) <= 100000
      and char_length(definition) <= 100000
      and created_at > 0
      and updated_at >= created_at
    )
  ),
  constraint cards_tombstone check (
    not deleted
    or (
      deck_id is null
      and term is null
      and definition is null
      and created_at is null
      and updated_at is null
    )
  )
);

create table public.card_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  deck_id text,
  reviews integer,
  correct integer,
  incorrect integer,
  stage text,
  interval_days double precision,
  ease double precision,
  last_reviewed_at bigint,
  due_at bigint,
  streak integer,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, card_id),
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade,
  constraint card_progress_live check (
    deleted
    or (
      deck_id ~ '^[A-Za-z0-9_-]{1,64}$'
      and reviews >= 0
      and correct >= 0
      and incorrect >= 0
      and stage in ('learning', 'review', 'mastered')
      and interval_days >= 0
      and interval_days <> 'Infinity'::double precision
      and ease > 0
      and ease <> 'Infinity'::double precision
      and last_reviewed_at > 0
      and due_at > 0
      and streak >= 0
    )
  ),
  constraint card_progress_tombstone check (
    not deleted
    or (
      deck_id is null
      and reviews is null
      and correct is null
      and incorrect is null
      and stage is null
      and interval_days is null
      and ease is null
      and last_reviewed_at is null
      and due_at is null
      and streak is null
    )
  )
);

create table public.review_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The local calendar day the reviews were made on, as the app names it.
  day text not null,
  reviews integer,
  correct integer,
  deleted boolean not null default false,
  revision bigint not null check (revision > 0),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint review_history_day_format check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint review_history_live check (
    deleted or (reviews >= 0 and correct >= 0 and correct <= reviews)
  ),
  constraint review_history_tombstone check (
    not deleted or (reviews is null and correct is null)
  )
);

-- Pulls read "everything for this account after revision N".
create index decks_user_revision on public.decks (user_id, revision);
create index cards_user_revision on public.cards (user_id, revision);
create index card_progress_user_revision on public.card_progress (user_id, revision);
create index review_history_user_revision on public.review_history (user_id, revision);
-- sync_push() checks for live cards in a deck before deleting it.
create index cards_user_deck on public.cards (user_id, deck_id) where not deleted;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------

alter table public.sync_accounts enable row level security;
alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.card_progress enable row level security;
alter table public.review_history enable row level security;

-- Supabase grants every privilege on new public tables to the API roles by
-- default. Take them all back, then allow reading only.
revoke all on table
  public.sync_accounts, public.decks, public.cards, public.card_progress, public.review_history
  from anon, authenticated;

grant select on table
  public.sync_accounts, public.decks, public.cards, public.card_progress, public.review_history
  to authenticated;

create policy "Users read their own sync account" on public.sync_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own decks" on public.decks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own cards" on public.cards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own progress" on public.card_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their own review history" on public.review_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Private helpers (not exposed through the API)
-- ---------------------------------------------------------------------------

create schema snapnotes_private;
revoke all on schema snapnotes_private from public, anon, authenticated;

-- Raised for a change the server will not store. Caught per change by
-- sync_push(), so one bad record never blocks the rest of a push.
create function snapnotes_private.invalid(message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '22023', message = message;
end;
$$;

create function snapnotes_private.next_revision(account uuid)
returns bigint
language sql
set search_path = ''
as $$
  update public.sync_accounts
  set revision = revision + 1
  where user_id = account
  returning revision;
$$;

create function snapnotes_private.require_string(data jsonb, field text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(data -> field) is distinct from 'string' then
    perform snapnotes_private.invalid(field || ' must be text');
  end if;
  return data ->> field;
end;
$$;

create function snapnotes_private.require_integer(data jsonb, field text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  value numeric;
begin
  if jsonb_typeof(data -> field) is distinct from 'number' then
    perform snapnotes_private.invalid(field || ' must be a number');
  end if;
  value := (data ->> field)::numeric;
  if value <> trunc(value) or value < 0 or value > 9007199254740991 then
    perform snapnotes_private.invalid(field || ' must be a whole number');
  end if;
  return value::bigint;
end;
$$;

create function snapnotes_private.require_number(data jsonb, field text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(data -> field) is distinct from 'number' then
    perform snapnotes_private.invalid(field || ' must be a number');
  end if;
  return (data ->> field)::double precision;
end;
$$;

-- Each *_json function returns a stored row in the shape the app uses, so the
-- server and the app agree on one representation of every record.

create function snapnotes_private.deck_json(d public.decks)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'deck',
    'id', d.id,
    'revision', d.revision,
    'deleted', d.deleted,
    'data', case when d.deleted then null else jsonb_build_object(
      'id', d.id,
      'name', d.name,
      'createdAt', d.created_at,
      'updatedAt', d.updated_at
    ) end
  );
$$;

create function snapnotes_private.card_json(c public.cards)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'card',
    'id', c.id,
    'revision', c.revision,
    'deleted', c.deleted,
    'data', case when c.deleted then null else jsonb_build_object(
      'id', c.id,
      'deckId', c.deck_id,
      'term', c.term,
      'definition', c.definition,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at
    ) end
  );
$$;

create function snapnotes_private.progress_json(p public.card_progress)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'progress',
    'id', p.card_id,
    'revision', p.revision,
    'deleted', p.deleted,
    'data', case when p.deleted then null else jsonb_build_object(
      'cardId', p.card_id,
      'deckId', p.deck_id,
      'reviews', p.reviews,
      'correct', p.correct,
      'incorrect', p.incorrect,
      'stage', p.stage,
      'intervalDays', p.interval_days,
      'ease', p.ease,
      'lastReviewedAt', p.last_reviewed_at,
      'dueAt', p.due_at,
      'streak', p.streak
    ) end
  );
$$;

create function snapnotes_private.history_json(h public.review_history)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'history',
    'id', h.day,
    'revision', h.revision,
    'deleted', h.deleted,
    'data', case when h.deleted then null else jsonb_build_object(
      'day', h.day,
      'reviews', h.reviews,
      'correct', h.correct
    ) end
  );
$$;

create function snapnotes_private.applied(kind text, id text, revision bigint)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('kind', kind, 'id', id, 'status', 'applied', 'revision', revision);
$$;

create function snapnotes_private.conflict(kind text, id text, reason text, current_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', kind, 'id', id, 'status', 'conflict', 'reason', reason, 'current', current_row
  );
$$;

-- ---------------------------------------------------------------------------
-- Applying one change
--
-- A change is { kind, id, baseRevision, deleted, data }. baseRevision is the
-- revision the device last saw for this record (null: it has never seen one).
--
--   * baseRevision matches the stored revision: the change is applied and the
--     row gets a new revision.
--   * It does not match, but the stored row already says exactly what the
--     change says (a retried request whose reply was lost): reported as applied,
--     with nothing written. This is what makes pushing idempotent.
--   * Otherwise: a conflict. The current row is returned, the device merges it
--     with its own change and pushes again on top of the new revision.
-- ---------------------------------------------------------------------------

create function snapnotes_private.apply_deck(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.decks;
  found_row boolean;
  new_name text;
  new_created bigint;
  new_updated bigint;
  updated_row public.decks;
begin
  if not is_delete then
    new_name := snapnotes_private.require_string(data, 'name');
    new_created := snapnotes_private.require_integer(data, 'createdAt');
    new_updated := snapnotes_private.require_integer(data, 'updatedAt');
    if data ->> 'id' is distinct from record_id then
      perform snapnotes_private.invalid('data.id must match id');
    end if;
  end if;

  select * into current_row from public.decks
  where user_id = account and id = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.name = new_name
        and current_row.created_at = new_created
        and current_row.updated_at = new_updated
      )
    ) then
      return snapnotes_private.applied('deck', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'deck', record_id, 'changed',
      case when found_row then snapnotes_private.deck_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('deck', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('deck', record_id, current_row.revision);
    end if;
    -- Another device may have put cards in this deck since it was last read
    -- here. Deleting it would orphan them, so the device must look again.
    if exists (
      select 1 from public.cards
      where user_id = account and deck_id = record_id and not deleted
    ) then
      return snapnotes_private.conflict(
        'deck', record_id, 'deck-not-empty', snapnotes_private.deck_json(current_row)
      );
    end if;
    update public.decks
    set deleted = true, name = null, created_at = null, updated_at = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and id = record_id
    returning * into updated_row;
    return snapnotes_private.applied('deck', record_id, updated_row.revision);
  end if;

  insert into public.decks (user_id, id, name, created_at, updated_at, deleted, revision)
  values (
    account, record_id, new_name, new_created, new_updated, false,
    snapnotes_private.next_revision(account)
  )
  on conflict (user_id, id) do update
  set name = excluded.name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('deck', record_id, updated_row.revision);
end;
$$;

create function snapnotes_private.apply_card(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.cards;
  found_row boolean;
  new_deck text;
  new_term text;
  new_definition text;
  new_created bigint;
  new_updated bigint;
  updated_row public.cards;
begin
  if not is_delete then
    new_deck := snapnotes_private.require_string(data, 'deckId');
    new_term := snapnotes_private.require_string(data, 'term');
    new_definition := snapnotes_private.require_string(data, 'definition');
    new_created := snapnotes_private.require_integer(data, 'createdAt');
    new_updated := snapnotes_private.require_integer(data, 'updatedAt');
    if data ->> 'id' is distinct from record_id then
      perform snapnotes_private.invalid('data.id must match id');
    end if;
  end if;

  select * into current_row from public.cards
  where user_id = account and id = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.deck_id = new_deck
        and current_row.term = new_term
        and current_row.definition = new_definition
        and current_row.created_at = new_created
        and current_row.updated_at = new_updated
      )
    ) then
      return snapnotes_private.applied('card', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'card', record_id, 'changed',
      case when found_row then snapnotes_private.card_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('card', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('card', record_id, current_row.revision);
    end if;
    update public.cards
    set deleted = true, deck_id = null, term = null, definition = null,
        created_at = null, updated_at = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and id = record_id
    returning * into updated_row;
    return snapnotes_private.applied('card', record_id, updated_row.revision);
  end if;

  -- A live card needs a live deck. If the deck was deleted elsewhere, the
  -- device has not heard yet: it pulls, decides what to do, and tries again.
  if not exists (
    select 1 from public.decks
    where user_id = account and id = new_deck and not deleted
  ) then
    return snapnotes_private.conflict(
      'card', record_id, 'deck-missing',
      case when found_row then snapnotes_private.card_json(current_row) end
    );
  end if;

  insert into public.cards (
    user_id, id, deck_id, term, definition, created_at, updated_at, deleted, revision
  )
  values (
    account, record_id, new_deck, new_term, new_definition, new_created, new_updated, false,
    snapnotes_private.next_revision(account)
  )
  on conflict (user_id, id) do update
  set deck_id = excluded.deck_id,
      term = excluded.term,
      definition = excluded.definition,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('card', record_id, updated_row.revision);
end;
$$;

create function snapnotes_private.apply_progress(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.card_progress;
  found_row boolean;
  incoming public.card_progress;
  updated_row public.card_progress;
begin
  if not is_delete then
    if data ->> 'cardId' is distinct from record_id then
      perform snapnotes_private.invalid('data.cardId must match id');
    end if;
    incoming.deck_id := snapnotes_private.require_string(data, 'deckId');
    incoming.reviews := snapnotes_private.require_integer(data, 'reviews');
    incoming.correct := snapnotes_private.require_integer(data, 'correct');
    incoming.incorrect := snapnotes_private.require_integer(data, 'incorrect');
    incoming.stage := snapnotes_private.require_string(data, 'stage');
    incoming.interval_days := snapnotes_private.require_number(data, 'intervalDays');
    incoming.ease := snapnotes_private.require_number(data, 'ease');
    incoming.last_reviewed_at := snapnotes_private.require_integer(data, 'lastReviewedAt');
    incoming.due_at := snapnotes_private.require_integer(data, 'dueAt');
    incoming.streak := snapnotes_private.require_integer(data, 'streak');
  end if;

  select * into current_row from public.card_progress
  where user_id = account and card_id = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.deck_id = incoming.deck_id
        and current_row.reviews = incoming.reviews
        and current_row.correct = incoming.correct
        and current_row.incorrect = incoming.incorrect
        and current_row.stage = incoming.stage
        and current_row.interval_days = incoming.interval_days
        and current_row.ease = incoming.ease
        and current_row.last_reviewed_at = incoming.last_reviewed_at
        and current_row.due_at = incoming.due_at
        and current_row.streak = incoming.streak
      )
    ) then
      return snapnotes_private.applied('progress', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'progress', record_id, 'changed',
      case when found_row then snapnotes_private.progress_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('progress', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('progress', record_id, current_row.revision);
    end if;
    update public.card_progress
    set deleted = true, deck_id = null, reviews = null, correct = null, incorrect = null,
        stage = null, interval_days = null, ease = null, last_reviewed_at = null,
        due_at = null, streak = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and card_id = record_id
    returning * into updated_row;
    return snapnotes_private.applied('progress', record_id, updated_row.revision);
  end if;

  -- Progress belongs to a card that exists.
  if not exists (
    select 1 from public.cards
    where user_id = account and id = record_id and not deleted
  ) then
    return snapnotes_private.conflict(
      'progress', record_id, 'card-missing',
      case when found_row then snapnotes_private.progress_json(current_row) end
    );
  end if;

  insert into public.card_progress (
    user_id, card_id, deck_id, reviews, correct, incorrect, stage, interval_days, ease,
    last_reviewed_at, due_at, streak, deleted, revision
  )
  values (
    account, record_id, incoming.deck_id, incoming.reviews, incoming.correct,
    incoming.incorrect, incoming.stage, incoming.interval_days, incoming.ease,
    incoming.last_reviewed_at, incoming.due_at, incoming.streak, false,
    snapnotes_private.next_revision(account)
  )
  on conflict (user_id, card_id) do update
  set deck_id = excluded.deck_id,
      reviews = excluded.reviews,
      correct = excluded.correct,
      incorrect = excluded.incorrect,
      stage = excluded.stage,
      interval_days = excluded.interval_days,
      ease = excluded.ease,
      last_reviewed_at = excluded.last_reviewed_at,
      due_at = excluded.due_at,
      streak = excluded.streak,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('progress', record_id, updated_row.revision);
end;
$$;

create function snapnotes_private.apply_history(account uuid, change jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  record_id text := change ->> 'id';
  base bigint := (change ->> 'baseRevision')::bigint;
  is_delete boolean := (change ->> 'deleted')::boolean;
  data jsonb := change -> 'data';
  current_row public.review_history;
  found_row boolean;
  new_reviews bigint;
  new_correct bigint;
  updated_row public.review_history;
begin
  if not is_delete then
    if data ->> 'day' is distinct from record_id then
      perform snapnotes_private.invalid('data.day must match id');
    end if;
    new_reviews := snapnotes_private.require_integer(data, 'reviews');
    new_correct := snapnotes_private.require_integer(data, 'correct');
  end if;

  select * into current_row from public.review_history
  where user_id = account and day = record_id
  for update;
  found_row := found;

  if base is distinct from current_row.revision then
    if found_row and (
      (is_delete and current_row.deleted)
      or (
        not is_delete and not current_row.deleted
        and current_row.reviews = new_reviews
        and current_row.correct = new_correct
      )
    ) then
      return snapnotes_private.applied('history', record_id, current_row.revision);
    end if;
    return snapnotes_private.conflict(
      'history', record_id, 'changed',
      case when found_row then snapnotes_private.history_json(current_row) end
    );
  end if;

  if is_delete then
    if not found_row then
      return snapnotes_private.applied('history', record_id, null);
    end if;
    if current_row.deleted then
      return snapnotes_private.applied('history', record_id, current_row.revision);
    end if;
    update public.review_history
    set deleted = true, reviews = null, correct = null,
        revision = snapnotes_private.next_revision(account), server_updated_at = now()
    where user_id = account and day = record_id
    returning * into updated_row;
    return snapnotes_private.applied('history', record_id, updated_row.revision);
  end if;

  insert into public.review_history (user_id, day, reviews, correct, deleted, revision)
  values (account, record_id, new_reviews, new_correct, false,
          snapnotes_private.next_revision(account))
  on conflict (user_id, day) do update
  set reviews = excluded.reviews,
      correct = excluded.correct,
      deleted = false,
      revision = excluded.revision,
      server_updated_at = now()
  returning * into updated_row;
  return snapnotes_private.applied('history', record_id, updated_row.revision);
end;
$$;

create function snapnotes_private.apply_change(account uuid, change jsonb)
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
    end if;
    perform snapnotes_private.invalid('unknown kind');
  exception
    -- Bad input from one change is reported for that change alone; the
    -- subtransaction is rolled back and the rest of the push carries on.
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

-- Every change made to the signed-in account after revision `since`, oldest
-- first, at most `max_rows` at a time. Repeat with the returned cursor while
-- hasMore is true.
create function public.sync_pull(since bigint default 0, max_rows integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(max_rows, 500), 1), 1000);
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

  -- Waits for a push to this account that is still running. Its revisions
  -- were taken before ours could be read, so reading now can never skip one.
  perform 1 from public.sync_accounts where user_id = account for share;
  select revision into latest from public.sync_accounts where user_id = account;

  with changes as (
    select d.revision, snapnotes_private.deck_json(d) as item
    from public.decks d where d.user_id = account and d.revision > since
    union all
    select c.revision, snapnotes_private.card_json(c)
    from public.cards c where c.user_id = account and c.revision > since
    union all
    select p.revision, snapnotes_private.progress_json(p)
    from public.card_progress p where p.user_id = account and p.revision > since
    union all
    select h.revision, snapnotes_private.history_json(h)
    from public.review_history h where h.user_id = account and h.revision > since
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

-- Applies a list of changes to the signed-in account and reports what
-- happened to each one, in order: applied (with its new revision), conflict
-- (with the server's current row) or rejected (invalid data).
create function public.sync_push(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  change jsonb;
  results jsonb := '[]'::jsonb;
begin
  if account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception 'changes must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 500 then
    raise exception 'at most 500 changes can be pushed at once' using errcode = '22023';
  end if;

  insert into public.sync_accounts (user_id) values (account) on conflict (user_id) do nothing;
  -- One push at a time per account; pulls wait until this one commits.
  perform 1 from public.sync_accounts where user_id = account for update;

  for change in select value from jsonb_array_elements(changes) loop
    results := results || jsonb_build_array(snapnotes_private.apply_change(account, change));
  end loop;

  return jsonb_build_object('results', results);
end;
$$;

-- Permanently deletes the signed-in account and, through the foreign keys,
-- every deck, card, progress record and review day stored for it. Requires a
-- sign-in within the last ten minutes, so a session left open on a shared
-- computer cannot be used to delete the account.
create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  recent boolean;
begin
  if account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

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

revoke all on function public.sync_pull(bigint, integer) from public, anon;
revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.delete_account() to authenticated;
