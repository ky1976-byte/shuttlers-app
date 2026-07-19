import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, configured, rpc } from "./lib/supabase.js";

/* ------------------------------------------------------------------ */
/*  SHUTTLERS BC — production app (Supabase + PWA)                     */
/* ------------------------------------------------------------------ */

const T = {
  bg: "#F4F7FB", ink: "#101C2E", court: "#1B4E9B", courtDark: "#0E2F63",
  line: "#D7E0EC", shuttle: "#FFD84D", red: "#C0452B", amber: "#B07908",
  green: "#1F7A4D", card: "#FFFFFF", sub: "#5A6B82",
};
const font = { display: "'Archivo', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" };
const inputStyle = { border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: font.body };
const APP_VERSION = "1.1.0";
const APP_UPDATED = "11 July 2026";

/* ---------------- ui atoms ---------------- */

const Pill = ({ children, tone = "court" }) => {
  const map = {
    court: { bg: "#E3ECFA", fg: T.courtDark }, wait: { bg: "#FBF3DC", fg: T.amber },
    red: { bg: "#F9E7E2", fg: T.red }, ink: { bg: "#E8ECF2", fg: T.ink },
    gold: { bg: T.shuttle, fg: T.ink }, green: { bg: "#E2F3E9", fg: T.green },
  };
  const c = map[tone];
  return <span style={{ background: c.bg, color: c.fg, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, letterSpacing: 0.3, whiteSpace: "nowrap" }}>{children}</span>;
};

const Card = ({ children, onClick, style }) => (
  <div onClick={onClick} style={{ background: T.card, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(16,28,46,0.05)", borderRadius: 14, padding: 16, cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>
);

const Btn = ({ children, tone = "court", onClick, small, disabled, style }) => {
  const styles = {
    court: { background: T.court, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: T.court, border: `1.5px solid ${T.court}` },
    red: { background: "transparent", color: T.red, border: `1.5px solid ${T.red}` },
    gold: { background: T.shuttle, color: T.ink, border: "none" },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...styles[tone], opacity: disabled ? 0.4 : 1, fontFamily: font.body, fontWeight: 600, fontSize: small ? 12.5 : 14, padding: small ? "7px 12px" : "11px 18px", borderRadius: 10, cursor: disabled ? "default" : "pointer", ...style }}>
      {children}
    </button>
  );
};

const CourtRule = () => (
  <div style={{ margin: "4px 0 12px" }}>
    <div style={{ height: 2, background: T.court, opacity: 0.85 }} />
    <div style={{ height: 2, background: T.court, opacity: 0.25, marginTop: 3 }} />
  </div>
);

const SectionHead = ({ children, color = T.courtDark }) => (
  <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 13, letterSpacing: 1, color, marginTop: 16 }}>{children}</div>
);

const StatusPill = ({ status }) =>
  status === "prepay" ? <Pill tone="green">Pre-pay</Pill> :
  status === "explayer" ? <Pill tone="ink">Ex-player</Pill> :
  <Pill tone="court">Member</Pill>;

/* iOS-Contacts-style A-Z index. Tap or drag a finger down the rail to
   jump the page to the first name starting with that letter. Letters
   with no matching name are shown dimmed and inert. `refs` is a
   useRef({}) map of profile id -> row DOM node, populated by the
   caller via a ref callback on each row. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
function AlphabetRail({ profiles, refs }) {
  const firstIdForLetter = useMemo(() => {
    const map = new Map();
    for (const u of profiles) {
      const l = (u.name?.[0] || "").toUpperCase();
      if (/[A-Z]/.test(l) && !map.has(l)) map.set(l, u.id);
    }
    return map;
  }, [profiles]);

  const jump = (letter) => {
    const id = firstIdForLetter.get(letter);
    const el = id && refs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleTouch = (e) => {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const letter = el?.getAttribute("data-letter");
    if (letter) jump(letter);
  };

  return (
    <div
      onTouchMove={handleTouch}
      style={{
        position: "fixed", right: 2, top: "50%", transform: "translateY(-50%)", zIndex: 20,
        display: "flex", flexDirection: "column", alignItems: "center",
        background: "rgba(255,255,255,0.9)", borderRadius: 10, padding: "4px 3px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
      }}>
      {ALPHABET.map((l) => {
        const has = firstIdForLetter.has(l);
        return (
          <span key={l} data-letter={l} onClick={() => has && jump(l)}
            style={{ fontSize: 9, fontWeight: 700, lineHeight: "12px", color: has ? T.court : "#D3DAE6", padding: "0 3px", cursor: has ? "pointer" : "default", userSelect: "none" }}>
            {l}
          </span>
        );
      })}
    </div>
  );
}

const Screen = ({ children }) => (
  <div style={{ fontFamily: font.body, background: T.courtDark, minHeight: "100vh", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
    <div style={{ maxWidth: 420, textAlign: "center" }}>
      <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 26 }}>Shuttlers<span style={{ color: T.shuttle }}> Club</span></div>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 20 }}>Shuttlers Badminton Club UAE</div>
      {children}
    </div>
  </div>
);

/* ---------------- helpers ---------------- */

const capacityOf = (g) => g.capacity_override ?? g.courts * g.per_court;
// Hardcoded club-wide cutoff: how many hours before a game's start
// time late-drop penalties kick in, and guests become eligible for
// waitlist promotion. No longer per-game configurable.
const DROP_CUTOFF_HOURS = 72;
const isPastCutoff = (g) => Date.now() > new Date(g.starts_at).getTime() - DROP_CUTOFF_HOURS * 3600 * 1000;
const isPastStart = (g) => Date.now() > new Date(g.starts_at).getTime();
// All display times are pinned to UAE time (Asia/Dubai, UTC+4, no DST),
// regardless of the viewing device's own timezone/location — so a
// member traveling abroad still sees game times exactly as they are
// in UAE, not shifted to wherever their phone currently thinks it is.
const UAE_TZ = "Asia/Dubai";
const fmtDT = (g) => {
  const s = new Date(g.starts_at), e = new Date(g.ends_at);
  const day = s.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UAE_TZ });
  const t = (d) => d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: UAE_TZ });
  return `${day} · ${t(s)}–${t(e)}`;
};
const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: UAE_TZ });

function orderedWaitlist(roster) {
  const waits = roster.filter((r) => r.status === "wait");
  const byTime = (a, b) => new Date(a.joined_at) - new Date(b.joined_at);
  return [...waits.filter((r) => r.kind === "member").sort(byTime), ...waits.filter((r) => r.kind === "guest").sort(byTime)];
}

/* doubles round robin via circle method */
function roundRobin(names, courts) {
  const list = [...names];
  while (list.length % 4 !== 0) list.push("— sits out —");
  const n = list.length, rounds = [], arr = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    const matches = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const [p1, p2] = [pairs[i], pairs[i + 1]];
      const t1 = [p1[0], p2[0]], t2 = [p1[1], p2[1]];
      if (![...t1, ...t2].includes("— sits out —") && matches.length < courts)
        matches.push({ court: matches.length + 1, t1, t2 });
    }
    if (matches.length) rounds.push(matches);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

function pointsTable(matches) {
  const pts = {};
  matches.forEach((m) => {
    [...m.t1, ...m.t2].forEach((p) => { if (!(p in pts)) pts[p] = 0; });
    if (m.winner) (m.winner === 1 ? m.t1 : m.t2).forEach((p) => (pts[p] += 1));
  });
  return Object.entries(pts).sort((a, b) => b[1] - a[1]);
}

/* ---------------- app ---------------- */

