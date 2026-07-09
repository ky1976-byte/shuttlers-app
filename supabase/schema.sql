-- ============================================================
-- SHUTTLERS BADMINTON CLUB UAE — Supabase schema (v3 spec)
-- Run this whole file in the Supabase SQL editor of a new project.
-- ============================================================

-- ---------- tables ----------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  phone text,
  is_admin boolean not null default false,
  status text not null default 'member' check (status in ('member','prepay','explayer')),
  joined date not null default current_date,
  initial_games int not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.invites (
  token uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  is_admin boolean not null default false,
  used_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location text not null default 'TBC',
  map_link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  courts int not null default 1,
  per_court int not null default 4,
  capacity_override int,
  cutoff_hours int not null default 4,
  cost_per_player numeric not null default 40,
  penalty numeric not null default 0,
  rr_mode text not null default 'manual' check (rr_mode in ('manual','auto')),
  recurring boolean not null default false,
  preset_key text,
  successor_created boolean not null default false,
  closed boolean not null default false,
  closed_at timestamptz,
  actual_players int,
  collected numeric,
  penalty_collected numeric not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.roster (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'member' check (kind in ('member','guest')),
  guest_name text,
  status text not null default 'in' check (status in ('in','wait','pending')),
  joined_at timestamptz not null default now(),
  pending_until timestamptz
);
create unique index roster_one_member_per_game
  on public.roster (game_id, user_id) where (kind = 'member');

-- every member balance change is one row here; balance = sum(amount)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  kind text not null default 'adjust'
    check (kind in ('game_fee','penalty','payment','transfer','adjust','seed')),
  description text not null default '',
  game_id uuid references public.games(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending','applied','waived')),
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category text not null default 'Court hire',
  description text not null default '',
  amount numeric not null check (amount > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- round-robin matches; team members stored as display names
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  round int not null,
  court int not null,
  t1 text[] not null,
  t2 text[] not null,
  winner int check (winner in (1,2)),
  recorded_by uuid references public.profiles(id)
);

create table public.presets (
  key text primary key,
  label text not null,
  member_ids uuid[] not null default '{}'
);

-- monthly consolidation: manual opening + actual closing per month
create table public.month_recon (
  month date primary key,           -- first of month
  opening numeric not null default 0,
  actual_closing numeric
);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values ('club_seed', '{"amount": 0}');

-- web push subscriptions (phase 2 — sending via edge function)
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- helper functions ----------

create or replace function public.is_active()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and not revoked
  );
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin and not revoked
  );
$$;

create or replace function public.capacity_of(g public.games)
returns int language sql immutable as $$
  select coalesce(g.capacity_override, g.courts * g.per_court);
$$;

-- ---------- views ----------

-- aggregate balances visible to all members (Player Appearances page);
-- raw transactions stay restricted to owner + admins.
create view public.balances as
  select p.id as user_id, coalesce(sum(t.amount), 0)::numeric as balance
  from public.profiles p
  left join public.transactions t on t.user_id = p.id
  group by p.id;

create view public.club_balance as
  select
    coalesce((select (value->>'amount')::numeric from public.app_settings where key = 'club_seed'), 0)
    + coalesce((select sum(amount) from public.transactions where kind = 'payment'), 0)
    - coalesce((select sum(amount) from public.expenses), 0) as balance;

grant select on public.balances, public.club_balance to authenticated;

-- ---------- row level security ----------

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.games enable row level security;
alter table public.roster enable row level security;
alter table public.transactions enable row level security;
alter table public.penalties enable row level security;
alter table public.expenses enable row level security;
alter table public.matches enable row level security;
alter table public.presets enable row level security;
alter table public.month_recon enable row level security;
alter table public.app_settings enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "members read profiles" on public.profiles for select using (public.is_active());
create policy "admins edit profiles" on public.profiles for update using (public.is_admin());

create policy "admins manage invites" on public.invites for all using (public.is_admin());

create policy "members read games" on public.games for select using (public.is_active());
create policy "admins manage games" on public.games for insert with check (public.is_admin());
create policy "admins update games" on public.games for update using (public.is_admin());
create policy "admins delete games" on public.games for delete using (public.is_admin());

