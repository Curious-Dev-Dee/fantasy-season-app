import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";
import { applyRankFlair } from "./animations.js";

/* ─── ELEMENTS ───────────────────────────────────────────────────────────── */
const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary   = document.getElementById("leaderboardSummary");
const podiumContainer      = document.getElementById("podiumContainer");




/* ─── INIT ───────────────────────────────────────────────────────────────── */
// BUG FIX #1: Replaced supabase.auth.getSession() with authReady Promise
async function init() {
    let userId;
    try {
        const user = await authReady;
        userId = user.id;
    } catch (_) {
        // auth-guard.js already redirected to login
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const leagueId  = urlParams.get("league_id");

    // BUG FIX #4: .maybeSingle() instead of .single() — no throw on empty/multiple rows
    const { data: activeTournament } = await supabase
        .from("active_tournament")
        .select("*")
        .maybeSingle();

    if (!activeTournament) {
        if (leaderboardSummary) leaderboardSummary.textContent = "No active tournament.";
        return;
    }

    let query;
if (leagueId) {
    query = supabase
        .from("private_league_leaderboard")
        .select("*")
        .eq("league_id", leagueId);
    const h1 = document.getElementById("lbPageTitle");
    if (h1) h1.textContent = "League Standings";

    } else {
        query = supabase
            .from("leaderboard_view")
            .select("*")
            .eq("tournament_id", activeTournament.id);
    }

    const [leaderboardRes, profilesRes] = await Promise.all([
        query.order("total_points", { ascending: false }),
        supabase.from("user_profiles").select("user_id, team_photo_url"),
    ]);

    const leaderboard = leaderboardRes.data || [];
    const profiles    = profilesRes.data   || [];

    const normalized = leaderboard.map(row => ({
        ...row,
        rank: leagueId ? row.rank_in_league : row.rank,
    }));

    const avatarMap = new Map(profiles.map(p => [p.user_id, p.team_photo_url]));
    renderLeaderboard(normalized, userId, avatarMap);

    setupPopunder();
    document.getElementById("skeletonScreen")?.classList.add("hidden");
}

init();

function buildRankCircle(rank, pct) {
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pct / 100) * circumference;
    const colorClass = pct >= 70 ? "neon" : "red";

    const wrapper = document.createElement("div");
    wrapper.className = "rank-circle";

    wrapper.innerHTML = `
        <svg viewBox="0 0 42 42">
            <circle class="rank-circle-bg"
                cx="21" cy="21" r="${radius}"/>
            <circle class="rank-circle-fill ${colorClass}"
                cx="21" cy="21" r="${radius}"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"/>
        </svg>
        <div class="rank-circle-label">#${rank}</div>`;

    return wrapper;
}

/* ─── LEADERBOARD RENDERER ───────────────────────────────────────────────── */
function renderLeaderboard(leaderboard, userId, avatarMap) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    if (leaderboard.length === 0) {
        podiumContainer.innerHTML  = "";
        leaderboardContainer.innerHTML = "";
        leaderboardSummary.textContent = "Rankings appear after Match 1.";
        return;
    }

    const top3     = leaderboard.slice(0, 3);
    const rest     = leaderboard.slice(3);

    const rank1Points = top3[0]?.total_points || 1;

    const p1 = top3[0] || { team_name: "TBA", total_points: 0, rank: 1, user_id: null };
    const p2 = top3[1] || { team_name: "TBA", total_points: 0, rank: 2, user_id: null };
    const p3 = top3[2] || { team_name: "TBA", total_points: 0, rank: 3, user_id: null };

    podiumContainer.replaceChildren();

    // Visual order: 2nd left, 1st centre, 3rd right
    [{ pos: 2, user: p2 }, { pos: 1, user: p1 }, { pos: 3, user: p3 }].forEach(({ pos, user }) => {
        const card = document.createElement("div");
        card.className = `podium-card rank-${pos}`;
        card.onclick   = () => scoutUser(user.user_id, user.team_name || "Anonymous");

const pct       = pos === 1 ? 100 : Math.round(((user.total_points || 0) / rank1Points) * 100);
const rankBadge = buildRankCircle(user.rank || pos, pct);
rankBadge.classList.add("podium-rank-circle");

        const avatar = document.createElement("div");
        avatar.className = "podium-avatar";
        avatar.style.backgroundImage = "url('images/default-avatar.png')";

        if (user.user_id) {
            const photoPath = avatarMap.get(user.user_id);
            if (photoPath) {
                const { data } = supabase.storage.from("team-avatars").getPublicUrl(photoPath);
                avatar.style.backgroundImage = `url('${data.publicUrl}')`;
            }
        }

        const name = document.createElement("div");
        name.className   = "podium-name";
        name.textContent = user.team_name || "Anonymous";

const points = document.createElement("div");
points.className   = `podium-pts${user.total_points > 0 ? " has-pts" : ""}`;
points.textContent = `${user.total_points} pts`;

        applyRankFlair(avatar, name, pos);

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

const me = leaderboard.find(row => row.user_id === userId);
if (me) {
    leaderboardSummary.textContent = `Your Rank: #${me.rank}  ·  ${me.total_points} pts`;
    leaderboardSummary.classList.remove("unranked");
} else {
    leaderboardSummary.textContent = "You are not ranked yet.";
    leaderboardSummary.classList.add("unranked");
}

    // Ranks 4+ list
    leaderboardContainer.replaceChildren();
    rest.forEach(row => {
        // BUG FIX #12: Consistent token-based colours.
        // Ranks 4–5: warm accent border. Ranks 6–10: muted border. 11+: dimmed, no border.
        let extraClass = "";
        if      (row.rank <= 5)  extraClass = "row-top5";
        else if (row.rank <= 10) extraClass = "row-top10";
        else                     extraClass = "row-rest";

        const rowEl = document.createElement("div");
        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""} ${extraClass}`.trim();
        rowEl.onclick   = () => scoutUser(row.user_id, row.team_name || "Anonymous");

const pct  = Math.round((row.total_points / rank1Points) * 100);
const rank = buildRankCircle(row.rank, pct);

        const team = document.createElement("div");
        team.className   = "l-team";
        team.textContent = row.team_name || "Anonymous";

const pts = document.createElement("div");
pts.className   = `l-pts${row.total_points > 0 ? " has-pts" : ""}`;
pts.textContent = `${row.total_points} pts`;

        const arrow = document.createElement("i");
        arrow.className = "fas fa-chevron-right l-arrow";

        rowEl.append(rank, team, pts, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

/* ─── SCOUT USER ─────────────────────────────────────────────────────────── */
// BUG FIX #5: Dead scout counter removed entirely. No more console.log in prod.
function scoutUser(uid, name) {
    if (!uid || uid === "undefined" || uid === "null") return;
    window.location.href = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
}

window.scoutUser = scoutUser;



/* ─── POPUNDER AD ────────────────────────────────────────────────────────── */
let popunderFired = false;

function setupPopunder() {
    document.addEventListener("click", (e) => {
        // Do not fire if user is clicking something that navigates away
        const isNavigating = e.target.closest(".leader-row, .podium-card");
        if (isNavigating) return;

        // Only fire once per page session — not on every single click
        // Change to false if you want it to fire every non-nav click
        if (popunderFired) return;
        popunderFired = true;

        // Load the popunder script
        const s = document.createElement("script");
        s.dataset.zone = "10788828";
        s.src = "https://al5sm.com/tag.min.js";
        document.body.appendChild(s);
    }, { passive: true });
}

;