export default function App() {
  const [phase, setPhase] = useState("boot"); // boot | invite | denied | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [games, setGames] = useState([]);
  const [balances, setBalances] = useState([]);
  const [txns, setTxns] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [matches, setMatches] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [presets, setPresets] = useState([]);
  const [clubBalance, setClubBalance] = useState(0);
  const [recon, setRecon] = useState(null);
  const [tab, setTab] = useState("games");
  const [openGame, setOpenGame] = useState(null);
  const [openPlayer, setOpenPlayer] = useState(null);
  const [toast, setToast] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const reloadTimer = useRef(null);

  const notify = (m) => { setToast(String(m)); setTimeout(() => setToast(null), 3800); };
  const run = async (fn, okMsg) => {
    try { await fn(); if (okMsg) notify(okMsg); await loadAll(); }
    catch (e) { notify(e.message); }
  };

  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || "?";
  const balOf = (id) => balances.find((b) => b.user_id === id)?.balance ?? 0;
  const isAdmin = !!me?.is_admin;

  /* ---- auth bootstrap ---- */
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  /* Redeem an invite from a pasted link or raw token. Used both for the
     normal ?invite= URL flow AND the manual "paste your link" fallback —
     iOS home-screen icons get their own isolated storage separate from
     Safari, so a link opened in Safari can't hand off a session to the
     icon. Pasting the link straight into the icon's own "Members only"
     screen lets it sign in for real inside that isolated storage. */
  const redeemInvite = async (raw) => {
    setInviteError(""); setInviteBusy(true);
    try {
      let token = (raw || "").trim();
      const m = token.match(/invite=([a-zA-Z0-9-]+)/);
      if (m) token = m[1];
      if (!token) throw new Error("Paste your invite link or code first.");
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        session = (await supabase.auth.getSession()).data.session;
      }
      await rpc("accept_invite", { p_token: token });
      const { data: prof } = await supabase.from("profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
      if (!prof) throw new Error("Signed in, but no profile found — contact an admin.");
      if (prof.revoked) { setPhase("denied"); return; }
      window.history.replaceState({}, "", "/");
      setMe(prof);
      setPhase("ready");
    } catch (e) {
      setInviteError(e.message || "Could not redeem that invite.");
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    if (!configured) { setPhase("error"); setErrMsg("App not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."); return; }
    (async () => {
      try {
        const inviteToken = new URLSearchParams(window.location.search).get("invite");
        let { data: { session } } = await supabase.auth.getSession();
        if (!session && inviteToken) {
          const { error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          session = (await supabase.auth.getSession()).data.session;
        }
        if (!session) { setPhase("invite"); return; }
        if (inviteToken) {
          try { await rpc("accept_invite", { p_token: inviteToken }); } catch (e) { /* already used by me is fine if profile exists */ }
          window.history.replaceState({}, "", "/");
        }
        const { data: prof } = await supabase.from("profiles").select("*").eq("auth_id", session.user.id).maybeSingle();
        if (!prof) { setPhase("invite"); return; }
        if (prof.revoked) { setPhase("denied"); return; }
        setMe(prof);
        setPhase("ready");
      } catch (e) { setPhase("error"); setErrMsg(e.message); }
    })();
  }, []);

  /* ---- data loading ---- */
  const loadAll = async () => {
    if (!supabase) return;
    try { await rpc("check_promotions"); } catch (e) { /* non-critical — next load will retry */ }
    const [pr, gm, bl, tx, pe, ma, ex, ps, cb, rc] = await Promise.all([
      supabase.from("profiles").select("*").order("name"),
      supabase.from("games").select("*, roster(*)").order("starts_at", { ascending: true }),
      supabase.from("balances").select("*"),
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("penalties").select("*"),
      supabase.from("matches").select("*").order("round").order("court"),
      supabase.from("expenses").select("*").order("spent_on", { ascending: false }),
      supabase.from("presets").select("*"),
      supabase.from("club_balance").select("*").maybeSingle(),
      supabase.from("month_recon").select("*"),
    ]);
    setProfiles(pr.data || []);
    setGames(gm.data || []);
    setBalances(bl.data || []);
    setTxns(tx.data || []);
    setPenalties(pe.data || []);
    setMatches(ma.data || []);
    setExpenses(ex.data || []);
    setPresets(ps.data || []);
    setClubBalance(cb.data?.balance ?? 0);
    const monthKey = new Date().toISOString().slice(0, 8) + "01";
    setRecon((rc.data || []).find((r) => r.month === monthKey) || { month: monthKey, opening: 0, actual_closing: null });
    if (me) {
      const { data: fresh } = await supabase.from("profiles").select("*").eq("id", me.id).maybeSingle();
      if (fresh) { if (fresh.revoked) setPhase("denied"); setMe(fresh); }
    }
    /* note: this lookup is correctly by id (not auth_id) — me.id is the
       stable profile id we already resolved at sign-in, not an auth id. */
  };

  useEffect(() => { if (phase === "ready") loadAll(); /* eslint-disable-next-line */ }, [phase]);

  /* ---- realtime: refetch (debounced) on any change ---- */
  useEffect(() => {
    if (phase !== "ready" || !supabase) return;
    const ch = supabase.channel("club")
      .on("postgres_changes", { event: "*", schema: "public" }, () => {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(loadAll, 400);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    /* eslint-disable-next-line */
  }, [phase]);

  /* ---- push notifications (optional: needs VITE_VAPID_PUBLIC_KEY) ---- */
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return notify("Notifications not allowed by the browser.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid });
      await supabase.from("push_subscriptions").insert({ user_id: me.id, subscription: sub.toJSON() });
      notify("Push notifications enabled on this device.");
    } catch (e) { notify("Could not enable push: " + e.message); }
  };

  /* ---- screens ---- */
  if (phase === "boot") return <Screen><div style={{ fontSize: 14, opacity: 0.85 }}>Loading…</div></Screen>;
  if (phase === "error") return <Screen><div style={{ fontSize: 14, color: "#FFB4A0" }}>{errMsg}</div></Screen>;
  if (phase === "denied") return (
    <Screen>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Access revoked</div>
      <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>Your membership has been revoked by a club admin. Contact Assad, Mustafa or Anil if you think this is a mistake.</div>
    </Screen>
  );
  if (phase === "invite") return (
    <Screen>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Members only</div>
      <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>
        This app is invite-only. Ask a club admin (Assad, Mustafa or Anil) to send you a one-time invite link on WhatsApp, then open it on this device — you'll stay signed in.
      </div>
      <div style={{ marginTop: 18, textAlign: "left", background: "#0A2450", border: "1px solid #2A4E8F", borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>📱 On iPhone? Add to Home Screen first</div>
        <div style={{ fontSize: 11.5, opacity: 0.85, lineHeight: 1.5 }}>
          Before opening your invite link, tap <b>Share → Add to Home Screen</b> right here in Safari. Then open the new icon and open (or paste) your invite link from there.
          <br /><br />
          Opening the link in Safari first uses it up there — it won't work again on the Home Screen icon afterward.
        </div>
      </div>
      <div style={{ marginTop: 20, textAlign: "left" }}>
        <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 6 }}>
          Already have a link? Paste it below — useful if this is a home screen icon that isn't picking up the link automatically.
        </div>
        <input
          value={inviteInput}
          onChange={(e) => setInviteInput(e.target.value)}
          placeholder="Paste invite link or code"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #2A4E8F", background: "#0A2450", color: "#fff", fontSize: 13 }}
        />
        {inviteError && (
          <div style={{ color: "#FFB4A0", fontSize: 12, marginTop: 6 }}>
            {inviteError}
            {/invalid|used/i.test(inviteError) && " — this link was already opened somewhere else (often Safari, before adding to Home Screen). Ask your admin for a fresh one."}
          </div>
        )}
        <button
          disabled={inviteBusy}
          onClick={() => redeemInvite(inviteInput)}
          style={{ marginTop: 10, width: "100%", background: T.shuttle, color: T.ink, border: "none", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: inviteBusy ? "default" : "pointer", opacity: inviteBusy ? 0.6 : 1 }}>
          {inviteBusy ? "Signing in…" : "Sign in with this link"}
        </button>
      </div>
    </Screen>
  );

  const game = games.find((g) => g.id === openGame);
  const playerOpen = profiles.find((p) => p.id === openPlayer);
  const tabs = [["games", "Games"], ["players", "Players"], ["ledger", "Ledger"], ...(isAdmin ? [["reports", "Reports"], ["admin", "Admin"]] : [])];

  return (
    <div style={{ fontFamily: font.body, background: T.bg, minHeight: "100vh", color: T.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Inter:wght@400;500;600&display=swap');
        *{box-sizing:border-box} button{font-family:inherit} input,select{font-family:inherit}`}</style>

      <div style={{ background: T.courtDark, color: "#fff", padding: "18px 18px 14px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 22, letterSpacing: -0.4 }}>
                Shuttlers<span style={{ color: T.shuttle }}> Club</span>
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.75 }}>Hi {me.name}{isAdmin ? " · admin" : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {vapid && "Notification" in window && Notification.permission === "default" && (
                <button onClick={enablePush} style={{ background: "#0A2450", color: "#fff", border: "1px solid #2A4E8F", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
                  🔔 Enable alerts
                </button>
              )}
              <button onClick={() => setShowAbout(true)} aria-label="About Shuttlers Club" style={{ background: "#0A2450", color: "#fff", border: "1px solid #2A4E8F", borderRadius: 8, width: 30, height: 30, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ⓘ
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => { setTab(k); setOpenGame(null); setOpenPlayer(null); }}
                style={{ background: tab === k ? T.shuttle : "transparent", color: tab === k ? T.ink : "#C6D6EE", border: "none", fontWeight: 600, fontSize: 13, padding: "7px 14px", borderRadius: 999, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: 18 }}>
        {tab === "games" && !game && (
          <GamesList games={games} me={me} isAdmin={isAdmin} presets={presets} onOpen={setOpenGame} notify={notify}
            onCreate={(f) => run(() => rpc("create_game", f), "Game created — announce the link on WhatsApp.")} />
        )}

        {tab === "games" && game && (
          <GameDetail game={game} matches={matches.filter((m) => m.game_id === game.id)}
            penalties={penalties.filter((p) => p.game_id === game.id)}
            profiles={profiles} me={me} isAdmin={isAdmin} nameOf={nameOf}
            onBack={() => setOpenGame(null)}
            onJoin={() => run(async () => {
              const st = await rpc("join_game", { p_game: game.id });
              notify(st === "in" ? "You're in! Notification sent." : "Game full — you're on the waitlist.");
            })}
            onGuest={(n) => run(() => rpc("add_guest", { p_game: game.id, p_name: n }), `${n} added to waitlist (guest priority).`)}
            onDrop={(r) => run(() => rpc("drop_out", { p_roster: r.id }))}
            onConfirm={(r) => run(() => rpc("confirm_spot", { p_roster: r.id }), "Spot confirmed. See you on court!")}
            onDecline={(r) => run(() => rpc("drop_out", { p_roster: r.id }))}
            onClose={() => run(() => rpc("close_game", { p_game: game.id }), "Game closed & players billed.")}
            onCancel={() => {
              if (!window.confirm(`Cancel "${game.title}"? This permanently deletes the game, its roster, and any match results. This cannot be undone.`)) return;
              run(() => rpc("cancel_game", { p_game: game.id }), "Game cancelled and removed.").then(() => setOpenGame(null));
            }}
            onCost={(v) => run(() => supabase.from("games").update({ cost_per_player: v }).eq("id", game.id).then(({ error }) => { if (error) throw error; }))}
            onPenaltyAmt={(v) => run(() => supabase.from("games").update({ penalty: v }).eq("id", game.id).then(({ error }) => { if (error) throw error; }))}
            onResize={(courts, perCourt, cap) => run(() => rpc("update_game_config", { p_game: game.id, p_courts: courts, p_per_court: perCourt, p_cap: cap }), "Game size updated — overflow moved to waitlist / new spots offered from waitlist.")}
            onResolvePenalty={(pid, a) => run(() => rpc("resolve_penalty", { p_penalty: pid, p_action: a }), a === "applied" ? "Penalty charged." : "Penalty waived.")}
            onTournament={() => run(async () => {
              const names = game.roster.filter((r) => r.status === "in")
                .map((r) => (r.kind === "guest" ? `${r.guest_name} (${nameOf(r.user_id)})` : nameOf(r.user_id)));
              if (names.length < 4) throw new Error("Need at least 4 confirmed players for doubles.");
              const rounds = roundRobin(names, game.courts);
              const rows = rounds.flatMap((round, ri) => round.map((m) => ({ game_id: game.id, round: ri + 1, court: m.court, t1: m.t1, t2: m.t2 })));
              const { error } = await supabase.from("matches").insert(rows);
              if (error) throw error;
            }, "Round robin created — results shared with attendees.")}
            onWinner={(mid, w) => run(() => rpc("record_result", { p_match: mid, p_winner: w }))} />
        )}

        {tab === "players" && !playerOpen && (
          <PlayersView profiles={profiles} balances={balances} games={games} onOpen={setOpenPlayer} isAdmin={isAdmin} />
        )}
        {tab === "players" && playerOpen && (
          <PlayerDetail u={playerOpen} bal={balOf(playerOpen.id)} games={games} isAdmin={isAdmin} isSelf={playerOpen.id === me.id}
            onBack={() => setOpenPlayer(null)}
            onSeed={(field, value) => run(() => supabase.from("profiles").update({ [field]: value }).eq("id", playerOpen.id).then(({ error }) => { if (error) throw error; }))}
            onOpeningBalance={(amt) => run(() => rpc("seed_opening_balance", { p_user: playerOpen.id, p_amount: amt }), "Opening balance recorded.")}
            onAwayUntil={(date) => run(() => rpc("set_away_until", { p_profile: playerOpen.id, p_until: date }), date ? `Away until ${date} — skipped from list auto-fill till then.` : "Away date cleared.")} />
        )}

        {tab === "ledger" && (
          <LedgerView me={me} isAdmin={isAdmin} profiles={profiles} balances={balances} txns={txns}
            clubBalance={clubBalance} nameOf={nameOf}
            onPay={(id, amt, mode, date, remark) => run(() => rpc("record_payment", { p_user: id, p_amount: amt, p_mode: mode, p_date: date, p_remark: remark }), `AED ${amt} received into club account.`)}
            onTransfer={(f, t, amt) => run(() => rpc("transfer_balance", { p_from: f, p_to: t, p_amount: amt }), "Transfer recorded.")} />
        )}

        {tab === "reports" && isAdmin && (
          <ReportsView games={games} expenses={expenses} recon={recon} clubBalance={clubBalance} txns={txns}
            onRecon={(patch) => run(() => supabase.from("month_recon").upsert({ ...recon, ...patch }).then(({ error }) => { if (error) throw error; }))}
            onExpense={(exp) => run(() => supabase.from("expenses").insert({ ...exp, created_by: me.id }).then(({ error }) => { if (error) throw error; }), "Expense recorded (paid from club account).")} />
        )}

        {tab === "admin" && isAdmin && (
          <AdminView profiles={profiles} presets={presets} me={me} notify={notify}
            onInvite={async (name, phone, admin) => {
              try {
                const token = await rpc("create_invite", { p_name: name, p_phone: phone, p_admin: admin });
                const link = `${window.location.origin}/?invite=${token}`;
                const bare = window.location.origin;
                const message = `🏸 Welcome to Shuttlers Club!\n\n` +
                  `📱 iPhone: don't tap the link below yet —\n` +
                  `1. Open Safari and go to: ${bare}\n` +
                  `2. Tap Share → Add to Home Screen\n` +
                  `3. Open the new icon from your Home Screen\n` +
                  `4. Paste this link into it: ${link}\n\n` +
                  `🤖 Android: just tap this link — ${link}\n\n` +
                  `Questions? Ask Assad, Mustafa or Anil.`;
                await navigator.clipboard.writeText(message).catch(() => {});
                notify(`Invite message for ${name} copied — paste it straight into WhatsApp.`);
                return link;
              } catch (e) { notify(e.message); }
            }}
            onRevoke={(id, revoked) => run(() => supabase.from("profiles").update({ revoked }).eq("id", id).then(({ error }) => { if (error) throw error; }), revoked ? "Member revoked — access ends instantly." : "Member re-approved.")}
            onStatus={(id, status) => run(() => supabase.from("profiles").update({ status }).eq("id", id).then(({ error }) => { if (error) throw error; }))}
            onRegenerate={(id, name) => run(async () => {
              const token = await rpc("regenerate_invite", { p_profile_id: id });
              const link = `${window.location.origin}/?invite=${token}`;
              await navigator.clipboard.writeText(link).catch(() => {});
            }, `New link for ${name} copied — the old link no longer works.`)}
            onPreset={(key, members) => run(() => supabase.from("presets").update({ members }).eq("key", key).then(({ error }) => { if (error) throw error; }), "List updated.")}
            onAwayUntil={(id, date) => run(() => rpc("set_away_until", { p_profile: id, p_until: date }), date ? `Away until ${date} set.` : "Away date cleared.")}
            onMonthCheck={() => run(() => rpc("month_start_prepay_check"), "Month-start pre-pay check completed.")} />
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: T.ink, color: "#fff", padding: "11px 18px", borderRadius: 12, fontSize: 13, maxWidth: "88%", boxShadow: "0 6px 20px rgba(0,0,0,0.25)", zIndex: 50 }}>
          🔔 {toast}
        </div>
      )}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}

