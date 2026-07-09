# Shuttlers Badminton Club UAE — Production App

Installable PWA (iOS + Android browsers) · React + Vite · Supabase (auth, database, realtime) · Vercel hosting. Runs entirely on free tiers.

## What's implemented

Everything from the v3 spec: invite-only access with instant revocation, one-off & weekly recurring games (next week opens the day after the previous game ends — automated via pg_cron), tap-to-join with waitlists, guests (max 2/member, shown as "Zara (Mel)", always below members), auto-promotion with a real 12-hour/game-start confirmation window (expired confirmations pass the spot onward automatically), automatic cutoff timing with late-drop penalties (charge/waive), close-game billing to every confirmed player including admins, custom cash receipts, balance transfers, per-member 6-month transaction history, player appearances page (balance heat-map, total games, % of last 20 games), admin-seeded initial data, player statuses with the automated month-start pre-pay check (AED 150 rule), predefined Saturday/Tuesday lists with auto-confirm, doubles round robin with per-match result recording by participants and a live points table, expenses, and the monthly consolidation report with manual opening/actual-closing reconciliation and cross-check variance.

## Setup (one-time, ~20 minutes)

### 1. Supabase project
1. Create a free project at https://supabase.com (choose a region near UAE, e.g. `ap-south-1`).
2. **Authentication → Sign In / Up → Anonymous sign-ins → Enable.** (This powers the "open the invite link once, stay signed in" flow.)
3. Open the **SQL Editor**, paste the entire contents of `supabase/schema.sql`, and run it.
4. Still in the SQL editor, bootstrap the first admin:
   ```sql
   insert into public.invites (name, phone, is_admin)
   values ('Assad', '+971 50 111 2222', true)
   returning token;
   ```
   Keep the returned token — that's Assad's invite.
5. From **Project Settings → API**, copy the **Project URL** and **anon public key**.

### 2. Deploy to Vercel
1. Push this folder to a GitHub repo (or use `vercel` CLI).
2. Import the repo at https://vercel.com — framework preset **Vite** is detected automatically.
3. Add two environment variables:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. Deploy. Note your app URL, e.g. `https://shuttlers.vercel.app`.

### 3. First sign-in and rollout
1. Open `https://<your-app>/?invite=<token-from-step-1.4>` — you're in as the first admin.
2. In **Admin → Invite a member**, generate links for Mustafa and Anil (tick "Admin"), then everyone else, and share each link on WhatsApp. Each link works exactly once.
3. In **Admin → Predefined player lists**, tap members into the Saturday and Tuesday lists.
4. On each player's profile (**Players → tap name**), set date joined, games before the app, and record their opening balance.
5. Create the two recurring games (tick "Repeat weekly" and pick the matching list). From then on the app spawns next week's game automatically.
6. Everyone can **Add to Home Screen** from their browser menu — the app installs like a native app.

## Scheduled automation (already wired in schema.sql via pg_cron)
- every 10 min: expire lapsed 12-hour confirmations and promote the next in line
- hourly: open next week's recurring games (day after the previous game ends)
- 1st of each month: pre-pay check (under AED 150 → auto-update to Member)

Verify at **Database → Cron Jobs** in the Supabase dashboard.

## Push notifications (optional but fully built — ~10 extra minutes)
Everything is included: the service worker displays pushes, members get an "Enable alerts" button, an Edge Function delivers them, and database triggers fire on the right events — new game announced (everyone), waitlist promotion (that member/sponsor), game fee / penalty / payment (that member), and a 24-hour game reminder to confirmed players. To activate:

1. `npx web-push generate-vapid-keys` — note the public and private key.
2. Deploy the function: `supabase functions deploy send-push --no-verify-jwt`, then
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... PUSH_SECRET=<any-random-string>`.
3. In the Supabase SQL editor, insert the `push_config` row (see the header of `supabase/push-triggers.sql`), then run that whole file.
4. In Vercel, add `VITE_VAPID_PUBLIC_KEY` (the public key) and redeploy.

Members then tap "🔔 Enable alerts" once per device. If you skip this, the app still works fully — WhatsApp announcements plus in-app realtime updates cover the same ground.

## Local development
```bash
cp .env.example .env       # fill in your Supabase values
npm install
npm run dev
```

## Notes
- All money logic lives in Postgres functions (`schema.sql`) behind row-level security — the client can't bypass billing rules, and members can only ever read their own transactions (aggregate balances are exposed club-wide for the appearances page, per the admin decision).
- Revocation is instant: every data read re-checks the profile, and a revoked member sees only the "access revoked" screen.
- Recurring games carry their preset list forward, so the Saturday regulars are auto-confirmed each week without admin action.
