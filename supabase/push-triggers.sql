-- ============================================================
-- OPTIONAL ADD-ON: push notification triggers (run AFTER schema.sql
-- and AFTER deploying the send-push edge function).
--
-- 1. Deploy the edge function and set its secrets (see functions/send-push/index.ts).
-- 2. Store the function endpoint + shared secret for the triggers:
--
--    insert into public.app_settings (key, value) values ('push_config', jsonb_build_object(
--      'url',    'https://<project-ref>.functions.supabase.co/send-push',
--      'secret', '<same PUSH_SECRET you set on the function>'
--    )) on conflict (key) do update set value = excluded.value;
--
-- 3. Run this file in the SQL editor.
-- Uses pg_net (pre-installed on Supabase) for async HTTP from triggers.
-- ============================================================

create extension if not exists pg_net;

create or replace function public.send_push(p_user_ids uuid[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb;
begin
  select value into cfg from public.app_settings where key = 'push_config';
  if cfg is null then return; end if;  -- push not configured: no-op
  perform net.http_post(
    url     := cfg->>'url',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg->>'secret'),
    body    := jsonb_build_object(
      'user_ids', case when p_user_ids is null then null else to_jsonb(p_user_ids) end,
      'title', p_title, 'body', p_body)
  );
end $$;

-- 1) New game announced -> everyone
create or replace function public.trg_game_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.send_push(null, 'New game: ' || new.title,
    to_char(new.starts_at at time zone 'Asia/Dubai', 'Dy DD Mon · HH12:MI AM') || ' at ' || new.location || ' — tap to join.');
  return new;
end $$;
create trigger game_created after insert on public.games
  for each row execute function public.trg_game_created();

-- 2) Promoted off the waitlist -> that member (or the guest's sponsor)
create or replace function public.trg_roster_promoted()
returns trigger language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  if new.status = 'pending' and old.status = 'wait' then
    select * into g from public.games where id = new.game_id;
    perform public.send_push(array[new.user_id],
      case when new.kind = 'guest' then 'Guest spot open: ' || new.guest_name else 'A spot opened up!' end,
      g.title || ' — confirm within your window or the spot passes on.');
  end if;
  return new;
end $$;
create trigger roster_promoted after update on public.roster
  for each row execute function public.trg_roster_promoted();

-- 3) Billed (game fee or penalty) or payment recorded -> that member
create or replace function public.trg_txn_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('game_fee', 'penalty', 'payment') then
    perform public.send_push(array[new.user_id],
      case new.kind when 'game_fee' then 'Game billed' when 'penalty' then 'Penalty charged' else 'Payment received' end,
      new.description || ' · ' || case when new.amount < 0 then '−' else '+' end || 'AED ' || abs(new.amount)::text);
  end if;
  return new;
end $$;
create trigger txn_created after insert on public.transactions
  for each row execute function public.trg_txn_created();

-- 4) Game reminder 24h before start -> confirmed players (cron, hourly)
create or replace function public.send_game_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare g public.games; ids uuid[];
begin
  for g in
    select * from public.games
     where not closed
       and starts_at between now() + interval '23 hours' and now() + interval '24 hours'
  loop
    select array_agg(distinct user_id) into ids from public.roster
     where game_id = g.id and status = 'in';
    if ids is not null then
      perform public.send_push(ids, 'Tomorrow: ' || g.title,
        to_char(g.starts_at at time zone 'Asia/Dubai', 'HH12:MI AM') || ' at ' || g.location || ' 🏸');
    end if;
  end loop;
end $$;
select cron.schedule('game-reminders', '30 * * * *', $$select public.send_game_reminders()$$);