/* ---------------- about ---------------- */

function AboutModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,28,46,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.card, borderRadius: 16, padding: 22, maxWidth: 320, width: "100%", textAlign: "center" }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 20 }}>
          Shuttlers<span style={{ color: T.amber }}> Club</span>
        </div>
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 4 }}>Shuttlers Badminton Club UAE</div>
        <div style={{ height: 1, background: T.line, margin: "16px 0" }} />
        <div style={{ fontSize: 13, color: T.sub }}>Version {APP_VERSION}</div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>Updated {APP_UPDATED}</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 16 }}>© {new Date().getFullYear()} Kamal. All rights reserved.</div>
        <button onClick={onClose} style={{ marginTop: 18, background: T.court, color: "#fff", border: "none", borderRadius: 10, padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------------- games list ---------------- */

function GamesList({ games, me, isAdmin, presets, onOpen, onCreate, notify }) {
  const [showCreate, setShowCreate] = useState(false);
  const [f, setF] = useState({ title: "", location: "", map_link: "", starts: "", duration: 120, courts: 2, per_court: 4, cap: "", cost: 40, penalty: 15, rr: "manual", recurring: false, preset: "" });
  const lbl = { fontSize: 12, fontWeight: 600, color: T.sub, display: "block", marginBottom: 4, marginTop: 10 };
  const input = { ...inputStyle, width: "100%" };
  const open = games.filter((g) => !g.closed);
  const closed = games.filter((g) => g.closed).slice(-5).reverse();
  const CardFor = (g) => {
    const cap = capacityOf(g);
    const inN = g.roster.filter((r) => r.status === "in").length;
    const waitN = g.roster.filter((r) => r.status === "wait").length;
    const mine = g.roster.find((r) => r.kind === "member" && r.user_id === me.id);
    return (
      <Card key={g.id} onClick={() => onOpen(g.id)} style={{ marginBottom: 14, opacity: g.closed ? 0.75 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 17 }}>{g.title}</div>
            <div style={{ fontSize: 12.5, color: T.sub, marginTop: 3 }}>{fmtDT(g)}</div>
            <div style={{ fontSize: 12.5, color: T.sub }}>{g.location}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {g.recurring && <Pill tone="ink">Weekly</Pill>}
            <div style={{ marginTop: 6 }}>
              {g.closed ? <Pill tone="red">Closed & billed</Pill> : mine ? (
                <Pill tone={mine.status === "in" ? "court" : mine.status === "pending" ? "gold" : "wait"}>
                  {mine.status === "in" ? "You're in" : mine.status === "pending" ? "Confirm spot!" : "Waitlisted"}
                </Pill>
              ) : (
                <Pill tone={inN < cap ? "court" : "wait"}>{inN < cap ? "Spots open" : "Waitlist"}</Pill>
              )}
            </div>
          </div>
        </div>
        <CourtRule />
        <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: T.sub, flexWrap: "wrap" }}>
          <span><b style={{ color: T.ink }}>{inN}/{cap}</b> playing</span>
          <span><b style={{ color: T.ink }}>{waitN}</b> waiting</span>
          <span><b style={{ color: T.ink }}>{g.courts}</b> court{g.courts > 1 ? "s" : ""}</span>
          <span>AED <b style={{ color: T.ink }}>{g.cost_per_player}</b>/player</span>
        </div>
      </Card>
    );
  };
  return (
    <>
      {open.map(CardFor)}
      {!open.length && <Card><div style={{ fontSize: 13, color: T.sub }}>No open games right now. Recurring games open the day after the previous one ends.</div></Card>}
      {closed.length > 0 && <><SectionHead>RECENTLY CLOSED</SectionHead><div style={{ height: 8 }} />{closed.map(CardFor)}</>}
      {isAdmin && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15 }}>New game</div>
            <Btn small tone="gold" onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Close" : "+ Create game"}</Btn>
          </div>
          {showCreate && (
            <div style={{ marginTop: 6 }}>
              <label style={lbl}>Title</label>
              <input style={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Sunday Doubles" />
              <label style={lbl}>Location</label>
              <input style={input} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Venue, area" />
              <label style={lbl}>Google Maps link (optional)</label>
              <input style={input} value={f.map_link} onChange={(e) => setF({ ...f, map_link: e.target.value })} placeholder="https://maps.google.com/..." />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: "1.6 1 0%", minWidth: 0 }}>
                  <label style={lbl}>Starts</label>
                  <input type="datetime-local" style={input} value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} />
                </div>
                <div style={{ flex: "1 1 0%", minWidth: 0 }}>
                  <label style={lbl}>Duration (min)</label>
                  <input type="number" step={15} style={input} value={f.duration} onChange={(e) => setF({ ...f, duration: +e.target.value })} />
                </div>
              </div>
              {f.starts && f.duration > 0 && (
                <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>
                  Ends {new Date(new Date(f.starts).getTime() + f.duration * 60000).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: UAE_TZ })}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Courts</label><input type="number" style={input} value={f.courts} onChange={(e) => setF({ ...f, courts: +e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Players / court</label><input type="number" style={input} value={f.per_court} onChange={(e) => setF({ ...f, per_court: +e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Override cap</label><input type="number" style={input} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} placeholder={String(f.courts * f.per_court)} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Cost / player (AED)</label><input type="number" style={input} value={f.cost} onChange={(e) => setF({ ...f, cost: +e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Late penalty (AED)</label><input type="number" style={input} value={f.penalty} onChange={(e) => setF({ ...f, penalty: +e.target.value })} /></div>
              </div>
              <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>Cutoff is fixed club-wide at {DROP_CUTOFF_HOURS}h before start (late-drop penalties + guest promotion).</div>
              <label style={lbl}>Round robin</label>
              <div style={{ display: "flex", gap: 14, fontSize: 13, flexWrap: "wrap" }}>
                {[["manual", "Manual (admin creates when ready)"], ["auto", "Auto (create as soon as roster allows)"]].map(([v, l]) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="radio" checked={f.rr === v} onChange={() => setF({ ...f, rr: v })} /> {l}
                  </label>
                ))}
              </div>
              <label style={lbl}>Prefill roster from predefined list (auto-confirmed)</label>
              <select style={input} value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value })}>
                <option value="">— none —</option>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.label} ({(p.members || []).filter((m) => m.active).length} players)</option>)}
              </select>
              <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} />
                Repeat weekly — next game opens the day after this one ends
              </label>
              <div style={{ marginTop: 12 }}>
                <Btn onClick={() => {
                  if (!f.title.trim()) return notify("Give the game a title first.");
                  if (!f.starts) return notify("Set the start time.");
                  if (!f.duration || f.duration <= 0) return notify("Set a duration.");
                  const endsAt = new Date(new Date(f.starts).getTime() + f.duration * 60000);
                  onCreate({
                    p_title: f.title, p_location: f.location, p_map_link: f.map_link,
                    p_starts: new Date(f.starts).toISOString(), p_ends: endsAt.toISOString(),
                    p_courts: f.courts, p_per_court: f.per_court, p_cap: f.cap ? +f.cap : null,
                    p_cutoff: DROP_CUTOFF_HOURS, p_cost: f.cost, p_penalty: f.penalty,
                    p_rr: f.rr, p_recurring: f.recurring, p_preset: f.preset,
                  }).then(() => setShowCreate(false));
                }}>Create & announce</Btn>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/* ---------------- game detail ---------------- */

function GameDetail({ game, matches, penalties, profiles, me, isAdmin, nameOf, onBack, onJoin, onGuest, onDrop, onConfirm, onDecline, onClose, onCancel, onCost, onPenaltyAmt, onResize, onResolvePenalty, onTournament, onWinner }) {
  const [guestName, setGuestName] = useState("");
  const [resize, setResize] = useState({ courts: game.courts, perCourt: game.per_court, cap: game.capacity_override ?? "" });
  const cap = capacityOf(game);
  const byTime = (a, b) => new Date(a.joined_at) - new Date(b.joined_at);
  const playing = game.roster.filter((r) => r.status === "in").sort(byTime);
  const pending = game.roster.filter((r) => r.status === "pending");
  const waits = orderedWaitlist(game.roster);
  const mine = game.roster.find((r) => r.kind === "member" && r.user_id === me.id);
  const label = (r) => (r.kind === "guest" ? `${r.guest_name} (${nameOf(r.user_id)})` : nameOf(r.user_id));
  const isMine = (r) => r.user_id === me.id;
  const pastCutoff = isPastCutoff(game);
  const pastStart = isPastStart(game);
  const rounds = useMemo(() => {
    const map = new Map();
    matches.forEach((m) => { if (!map.has(m.round)) map.set(m.round, []); map.get(m.round).push(m); });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const Row = ({ r, i }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap", rowGap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0, flex: "1 1 220px" }}>
        <span style={{ fontFamily: font.display, fontWeight: 800, fontSize: 12, color: T.sub, width: 18, flexShrink: 0 }}>{i + 1}</span>
        <span style={{ fontSize: 14, fontWeight: isMine(r) && r.kind === "member" ? 700 : 500, overflowWrap: "anywhere", minWidth: 0 }}>
          {label(r)} {isMine(r) && r.kind === "member" ? "(you)" : ""}
        </span>
        {r.kind === "guest" && <Pill tone="ink">Guest</Pill>}
        {r.status === "pending" && <Pill tone="gold">Confirm by {new Date(r.pending_until).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: UAE_TZ })}</Pill>}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {r.status === "pending" && (isMine(r) || isAdmin) && (<Btn small style={{ padding: "6px 9px" }} onClick={() => onConfirm(r)}>Confirm</Btn>)}
        {r.status === "pending" && (isMine(r) || isAdmin) && !pastStart && (<Btn small tone="red" style={{ padding: "6px 9px" }} onClick={() => onDecline(r)}>Decline</Btn>)}
        {(isMine(r) || isAdmin) && r.status !== "pending" && !game.closed && !pastStart && (
          <Btn small tone="red" style={{ padding: "6px 9px" }} onClick={() => {
            if (r.status === "in" && !window.confirm(`Drop out of ${game.title}? If it's within the cutoff window, this may add a late-drop penalty.`)) return;
            onDrop(r);
          }}>{r.status === "in" ? "Drop out" : "Remove"}</Btn>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button onClick={onBack} style={{ background: "none", border: "none", color: T.court, fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 10 }}>← All games</button>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 20 }}>{game.title}</div>
          {game.closed && <Pill tone="red">Closed & billed</Pill>}
        </div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 4 }}>
          {fmtDT(game)} · {game.location}
          {game.map_link && <> · <a href={game.map_link} target="_blank" rel="noreferrer" style={{ color: T.court, fontWeight: 600 }}>📍 Map</a></>}
        </div>
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 2 }}>
          {isAdmin && !game.closed ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input type="number" min={1} value={resize.courts} onChange={(e) => setResize({ ...resize, courts: +e.target.value })} style={{ ...inputStyle, width: 44, padding: "3px 6px" }} /> court(s) ×
              <input type="number" min={1} value={resize.perCourt} onChange={(e) => setResize({ ...resize, perCourt: +e.target.value })} style={{ ...inputStyle, width: 44, padding: "3px 6px" }} /> per court · override cap
              <input type="number" min={1} placeholder={String(resize.courts * resize.perCourt)} value={resize.cap} onChange={(e) => setResize({ ...resize, cap: e.target.value })} style={{ ...inputStyle, width: 54, padding: "3px 6px" }} />
              <Btn small tone="ghost" onClick={() => onResize(resize.courts, resize.perCourt, resize.cap === "" ? null : +resize.cap)}>Save size</Btn>
            </span>
          ) : (
            <>{game.courts} court{game.courts > 1 ? "s" : ""} · capacity {cap}</>
          )}
          {" "}· cutoff {DROP_CUTOFF_HOURS}h before start
          {pastCutoff && !game.closed && <> · <b style={{ color: T.red }}>past cutoff — penalties apply</b></>}
          {" "}· round robin: {game.rr_mode === "auto" ? "auto" : "manual"}
        </div>
        {isAdmin && !game.closed && <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2 }}>Shrinking waitlists the most recent joiners; growing auto-offers spots from the waitlist.</div>}

        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          Cost/player: AED{" "}
          {isAdmin && !game.closed ? (
            <input type="number" defaultValue={game.cost_per_player} onBlur={(e) => +e.target.value !== game.cost_per_player && onCost(+e.target.value)} style={{ ...inputStyle, width: 60, padding: "3px 6px", fontWeight: 700 }} />
          ) : <b style={{ color: T.ink }}>{game.cost_per_player}</b>}
          · Late-drop penalty: AED{" "}
          {isAdmin && !game.closed ? (
            <input type="number" defaultValue={game.penalty} onBlur={(e) => +e.target.value !== game.penalty && onPenaltyAmt(+e.target.value)} style={{ ...inputStyle, width: 60, padding: "3px 6px", fontWeight: 700 }} />
          ) : <b style={{ color: T.ink }}>{game.penalty}</b>}
        </div>
        {isAdmin && !game.closed && <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2 }}>Both editable until the game is closed.</div>}
        <CourtRule />

        {!mine && !game.closed && me.status !== "explayer" && (
          <div style={{ marginBottom: 6 }}>
            <Btn onClick={onJoin}>{playing.length + pending.length < cap ? "I'm in" : "Join waitlist"}</Btn>
          </div>
        )}

        <SectionHead>PLAYING ({playing.length}/{cap})</SectionHead>
        {playing.map((r, i) => <Row key={r.id} r={r} i={i} />)}
        {pending.map((r, i) => <Row key={r.id} r={r} i={playing.length + i} />)}
        {!playing.length && !pending.length && <div style={{ fontSize: 13, color: T.sub, padding: "8px 0" }}>No one yet — be the first in.</div>}

        {!game.closed && (
          <>
            <SectionHead color={T.amber}>WAITLIST ({waits.length})</SectionHead>
            <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 4 }}>Members are auto-promoted the moment a spot opens — no confirmation needed. Guests are only promoted after the cutoff passes, then have 12h to confirm.</div>
            {waits.map((r, i) => <Row key={r.id} r={r} i={i} />)}
            {!waits.length && <div style={{ fontSize: 13, color: T.sub, padding: "8px 0" }}>Waitlist is empty.</div>}

            <div style={{ marginTop: 18, background: "#EEF3FA", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add a guest (max 2 per member)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest name" style={{ ...inputStyle, flex: 1 }} />
                <Btn small tone="ghost" onClick={() => { if (guestName.trim()) { onGuest(guestName.trim()); setGuestName(""); } }}>Add to waitlist</Btn>
              </div>
            </div>
          </>
        )}

        {rounds.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <SectionHead>DOUBLES ROUND ROBIN — {rounds.length} ROUNDS</SectionHead>
            <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 4 }}>Any player in a match can record the result. 1 point per player per win.</div>
            {rounds.map(([rn, ms]) => (
              <div key={rn} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.sub }}>Round {rn}</div>
                {ms.map((m) => {
                  const canScore = !game.closed && (isAdmin || [...m.t1, ...m.t2].some((n) => n === me.name || n.startsWith(me.name + " (")));
                  return (
                    <div key={m.id} style={{ padding: "6px 0", borderBottom: `1px dashed ${T.line}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>
                          <b style={{ color: m.winner === 1 ? T.green : T.ink }}>{m.t1.join(" & ")}</b>
                          <span style={{ color: T.sub }}> vs </span>
                          <b style={{ color: m.winner === 2 ? T.green : T.ink }}>{m.t2.join(" & ")}</b>
                          {m.winner && <span style={{ marginLeft: 6 }}><Pill tone="green">Team {m.winner} won</Pill></span>}
                        </span>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ color: T.sub, fontSize: 12 }}>Court {m.court}</span>
                          {!m.winner && canScore && (<>
                            <Btn small tone="ghost" onClick={() => onWinner(m.id, 1)}>T1 won</Btn>
                            <Btn small tone="ghost" onClick={() => onWinner(m.id, 2)}>T2 won</Btn>
                          </>)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <SectionHead color={T.amber}>POINTS TABLE</SectionHead>
            <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 4 }}>Shared with all members who attended.</div>
            {pointsTable(matches).map(([p, pts], i) => (
              <div key={p} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", borderBottom: `1px solid ${T.line}`, fontWeight: i === 0 && pts > 0 ? 700 : 500 }}>
                <span>{i === 0 && pts > 0 ? "🥇 " : ""}{p}{p === me.name ? " (you)" : ""}</span>
                <span>{pts} pt{pts !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        )}

        {penalties.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <SectionHead color={T.red}>LATE-DROP PENALTIES</SectionHead>
            {penalties.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
                <span style={{ fontSize: 13.5 }}>
                  {nameOf(p.user_id)} — AED {p.amount}{" "}
                  {p.status !== "pending" && <Pill tone={p.status === "waived" ? "court" : "red"}>{p.status}</Pill>}
                </span>
                {isAdmin && p.status === "pending" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small tone="red" onClick={() => onResolvePenalty(p.id, "applied")}>Charge</Btn>
                    <Btn small tone="ghost" onClick={() => onResolvePenalty(p.id, "waived")}>Waive</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {game.roster.filter((r) => r.status === "dropped").length > 0 && (
          <div style={{ marginTop: 18 }}>
            <SectionHead color={T.sub}>DROPPED OUT</SectionHead>
            {game.roster.filter((r) => r.status === "dropped")
              .sort((a, b) => new Date(b.dropped_at) - new Date(a.dropped_at))
              .map((r) => {
                const penalized = penalties.some((p) => p.user_id === r.user_id);
                return (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
                    <span style={{ fontSize: 13.5 }}>
                      {r.kind === "guest" ? r.guest_name : nameOf(r.user_id)}
                      {r.dropped_at && <span style={{ color: T.sub }}> — {new Date(r.dropped_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: UAE_TZ })}</span>}
                    </span>
                    {!penalized && <Pill tone="ink">no penalty</Pill>}
                  </div>
                );
              })}
          </div>
        )}

        {isAdmin && !game.closed && (
          <div style={{ marginTop: 18, borderTop: `2px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 8 }}>ADMIN CONTROLS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!rounds.length && <Btn small tone="ghost" onClick={onTournament}>🏆 Create round robin</Btn>}
              <Btn small tone="gold" onClick={onClose}>Close game & bill players</Btn>
              <Btn small tone="red" onClick={onCancel}>Cancel game</Btn>
            </div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>
              Closing bills AED {game.cost_per_player} per confirmed player (guests to their sponsor), updates appearances, and adds this game to the monthly consolidation. The cutoff flips automatically from the game time.
              {" "}<b>Cancel</b> permanently deletes an unbilled game (e.g. rained out) — no charges, no record kept.
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------------- players ---------------- */

function appearancesOf(u, games) {
  return u.initial_games + games.filter((g) => g.closed && g.roster.some((r) => r.kind === "member" && r.user_id === u.id && r.status === "in")).length;
}
function last20Pct(u, games) {
  const closed = games.filter((g) => g.closed).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)).slice(0, 20);
  if (!closed.length) return null;
  const att = closed.filter((g) => g.roster.some((r) => r.kind === "member" && r.user_id === u.id && r.status === "in")).length;
  return Math.round((att / closed.length) * 100);
}

function PlayersView({ profiles, balances, games, onOpen, isAdmin }) {
  const [q, setQ] = useState("");
  const balOf = (id) => balances.find((b) => b.user_id === id)?.balance ?? 0;
  const rows = profiles
    .filter((u) => !u.revoked)
    .filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()))
    .map((u) => ({ ...u, apps: appearancesOf(u, games), bal: balOf(u.id), l20: last20Pct(u, games) }))
    .sort((a, b) => b.apps - a.apps);
  const heat = (b) => (b > 100 ? "#DCF2E4" : b > 0 ? "#EFF9F2" : b === 0 ? "transparent" : b > -100 ? "#FBEAE5" : "#F6CFC4");
  return (
    <Card>
      <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 2 }}>Player appearances</div>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 10 }}>Visible to all members. Tap a player for history{isAdmin ? " and to edit initial data" : ""}.</div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search players…"
        style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 76px 56px 64px", gap: 6, fontSize: 11.5, fontWeight: 700, color: T.sub, padding: "6px 0", borderBottom: `2px solid ${T.line}` }}>
        <span>#</span><span>Player</span><span style={{ textAlign: "right" }}>Balance</span><span style={{ textAlign: "right" }}>Games</span><span style={{ textAlign: "right" }}>Last 20</span>
      </div>
      {rows.map((u, i) => (
        <div key={u.id} onClick={() => onOpen(u.id)}
          style={{ display: "grid", gridTemplateColumns: "24px 1fr 76px 56px 64px", gap: 6, fontSize: 13.5, padding: "9px 0", borderBottom: `1px solid ${T.line}`, alignItems: "start", cursor: "pointer" }}>
          <span style={{ color: T.sub, fontSize: 12, paddingTop: 2 }}>{i + 1}</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{u.name}</span>
            {u.status !== "member" && <StatusPill status={u.status} />}
          </div>
          <span style={{ textAlign: "right", background: heat(u.bal), borderRadius: 6, padding: "2px 6px", fontWeight: 600, color: u.bal < 0 ? T.red : u.bal > 0 ? T.green : T.ink, whiteSpace: "nowrap" }}>
            {u.bal === 0 ? "—" : `AED ${u.bal}`}
          </span>
          <span style={{ textAlign: "right", paddingTop: 2 }}>{u.apps}</span>
          <span style={{ textAlign: "right", color: T.sub, paddingTop: 2 }}>{u.l20 === null ? "—" : u.l20 + "%"}</span>
        </div>
      ))}
      {!rows.length && <div style={{ fontSize: 13, color: T.sub, padding: "12px 0", textAlign: "center" }}>No players match "{q}".</div>}
      <div style={{ fontSize: 11, color: T.sub, marginTop: 8 }}>"Last 20" = share of the club's last 20 games the player attended.</div>
    </Card>
  );
}

