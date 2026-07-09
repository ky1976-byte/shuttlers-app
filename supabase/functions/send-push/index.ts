// Supabase Edge Function: send-push
// Sends a web-push notification to one member, a list of members, or the whole club.
//
// Deploy:   supabase functions deploy send-push --no-verify-jwt
// Secrets:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... PUSH_SECRET=<random-string>
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Invoke with:
//   POST /functions/v1/send-push
//   Header:  x-push-secret: <PUSH_SECRET>
//   Body:    { "user_ids": ["uuid", ...] | null, "title": "...", "body": "..." }
//   user_ids null/omitted = notify every subscribed member.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  "mailto:admin@shuttlersbc.example",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { user_ids, title, body } = await req.json();

  let q = supabase.from("push_subscriptions").select("id, user_id, subscription");
  if (Array.isArray(user_ids) && user_ids.length) q = q.in("user_id", user_ids);
  const { data: subs, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  await Promise.all((subs ?? []).map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body }));
      sent++;
    } catch (e) {
      // 404/410 = subscription expired; clean it up
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", row.id);
      }
    }
  }));

  return new Response(JSON.stringify({ sent, of: subs?.length ?? 0 }), {
    headers: { "content-type": "application/json" },
  });
});