create policy "members read roster" on public.roster for select using (public.is_active());

create policy "own or admin transactions" on public.transactions for select
  using (user_id = auth.uid() or public.is_admin());

create policy "members read penalties" on public.penalties for select using (public.is_active());

create policy "admins expenses" on public.expenses for select using (public.is_admin());
create policy "admins add expenses" on public.expenses for insert with check (public.is_admin());

create policy "members read matches" on public.matches for select using (public.is_active());
create policy "admins insert matches" on public.matches for insert with check (public.is_admin());

create policy "members read presets" on public.presets for select using (public.is_active());
create policy "admins manage presets" on public.presets for all using (public.is_admin());

create policy "admins recon" on public.month_recon for all using (public.is_admin());
create policy "admins settings" on public.app_settings for all using (public.is_admin());

create policy "own push subs" on public.push_subscriptions for all using (user_id = auth.uid());

-- ---------- invite flow ----------

-- Member opens invite link -> app signs in anonymously -> calls accept_invite.
create or replace function public.accept_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites where token = p_token and used_by is null;
  if not found then raise exception 'Invite link is invalid or already used.'; end if;
  insert into public.profiles (id, name, phone, is_admin)
  values (auth.uid(), inv.name, inv.phone, inv.is_admin)
  on conflict (id) do nothing;
  update public.invites set used_by = auth.uid() where token = p_token;
end $$;