function PlayerDetail({ u, bal, games, isAdmin, isSelf, onBack, onSeed, onOpeningBalance, onAwayUntil }) {
  const [seedAmt, setSeedAmt] = useState("");
  const [awayDate, setAwayDate] = useState(u.away_until || "");
  const recent = games.filter((g) => g.closed && g.roster.some((r) => r.kind === "member" && r.user_id === u.id && r.status === "in"))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)).slice(0, 12);
  const apps = appearancesOf(u, games);
  const l20 = last20Pct(u, games);
  const prepayShort = u.status === "prepay" && bal < 150;
  const isAway = u.away_until && u.away_until >= new Date().toISOString().slice(0, 10);
  return (
    <>
      <button onClick={onBack} style={{ background: "none", border: "none", color: T.court, fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 10 }}>← All players</button>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 20 }}>{u.name}</div>
          <StatusPill status={u.status} />
        </div>
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 2 }}>Joined {fmtDate(u.joined)}{u.phone ? ` · ${u.phone}` : ""}</div>
        {prepayShort && <div style={{ marginTop: 8 }}><Pill tone="red">Below AED 150 — will update to Member at month start</Pill></div>}
        {isAway && <div style={{ marginTop: 8 }}><Pill tone="gold">✈ Away till {fmtDate(u.away_until)}</Pill></div>}
        <CourtRule />
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[["Balance", `AED ${bal}`, bal < 0 ? T.red : T.green], ["Total games", apps, T.ink], ["Last 20 games", l20 === null ? "—" : l20 + "%", T.ink]].map(([l, v, c]) => (
            <div key={l}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.sub, letterSpacing: 0.5 }}>{String(l).toUpperCase()}</div>
              <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 22, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <SectionHead>RECENT GAMES</SectionHead>
        {recent.map((g) => (
          <div key={g.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
            <span>{fmtDT(g).split("·")[0]} · {g.title}</span><span style={{ color: T.red, fontWeight: 600 }}>−AED {g.cost_per_player}</span>
          </div>
        ))}
        {!recent.length && <div style={{ fontSize: 13, color: T.sub, padding: "8px 0" }}>No closed games in the app yet.</div>}

        {(isAdmin || isSelf) && (
          <div style={{ marginTop: 18, borderTop: `2px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 8 }}>{isSelf && !isAdmin ? "TRAVEL" : "AWAY"}</div>
            <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 6 }}>Set a return date to skip {isSelf && !isAdmin ? "yourself" : "this player"} from predefined-list auto-fill until then — {isSelf && !isAdmin ? "you stay" : "they stay"} on the list itself, just not auto-added to games in the meantime.</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={awayDate} onChange={(e) => setAwayDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
              <Btn small onClick={() => awayDate && onAwayUntil(awayDate)}>Set</Btn>
              {u.away_until && <Btn small tone="ghost" onClick={() => { setAwayDate(""); onAwayUntil(null); }}>Clear</Btn>}
            </div>
          </div>
        )}

        {isAdmin && (
          <div style={{ marginTop: 18, borderTop: `2px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 8 }}>ADMIN: INITIAL DATA</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><div style={{ fontSize: 11.5, color: T.sub, marginBottom: 3 }}>Date joined</div>
                <input type="date" defaultValue={u.joined} onBlur={(e) => e.target.value && e.target.value !== u.joined && onSeed("joined", e.target.value)} style={{ ...inputStyle, width: 150 }} /></div>
              <div><div style={{ fontSize: 11.5, color: T.sub, marginBottom: 3 }}>Games before app</div>
                <input type="number" defaultValue={u.initial_games} onBlur={(e) => +e.target.value !== u.initial_games && onSeed("initial_games", +e.target.value)} style={{ ...inputStyle, width: 100 }} /></div>
              <div><div style={{ fontSize: 11.5, color: T.sub, marginBottom: 3 }}>Opening balance (one-off)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input type="number" placeholder="±AED" value={seedAmt} onChange={(e) => setSeedAmt(e.target.value)} style={{ ...inputStyle, width: 90 }} />
                  <Btn small tone="ghost" onClick={() => { if (seedAmt) { onOpeningBalance(+seedAmt); setSeedAmt(""); } }}>Record</Btn>
                </div></div>
            </div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>Pre-pay is checked at the start of each month: balance under AED 150 auto-updates status to Member.</div>
          </div>
        )}

        {!isAdmin && isSelf && (
          <div style={{ marginTop: 18, borderTop: `2px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 8 }}>YOUR PROFILE</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div><div style={{ fontSize: 11.5, color: T.sub, marginBottom: 3 }}>Date joined</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtDate(u.joined)}</div></div>
              <div><div style={{ fontSize: 11.5, color: T.sub, marginBottom: 3 }}>Games played</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{apps}</div></div>
            </div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>Includes games recorded before the app, plus every game you've played since. See something wrong? Ask an admin to correct it.</div>
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------------- ledger ---------------- */

function LedgerView({ me, isAdmin, profiles, balances, txns, clubBalance, nameOf, onPay, onTransfer }) {
  const [amounts, setAmounts] = useState({});
  const [ledgerQ, setLedgerQ] = useState("");
  const [detailFor, setDetailFor] = useState(null);
  const [detail, setDetail] = useState({ mode: "Cash", date: new Date().toISOString().slice(0, 10), remark: "" });
  const active = profiles.filter((u) => !u.revoked && u.status !== "explayer");
  const ledgerRows = active.filter((u) => u.name.toLowerCase().includes(ledgerQ.trim().toLowerCase()));
  const [tf, setTf] = useState({ from: "", to: "", amt: "" });
  const myBal = balances.find((b) => b.user_id === me.id)?.balance ?? 0;
  const receivable = balances.reduce((s, b) => s + (b.balance < 0 ? -b.balance : 0), 0);
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const myTxns = txns.filter((t) => t.user_id === me.id && new Date(t.created_at) >= sixMonthsAgo);

  return (
    <>
      <Card style={{ marginBottom: 14, background: T.courtDark, border: "none", color: "#fff" }}>
        <div style={{ fontSize: 12, opacity: 0.75, letterSpacing: 1 }}>YOUR BALANCE</div>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 34, marginTop: 4, color: myBal < 0 ? "#FFB4A0" : T.shuttle }}>AED {myBal}</div>
        <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 4 }}>
          {myBal < 0 ? "Pay cash to any admin — it's recorded to the club account." : "You're all settled. 🏸"}
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15 }}>My transactions — last 6 months</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>Every game fee, penalty, payment and transfer on your account.</div>
        {myTxns.map((t) => (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
            <span><span style={{ color: T.sub, fontSize: 12 }}>{fmtDate(t.created_at)}</span> · {t.description}</span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: t.amount < 0 ? T.red : T.green }}>
              {t.amount < 0 ? "−" : "+"}AED {Math.abs(t.amount)}
            </span>
          </div>
        ))}
        {!myTxns.length && <div style={{ fontSize: 13, color: T.sub, padding: "8px 0" }}>No transactions yet.</div>}
      </Card>

      {isAdmin && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, letterSpacing: 1 }}>CLUB ACCOUNT</div>
                <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 26, color: T.court }}>AED {clubBalance}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, letterSpacing: 1 }}>RECEIVABLE</div>
                <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 26, color: T.red }}>AED {receivable}</div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>Cash receipts credit, expenses debit this account. Admins are billed for their own games like any member.</div>
          </Card>

          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Member ledger (admin)</div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Enter any amount received — partial or overpayment (credit).</div>
            <input
              value={ledgerQ}
              onChange={(e) => setLedgerQ(e.target.value)}
              placeholder="Search members…"
              style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
            />
            {ledgerRows.map((u) => {
              const b = balances.find((x) => x.user_id === u.id)?.balance ?? 0;
              const expanded = detailFor === u.id;
              return (
                <div key={u.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{u.name}{u.is_admin ? " ⭐" : ""}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, color: b < 0 ? T.red : b > 0 ? T.green : T.ink, fontSize: 14, minWidth: 70 }}>AED {b}</span>
                    <input type="number" placeholder="AED" value={amounts[u.id] || ""} onChange={(ev) => setAmounts({ ...amounts, [u.id]: ev.target.value })} style={{ ...inputStyle, width: 70, padding: "6px 8px" }} />
                    <Btn small tone="ghost" onClick={() => {
                      if (expanded) { setDetailFor(null); return; }
                      if (!amounts[u.id]) return;
                      setDetail({ mode: "Cash", date: new Date().toISOString().slice(0, 10), remark: "" });
                      setDetailFor(u.id);
                    }}>{expanded ? "Close" : "Record"}</Btn>
                  </div>
                  {expanded && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: "#F8FAFD", padding: 8, borderRadius: 8 }}>
                      <select value={detail.mode} onChange={(e) => setDetail({ ...detail, mode: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>
                        <option>Cash</option><option>Bank transfer</option><option>Careem Pay</option>
                      </select>
                      <input type="date" value={detail.date} onChange={(e) => setDetail({ ...detail, date: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, width: 132 }} />
                      <input placeholder="Remark (optional)" value={detail.remark} onChange={(e) => setDetail({ ...detail, remark: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, flex: 1, minWidth: 110 }} />
                      <Btn small onClick={() => {
                        onPay(u.id, +amounts[u.id], detail.mode, detail.date, detail.remark);
                        setAmounts({ ...amounts, [u.id]: "" });
                        setDetailFor(null);
                      }}>Confirm AED {amounts[u.id]}</Btn>
                    </div>
                  )}
                </div>
              );
            })}
            {!ledgerRows.length && <div style={{ fontSize: 13, color: T.sub, padding: "12px 0", textAlign: "center" }}>No members match "{ledgerQ}".</div>}
          </Card>

          <Card>
            <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Transfer balance</div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Move credit between players. No effect on the club account.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={tf.from} onChange={(e) => setTf({ ...tf, from: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 110 }}>
                <option value="">From…</option>
                {active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <select value={tf.to} onChange={(e) => setTf({ ...tf, to: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 110 }}>
                <option value="">To…</option>
                {active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <input type="number" placeholder="AED" value={tf.amt} onChange={(e) => setTf({ ...tf, amt: e.target.value })} style={{ ...inputStyle, width: 80 }} />
              <Btn small onClick={() => { onTransfer(tf.from, tf.to, +tf.amt); setTf({ from: "", to: "", amt: "" }); }}>Transfer</Btn>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------- reports ---------------- */

function ReportsView({ games, expenses, recon, clubBalance, txns, onRecon, onExpense }) {
  const [ex, setEx] = useState({ spent_on: "", category: "Court hire", description: "", amount: "" });
  const monthStart = new Date(recon.month);
  const inMonth = (d) => { const x = new Date(d); return x.getFullYear() === monthStart.getFullYear() && x.getMonth() === monthStart.getMonth(); };
  const closed = games.filter((g) => g.closed && inMonth(g.starts_at)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const monthExpenses = expenses.filter((e) => inMonth(e.spent_on));
  // Billed amounts (accrual) -- what members were charged, informational
  // only. Not the same as cash actually received; kept separate from
  // the closing-balance formula below so it can't be double-counted or
  // mistaken for real cash, matching the same cash-basis model used by
  // club_balance (Ledger tab): a payment only counts once it's actually
  // recorded as received, not the moment a game bills someone.
  const collections = closed.reduce((s, g) => s + (+g.collected || 0), 0);
  const pens = closed.reduce((s, g) => s + (+g.penalty_collected || 0), 0);
  const spent = monthExpenses.reduce((s, e) => s + +e.amount, 0);
  const paymentsReceived = (txns || []).filter((t) => t.kind === "payment" && inMonth(t.created_at)).reduce((s, t) => s + +t.amount, 0);
  const calcClose = +recon.opening + paymentsReceived - spent;
  const variance = recon.actual_closing == null ? null : +recon.actual_closing - calcClose;
  const cell = { padding: "7px 4px", fontSize: 12, borderBottom: `1px solid ${T.line}` };
  const monthLabel = monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: UAE_TZ });

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const summaryRows = closed.map((g) => {
      const d = new Date(g.starts_at);
      return {
        Date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: UAE_TZ }),
        Day: d.toLocaleDateString("en-GB", { weekday: "long", timeZone: UAE_TZ }),
        Courts: g.courts,
        Planned: capacityOf(g),
        Actual: g.actual_players,
        "Per player (AED)": g.cost_per_player,
        "Billed for game (AED)": g.collected,
        "Billed for penalty (AED)": +g.penalty_collected || 0,
        "Total billed (AED)": (+g.collected || 0) + (+g.penalty_collected || 0),
      };
    });
    summaryRows.push({});
    summaryRows.push({ Date: "Opening balance", "Total (AED)": +recon.opening });
    summaryRows.push({ Date: "Total billed to members (accrual, informational)", "Total (AED)": collections + pens });
    summaryRows.push({ Date: "Payments actually received", "Total (AED)": paymentsReceived });
    summaryRows.push({ Date: "Expenses", "Total (AED)": -spent });
    summaryRows.push({ Date: "Calculated closing balance", "Total (AED)": calcClose });
    if (recon.actual_closing != null) {
      summaryRows.push({ Date: "Actual closing (manual)", "Total (AED)": +recon.actual_closing });
      summaryRows.push({ Date: "Variance", "Total (AED)": variance });
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");

    const expenseRows = monthExpenses.map((e) => ({
      Date: fmtDate(e.spent_on), Category: e.category, Description: e.description, "Amount (AED)": -e.amount,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), "Expenses");

    XLSX.writeFile(wb, `Shuttlers-consolidation-${recon.month.slice(0, 7)}.xlsx`);
  };

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15 }}>Monthly consolidation — {monthLabel}</div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 10 }}>All figures from the app; only opening and actual closing are manual reconciliation.</div>
          </div>
          <Btn small tone="ghost" onClick={exportExcel}>⬇ Export to Excel</Btn>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Opening balance (manual):</span>
          <input type="number" defaultValue={recon.opening} onBlur={(e) => +e.target.value !== +recon.opening && onRecon({ opening: +e.target.value })} style={{ ...inputStyle, width: 90, fontWeight: 700 }} />
          <span style={{ fontSize: 12, color: T.sub }}>AED · Club account (live): AED {clubBalance}</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "grid", gridTemplateColumns: "72px 36px 46px 56px 56px 56px 66px 60px 66px", fontWeight: 700, color: "#fff", background: T.courtDark, borderRadius: "8px 8px 0 0", fontSize: 11, padding: "8px 4px" }}>
              <span>Date</span><span>Day</span><span>Courts</span><span>Planned</span><span>Actual</span><span>Per player</span><span>From game</span><span>Penalty</span><span>Total</span>
            </div>
            {closed.map((g) => {
              const d = new Date(g.starts_at);
              return (
                <div key={g.id} style={{ display: "grid", gridTemplateColumns: "72px 36px 46px 56px 56px 56px 66px 60px 66px" }}>
                  <span style={cell}>{d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: UAE_TZ })}</span>
                  <span style={cell}>{d.toLocaleDateString("en-GB", { weekday: "short", timeZone: UAE_TZ })}</span>
                  <span style={cell}>{g.courts}</span>
                  <span style={cell}>{capacityOf(g)}</span>
                  <span style={cell}>{g.actual_players}</span>
                  <span style={cell}>{g.cost_per_player}</span>
                  <span style={cell}>{g.collected}</span>
                  <span style={cell}>{+g.penalty_collected || "—"}</span>
                  <span style={{ ...cell, fontWeight: 700 }}>{(+g.collected || 0) + (+g.penalty_collected || 0)}</span>
                </div>
              );
            })}
            {!closed.length && <div style={{ fontSize: 13, color: T.sub, padding: "10px 4px" }}>No closed games this month yet.</div>}
          </div>
        </div>

        <div style={{ marginTop: 14, background: "#EEF3FA", borderRadius: 10, padding: 12, fontSize: 13 }}>
          {[["Opening balance", +recon.opening], ["+ Payments received", paymentsReceived], ["− Expenses", spent]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>{l}</span><b>AED {v}</b></div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 3px", borderTop: `1px solid ${T.line}`, fontWeight: 700 }}>
            <span>Calculated closing balance</span><span>AED {calcClose}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 11.5, color: T.sub, borderTop: `1px dashed ${T.line}`, marginTop: 6 }}>
            <span>Billed to members this month (accrual — not cash, informational only)</span><span>AED {collections + pens}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0 0", gap: 8 }}>
            <span>Actual closing (manual reconciliation)</span>
            <input type="number" placeholder="AED" defaultValue={recon.actual_closing ?? ""} onBlur={(e) => onRecon({ actual_closing: e.target.value === "" ? null : +e.target.value })} style={{ ...inputStyle, width: 90 }} />
          </div>
          {variance !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontWeight: 700, color: variance === 0 ? T.green : T.red }}>
              <span>Cross-check {variance === 0 ? "✓ matches" : "⚠ variance"}</span><span>AED {variance}</span>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15 }}>Expenses — courts, shuttles & misc</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Paid from the club account; feeds the consolidation above.</div>
        {monthExpenses.map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 13, padding: "8px 0", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap" }}>
            <span style={{ minWidth: 0, overflowWrap: "anywhere", flex: "1 1 220px" }}>{fmtDate(e.spent_on)} · <b>{e.category}</b> — {e.description}</span>
            <span style={{ color: T.red, fontWeight: 700, flexShrink: 0 }}>−AED {e.amount}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0", fontWeight: 700 }}>
          <span>Total this month</span><span style={{ color: T.red }}>−AED {spent}</span>
        </div>
        <div style={{ marginTop: 10, background: "#EEF3FA", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Record an expense</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={ex.spent_on} onChange={(e) => setEx({ ...ex, spent_on: e.target.value })} style={{ ...inputStyle, flex: "1 1 0%", minWidth: 0 }} />
            <select value={ex.category} onChange={(e) => setEx({ ...ex, category: e.target.value })} style={{ ...inputStyle, flex: "1 1 0%", minWidth: 0 }}>
              {["Court hire", "Shuttles", "Equipment", "Other"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <input placeholder="Description" value={ex.description} onChange={(e) => setEx({ ...ex, description: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 8 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input type="number" placeholder="AED" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} style={{ ...inputStyle, flex: "1 1 0%", minWidth: 0 }} />
            <Btn small onClick={() => {
              if (!ex.amount || +ex.amount <= 0) return;
              onExpense({ spent_on: ex.spent_on || new Date().toISOString().slice(0, 10), category: ex.category, description: ex.description, amount: +ex.amount });
              setEx({ spent_on: "", category: "Court hire", description: "", amount: "" });
            }}>Add expense</Btn>
          </div>
        </div>
      </Card>
    </>
  );
}

/* ---------------- admin ---------------- */

function AdminView({ profiles, presets, me, onInvite, onRevoke, onStatus, onRegenerate, onPreset, onAwayUntil, onMonthCheck, notify }) {
  const [inv, setInv] = useState({ name: "", phone: "", admin: false, link: "" });
  const [sub, setSub] = useState("members");
  const memberRowRefs = useRef({});
  const subTabs = [["members", "Members"], ["lists", "Lists"]];

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {subTabs.map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            style={{ background: sub === k ? T.court : "transparent", color: sub === k ? "#fff" : T.court, border: `1.5px solid ${T.court}`, fontWeight: 600, fontSize: 12.5, padding: "6px 14px", borderRadius: 999, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {sub === "members" && (<>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 2 }}>Invite a member</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Generates a one-time link — share it on WhatsApp. They open it once and stay signed in until revoked.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
          <input placeholder="Phone (optional)" value={inv.phone} onChange={(e) => setInv({ ...inv, phone: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 130 }} />
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}>
            <input type="checkbox" checked={inv.admin} onChange={(e) => setInv({ ...inv, admin: e.target.checked })} /> Admin
          </label>
          <Btn small onClick={async () => {
            if (!inv.name.trim()) return notify("Enter the member's name.");
            const link = await onInvite(inv.name.trim(), inv.phone.trim() || null, inv.admin);
            setInv({ name: "", phone: "", admin: false, link: link || "" });
          }}>Generate link</Btn>
        </div>
        {inv.link && <div style={{ fontSize: 12, color: T.sub, marginTop: 8, wordBreak: "break-all" }}>Link (copied): <b>{inv.link}</b></div>}
      </Card>

      <Card style={{ marginBottom: 14, position: "relative" }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 2 }}>Members</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Status: Member · Pre-pay (AED 150+ credit, checked at the start of each month) · Ex-player (kept in history, can't join).</div>
        <div style={{ marginBottom: 8 }}>
          <Btn small tone="ghost" onClick={onMonthCheck}>⏱ Run month-start pre-pay check now</Btn>
          <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4 }}>Runs automatically on the 1st of every month: any pre-pay member under AED 150 auto-updates to Member.</div>
        </div>
        <AlphabetRail profiles={profiles} refs={memberRowRefs} />
        {profiles.map((u) => {
          const isAway = u.away_until && u.away_until >= new Date().toISOString().slice(0, 10);
          return (
          <div key={u.id} ref={(el) => (memberRowRefs.current[u.id] = el)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: `1px solid ${T.line}`, gap: 8, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 500, textDecoration: u.revoked ? "line-through" : "none", opacity: u.revoked ? 0.5 : 1 }}>{u.name}</span>
              {u.is_admin && <span style={{ marginLeft: 8 }}><Pill tone="court">Admin</Pill></span>}
              <span style={{ marginLeft: 8 }}><StatusPill status={u.status} /></span>
              {u.revoked && <span style={{ marginLeft: 8 }}><Pill tone="red">Revoked</Pill></span>}
              {isAway && <span style={{ marginLeft: 8 }}><Pill tone="gold">✈ Till {fmtDate(u.away_until)}</Pill></span>}
              {u.phone && <div style={{ fontSize: 11.5, color: T.sub }}>{u.phone}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={u.status} onChange={(e) => onStatus(u.id, e.target.value)} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>
                <option value="member">Member</option><option value="prepay">Pre-pay</option><option value="explayer">Ex-player</option>
              </select>
              <input type="date" value={u.away_until || ""} onChange={(e) => onAwayUntil(u.id, e.target.value || null)} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, width: 128 }} title="Away until — skips list auto-fill" />
              <Btn small tone="ghost" onClick={() => onRegenerate(u.id, u.name)}>🔄 Regenerate link</Btn>
              {u.id !== me.id && (
                <Btn small tone={u.revoked ? "ghost" : "red"} onClick={() => onRevoke(u.id, !u.revoked)}>{u.revoked ? "Re-approve" : "Revoke"}</Btn>
              )}
            </div>
          </div>
          );
        })}
      </Card>
      </>)}

      {sub === "lists" && (
      <Card>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 15, marginBottom: 2 }}>Predefined player lists</div>
        <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Selecting a list when creating a game auto-confirms these players onto the roster. Tap a day to expand it — each shows only players with at least 1 appearance in that day's last 20 games, pre-pay members ranked first, then by 50% total games + 50% last-20 appearances.</div>
        {sortedPresets(presets).map((p) => (
          <PresetRankedList key={p.key} preset={p} profiles={profiles} onToggle={onPreset} notify={notify} />
        ))}
      </Card>
      )}
    </>
  );
}

/* Fixed display order: Saturday, Tuesday, Thursday first (regardless of
   whatever order Supabase happens to return them in — that order isn't
   guaranteed to stay stable across fetches), any other/future list after,
   alphabetically. */
const LIST_DAY_PRIORITY = { sat: 0, saturday: 0, tue: 1, tuesday: 1, thu: 2, thursday: 2 };
function sortedPresets(presets) {
  return [...presets].sort((a, b) => {
    const pa = LIST_DAY_PRIORITY[a.key.toLowerCase()] ?? 99;
    const pb = LIST_DAY_PRIORITY[b.key.toLowerCase()] ?? 99;
    return pa !== pb ? pa - pb : a.label.localeCompare(b.label);
  });
}

/* Ranked list-builder for one predefined list (e.g. Saturday). Pulls the
   weighted ranking from the list_ranking(p_dow) Postgres function — pre-pay
   members as a block above members, each sorted by 50% total games + 50%
   last-20 appearances on this list's specific day of week. Collapsed by
   default (shows just the day name + how many players are currently
   eligible); expands on tap to the full ranked table, which only ever
   shows players who've attended at least one of the last 20 games on
   that specific day — everyone else (however storied their all-time
   record) drops out of the list until they play that day again.
   Accepts common short keys ("sat", "tue", "thu"...) as well as full
   day names, so a preset doesn't silently stop ranking over naming. */
const DOW_MAP = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function PresetRankedList({ preset, profiles, onToggle, notify }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const dow = DOW_MAP[preset.key.toLowerCase()];

  useEffect(() => {
    let cancelled = false;
    if (dow === undefined) { setRows(null); setLoading(false); return; }
    setLoading(true);
    rpc("list_ranking", { p_dow: dow })
      .then((data) => { if (!cancelled) setRows(data || []); })
      .catch((e) => { if (!cancelled) { notify(e.message); setRows([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [preset.key]);

  const today = new Date().toISOString().slice(0, 10);
  const awayById = new Map((profiles || []).filter((p) => p.away_until && p.away_until >= today).map((p) => [p.id, p.away_until]));
  const dayLabel = dow !== undefined ? Object.keys(DOW_MAP).find((k) => DOW_MAP[k] === dow && k.length > 3) : null;
  const rowsById = new Map((rows || []).map((r) => [r.profile_id, r]));

  const members = preset.members || [];
  const membersSorted = [...members].sort((a, b) => a.order - b.order);
  const memberIds = new Set(members.map((m) => m.id));
  const onListEntries = membersSorted.map((m) => ({ ...m, row: rowsById.get(m.id) })).filter((e) => e.row);
  const onListMissing = membersSorted.length - onListEntries.length;
  const activeCount = membersSorted.filter((m) => m.active).length;

  // "Suggested" is the discovery view — only people not on the list at
  // all, with recent attendance for this day, pre-pay first then score.
  const suggested = (rows || []).filter((r) => r.last20_pct > 0 && !memberIds.has(r.profile_id));

  const saveMembers = (next) => onToggle(preset.key, next);
  const reorder = (newIndex, id) => {
    const current = [...membersSorted];
    const oldIndex = current.findIndex((m) => m.id === id);
    if (oldIndex === -1 || oldIndex === newIndex) return;
    const [item] = current.splice(oldIndex, 1);
    current.splice(Math.max(0, Math.min(newIndex, current.length)), 0, item);
    saveMembers(current.map((m, i) => ({ id: m.id, active: m.active, order: i + 1 })));
  };
  const toggleActive = (id) => saveMembers(membersSorted.map((m) => (m.id === id ? { ...m, active: !m.active } : m)));
  const addMember = (id) => {
    const maxOrder = membersSorted.reduce((mx, m) => Math.max(mx, m.order), 0);
    saveMembers([...membersSorted, { id, active: true, order: maxOrder + 1 }]);
  };

  const cell = { padding: "8px 4px", fontSize: 13, borderBottom: `1px solid ${T.line}`, minWidth: 0, overflowWrap: "anywhere" };
  const head = { padding: "6px 4px", fontSize: 10.5, color: T.sub, textTransform: "uppercase", letterSpacing: 0.2 };
  const iconBtn = (color) => ({
    width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${color}`, background: "transparent",
    color, fontSize: 13, fontWeight: 800, lineHeight: 1, cursor: "pointer", display: "inline-flex",
    alignItems: "center", justifyContent: "center", padding: 0,
  });
  const nameCell = (r, dim) => (
    <span style={{ ...cell, fontWeight: 500, opacity: dim ? 0.55 : 1 }}>
      {r.name} {r.status !== "member" && <StatusPill status={r.status} />}
      {awayById.has(r.profile_id) && <span style={{ marginLeft: 4 }}><Pill tone="gold">✈ till {fmtDate(awayById.get(r.profile_id))}</Pill></span>}
    </span>
  );

  const onListCols = "20px minmax(0,1fr) 76px 30px";
  const suggestedCols = "20px minmax(0,1fr) 46px 46px 40px 32px";

  return (
    <div style={{ marginBottom: 10, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setExpanded((x) => !x)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F8FAFD", border: "none", padding: "10px 12px", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{preset.label}</span>
        <span style={{ fontSize: 12, color: T.sub, display: "flex", alignItems: "center", gap: 6 }}>
          {`${activeCount} on list${membersSorted.length > activeCount ? ` (${membersSorted.length - activeCount} paused)` : ""}`}
          <span style={{ fontSize: 10 }}>{expanded ? "▾" : "▸"}</span>
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "10px 12px" }}>
          {dow === undefined && (
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>This list's key ("{preset.key}") isn't a recognized weekday, so ranking/suggestions are unavailable — but the list below still applies to games normally. Rename the preset key to a day name (e.g. "saturday") to enable ranking.</div>
          )}
          {dow !== undefined && loading && <div style={{ fontSize: 12, color: T.sub }}>Loading…</div>}

          <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 2 }}>On this list</div>
          <div style={{ fontSize: 11, color: T.sub, marginBottom: 6 }}>Pick a number to move someone to that position. ✕ pauses without removing them — they stay right here, ready to re-add with ✓. When a game has fewer spots than active people here, the lowest-priority names waitlist automatically.</div>
          {onListEntries.length ? (
            <div style={{ display: "grid", gridTemplateColumns: onListCols, gap: 4 }}>
              <span style={head}></span><span style={head}>Player</span><span style={{ ...head, textAlign: "right" }}>Order</span><span style={head}></span>
              {onListEntries.map((entry, i) => (
                <React.Fragment key={entry.id}>
                  <span style={{ ...cell, color: T.sub, fontSize: 11 }}>{i + 1}</span>
                  {nameCell(entry.row, !entry.active)}
                  <span style={{ ...cell, textAlign: "right" }}>
                    <select value={i + 1}
                      onChange={(e) => reorder(+e.target.value - 1, entry.id)}
                      style={{ ...inputStyle, padding: "4px 6px", fontSize: 12, width: 52 }}
                      aria-label={`Reorder ${entry.row.name}`}>
                      {onListEntries.map((_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
                    </select>
                  </span>
                  <span style={{ ...cell, textAlign: "right" }}>
                    <button onClick={() => toggleActive(entry.id)} style={iconBtn(entry.active ? T.red : T.green)}
                      aria-label={entry.active ? `Pause ${entry.row.name}` : `Re-add ${entry.row.name}`}>
                      {entry.active ? "✕" : "✓"}
                    </button>
                  </span>
                </React.Fragment>
              ))}
            </div>
          ) : <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>No one added yet.</div>}
          {onListMissing > 0 && (
            <div style={{ fontSize: 11, color: T.sub, marginTop: 4 }}>{onListMissing} member{onListMissing > 1 ? "s" : ""} on this list couldn't be matched to a profile — may need a page refresh.</div>
          )}

          {dow !== undefined && !loading && rows && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginTop: 14, marginBottom: 4 }}>Suggested additions</div>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 8 }}>Players not yet on this list with recent {dayLabel || preset.key} attendance. Pre-pay ranked first, then by 50% total games + 50% last-20 appearances.</div>
              {["prepay", "member"].map((status) => {
                const list = suggested.filter((r) => r.status === status);
                if (!list.length) return null;
                return (
                  <div key={status} style={{ marginBottom: 10, display: "grid", gridTemplateColumns: suggestedCols, gap: 4 }}>
                    <span style={head}></span><span style={head}>Player</span><span style={{ ...head, textAlign: "right" }}>Games</span>
                    <span style={{ ...head, textAlign: "right" }}>L20 {dayLabel ? dayLabel.slice(0, 3) : ""}</span><span style={{ ...head, textAlign: "right" }}>Score</span><span style={head}></span>
                    {list.map((r, i) => (
                      <React.Fragment key={r.profile_id}>
                        <span style={{ ...cell, color: T.sub, fontSize: 11 }}>{i + 1}</span>
                        {nameCell(r, false)}
                        <span style={{ ...cell, textAlign: "right" }}>{r.total_games}</span>
                        <span style={{ ...cell, textAlign: "right" }}>{r.last20_pct}%</span>
                        <span style={{ ...cell, fontWeight: 700, textAlign: "right" }}>{r.score}</span>
                        <span style={{ ...cell, textAlign: "right" }}>
                          <button onClick={() => addMember(r.profile_id)} style={iconBtn(T.green)} aria-label={`Add ${r.name} to list`}>✓</button>
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                );
              })}
              {!suggested.length && <div style={{ fontSize: 12, color: T.sub }}>No recent {dayLabel || preset.key} attendance to suggest from yet.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
