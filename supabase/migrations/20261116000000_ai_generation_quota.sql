-- Snap Notes, Milestone 10: AI flashcard generation.
--
-- The `generate-flashcards` Edge Function (supabase/functions) sends study
-- material to an AI provider on behalf of a signed-in user. That costs money
-- per request, so every request is first counted here, against limits the
-- server sets and the browser cannot change:
--
--   * at most 20 generation requests per user in any rolling hour, and
--   * at most 60 in any rolling 24 hours.
--
-- Nothing about the study material or the generated cards is stored: only the
-- time of each request, kept for 24 hours and then removed.
--
-- This migration only adds: no existing table, row or function is changed.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- In the private schema created by the Milestone 8 migration, which the API
-- roles cannot reach directly: rows are read and written only by the function
-- below.
create table snapnotes_private.ai_generation_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index ai_generation_requests_user_time
  on snapnotes_private.ai_generation_requests (user_id, requested_at);

alter table snapnotes_private.ai_generation_requests enable row level security;
revoke all on table snapnotes_private.ai_generation_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ai_generation_begin(): reserve one generation request
-- ---------------------------------------------------------------------------

-- Called by the Edge Function with the caller's own JWT, immediately before it
-- contacts the AI provider. The account comes from the verified token
-- (auth.uid()), never from the request, so this both proves who is asking and
-- counts the request against that account alone. A user who calls it directly
-- only uses up their own allowance.
--
-- Returns { allowed, userId, retryAfterSeconds, remainingHour, remainingDay }.
create function public.ai_generation_begin()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  per_hour constant integer := 20;
  per_day constant integer := 60;
  last_hour integer;
  last_day integer;
  oldest timestamptz;
  retry_after integer;
begin
  if account is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- One request at a time per account, so two parallel calls cannot both
  -- squeeze into the last free slot.
  perform pg_advisory_xact_lock(hashtextextended('ai_generation:' || account::text, 0));

  delete from snapnotes_private.ai_generation_requests
  where user_id = account and requested_at <= now() - interval '24 hours';

  select
    count(*) filter (where requested_at > now() - interval '1 hour'),
    count(*)
  into last_hour, last_day
  from snapnotes_private.ai_generation_requests
  where user_id = account;

  if last_hour >= per_hour or last_day >= per_day then
    -- The earliest moment a slot frees up in whichever window is full.
    if last_day >= per_day then
      select min(requested_at) + interval '24 hours' into oldest
      from snapnotes_private.ai_generation_requests
      where user_id = account;
    else
      select min(requested_at) + interval '1 hour' into oldest
      from snapnotes_private.ai_generation_requests
      where user_id = account and requested_at > now() - interval '1 hour';
    end if;
    retry_after := greatest(1, ceil(extract(epoch from (oldest - now())))::integer);
    return jsonb_build_object(
      'allowed', false,
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

revoke all on function public.ai_generation_begin() from public, anon;
grant execute on function public.ai_generation_begin() to authenticated;