create or replace function public.create_invite(p_name text, p_phone text, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare tok uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.invites (name, phone, is_admin, created_by)
  values (p_name, p_phone, p_admin, auth.uid()) returning token into tok;
  return tok;
end $$;

-- ---------- roster flow ----------

create or replace function public.promote_next(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.games; nxt public.roster;
begin
  select * into g from public.games where id = p_game;
  select * into nxt from public.roster
   where game_id = p_game and status = 'wait'
   order by (kind = 'guest'), joined_at
   limit 1;
  if found then
    update public.roster
       set status = 'pending',
           pending_until = least(now() + interval '12 hours', g.starts_at)
     where id = nxt.id;
  end if;
end $$;

create or replace function public.join_game(p_game uuid)
returns text language plpgsql security definer set search_path = public as $$
declare g public.games; taken int; me public.profiles; st text;
begin
  select * into me from public.profiles where id = auth.uid() and not revoked;
  if not found or me.status = 'explayer' then raise exception 'Not permitted to join games.'; end if;
  select * into g from public.games where id = p_game and not closed;
  if not found then raise exception 'Game not open.'; end if;
  select count(*) into taken from public.roster where game_id = p_game and status in ('in','pending');
  st := case when taken < public.capacity_of(g) then 'in' else 'wait' end;
  insert into public.roster (game_id, user_id, kind, status) values (p_game, auth.uid(), 'member', st);
  return st;
end $$;

create or replace function public.add_guest(p_game uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.is_active() then raise exception 'Not permitted.'; end if;
  select count(*) into cnt from public.roster
   where game_id = p_game and user_id = auth.uid() and kind = 'guest';
  if cnt >= 2 then raise exception 'Guest limit reached (2 per member).'; end if;
  insert into public.roster (game_id, user_id, kind, guest_name, status)
  values (p_game, auth.uid(), 'guest', p_name, 'wait');
end $$;

create or replace function public.drop_out(p_roster uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.roster; g public.games; past_cutoff boolean;
begin
  select * into r from public.roster where id = p_roster;
  if not found then return; end if;
  if r.user_id <> auth.uid() and not public.is_admin() then raise exception 'Not permitted.'; end if;
  select * into g from public.games where id = r.game_id;
  if g.closed then raise exception 'Game already closed.'; end if;
  delete from public.roster where id = p_roster;
  past_cutoff := now() > g.starts_at - make_interval(hours => g.cutoff_hours);
  if r.status = 'in' and r.kind = 'member' and past_cutoff and g.penalty > 0 then
    insert into public.penalties (game_id, user_id, amount) values (g.id, r.user_id, g.penalty);
  end if;
  if r.status in ('in','pending') then perform public.promote_next(g.id); end if;
end $$;

create or replace function public.confirm_spot(p_roster uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.roster;
begin
  select * into r from public.roster where id = p_roster and status = 'pending';
  if not found then raise exception 'No pending spot.'; end if;
  -- own spot, or sponsor confirming their guest, or admin
  if r.user_id <> auth.uid() and not public.is_admin() then raise exception 'Not permitted.'; end if;
  update public.roster set status = 'in', pending_until = null where id = p_roster;
end $$;

-- ---------- money ----------

create or replace function public.close_game(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.games; rec record; n int := 0;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into g from public.games where id = p_game and not closed;
  if not found then raise exception 'Game not open.'; end if;
  for rec in
    select user_id, count(*) as slots,
           bool_or(kind = 'guest') as has_guest
      from public.roster where game_id = p_game and status = 'in'
     group by user_id
  loop
    insert into public.transactions (user_id, amount, kind, description, game_id, created_by)
    values (rec.user_id, -g.cost_per_player * rec.slots, 'game_fee',
            g.title || ' · game fee' ||
            case when rec.slots > 1 then format(' (incl. %s guest%s)', rec.slots - 1,
                 case when rec.slots > 2 then 's' else '' end) else '' end,
            g.id, auth.uid());
    n := n + rec.slots::int;
  end loop;
  if n = 0 then raise exception 'No confirmed players to bill.'; end if;
  update public.games
     set closed = true, closed_at = now(), actual_players = n, collected = n * cost_per_player
   where id = p_game;
end $$;

create or replace function public.resolve_penalty(p_penalty uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.penalties; g public.games;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_action not in ('applied','waived') then raise exception 'Bad action.'; end if;
  select * into p from public.penalties where id = p_penalty and status = 'pending';
  if not found then raise exception 'No pending penalty.'; end if;
  update public.penalties set status = p_action where id = p_penalty;
  if p_action = 'applied' then
    select * into g from public.games where id = p.game_id;
    insert into public.transactions (user_id, amount, kind, description, game_id, created_by)
    values (p.user_id, -p.amount, 'penalty', g.title || ' · late-drop penalty', g.id, auth.uid());
    update public.games set penalty_collected = penalty_collected + p.amount where id = p.game_id;
  end if;
end $$;

create or replace function public.record_payment(p_user uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount.'; end if;
  insert into public.transactions (user_id, amount, kind, description, created_by)
  values (p_user, p_amount, 'payment', 'Cash payment received', auth.uid());
end $$;

create or replace function public.transfer_balance(p_from uuid, p_to uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare fn text; tn text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_amount is null or p_amount <= 0 or p_from = p_to then raise exception 'Check transfer details.'; end if;
  select name into fn from public.profiles where id = p_from;
  select name into tn from public.profiles where id = p_to;
  insert into public.transactions (user_id, amount, kind, description, created_by) values
    (p_from, -p_amount, 'transfer', 'Balance transfer to ' || tn, auth.uid()),
    (p_to,    p_amount, 'transfer', 'Balance transfer from ' || fn, auth.uid());
end $$;

create or replace function public.seed_opening_balance(p_user uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.transactions (user_id, amount, kind, description, created_by)
  values (p_user, p_amount, 'seed', 'Opening balance (pre-app)', auth.uid());
end $$;

-- ---------- games: create + recurring ----------

create or replace function public.create_game(
  p_title text, p_location text, p_map_link text,
  p_starts timestamptz, p_ends timestamptz,
  p_courts int, p_per_court int, p_cap int,
  p_cutoff int, p_cost numeric, p_penalty numeric,
  p_rr text, p_recurring boolean, p_preset text
) returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.games (title, location, map_link, starts_at, ends_at, courts, per_court,
    capacity_override, cutoff_hours, cost_per_player, penalty, rr_mode, recurring, preset_key, created_by)
  values (p_title, coalesce(p_location,'TBC'), nullif(p_map_link,''), p_starts, p_ends, p_courts, p_per_court,
    p_cap, p_cutoff, p_cost, p_penalty, p_rr, p_recurring, nullif(p_preset,''), auth.uid())
  returning id into gid;
  if p_preset is not null and p_preset <> '' then
    for uid in select unnest(member_ids) from public.presets where key = p_preset loop
      insert into public.roster (game_id, user_id, kind, status)
      values (gid, uid, 'member', 'in') on conflict do nothing;
    end loop;
  end if;
  return gid;
end $$;

-- next week's game opens the day after the previous game ends (run by cron)
create or replace function public.spawn_recurring_games()
returns void language plpgsql security definer set search_path = public as $$
declare g public.games; gid uuid; uid uuid;
begin
  for g in
    select * from public.games
     where recurring and not successor_created and now() >= ends_at + interval '1 day'
  loop
    insert into public.games (title, location, map_link, starts_at, ends_at, courts, per_court,
      capacity_override, cutoff_hours, cost_per_player, penalty, rr_mode, recurring, preset_key, created_by)
    values (g.title, g.location, g.map_link, g.starts_at + interval '7 days', g.ends_at + interval '7 days',
      g.courts, g.per_court, g.capacity_override, g.cutoff_hours, g.cost_per_player, g.penalty,
      g.rr_mode, true, g.preset_key, g.created_by)
    returning id into gid;
    if g.preset_key is not null then
      for uid in select unnest(member_ids) from public.presets where key = g.preset_key loop
        insert into public.roster (game_id, user_id, kind, status)
        values (gid, uid, 'member', 'in') on conflict do nothing;
      end loop;
    end if;
    update public.games set successor_created = true where id = g.id;
  end loop;
end $$;

-- expire lapsed pending confirmations and pass the spot onward (run by cron)
create or replace function public.expire_pending()
returns void language plpgsql security definer set search_path = public as $$
declare r public.roster;
begin
  for r in select * from public.roster where status = 'pending' and pending_until < now() loop
    delete from public.roster where id = r.id;
    perform public.promote_next(r.game_id);
  end loop;
end $$;

-- pre-pay rule: checked at the START OF EACH MONTH (run by cron on the 1st)
create or replace function public.month_start_prepay_check()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set status = 'member'
   where p.status = 'prepay'
     and coalesce((select sum(amount) from public.transactions t where t.user_id = p.id), 0) < 150;
end $$;

-- ---------- round robin ----------

create or replace function public.record_result(p_match uuid, p_winner int)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; my_name text; g public.games;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found.'; end if;
  select * into g from public.games where id = m.game_id;
  if g.closed then raise exception 'Game closed — results locked.'; end if;
  select name into my_name from public.profiles where id = auth.uid();
  if not public.is_admin() and not (my_name = any(m.t1) or my_name = any(m.t2)) then
    raise exception 'Only players in this match (or an admin) can record the result.';
  end if;
  update public.matches set winner = p_winner, recorded_by = auth.uid() where id = p_match;
end $$;

-- ---------- realtime ----------

alter publication supabase_realtime add table
  public.games, public.roster, public.transactions, public.penalties,
  public.matches, public.profiles, public.expenses;

-- ---------- cron (pg_cron ships enabled on Supabase) ----------

create extension if not exists pg_cron;
select cron.schedule('expire-pending',   '*/10 * * * *', $$select public.expire_pending()$$);
select cron.schedule('spawn-recurring',  '0 * * * *',    $$select public.spawn_recurring_games()$$);
select cron.schedule('prepay-monthly',   '0 3 1 * *',    $$select public.month_start_prepay_check()$$);

-- ---------- seed: predefined lists (fill member_ids after members join) ----------

insert into public.presets (key, label) values
  ('sat', 'Saturday list'), ('tue', 'Tuesday list');

-- ============================================================
-- BOOTSTRAP THE FIRST ADMIN (run once, then open the app with
-- /?invite=<token> from the row this returns):
--
--   insert into public.invites (name, phone, is_admin)
--   values ('Assad', '+971 50 111 2222', true)
--   returning token;
-- ============================================================
