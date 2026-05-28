import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

/* ─── ELEMENTS ───────────────────────────────────────────────────────────── */
const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary   = document.getElementById("leaderboardSummary");
const podiumContainer      = document.getElementById("podiumContainer");
const phaseTabsContainer   = document.getElementById("phaseTabsContainer");

let userId = null;
let currentPhaseKey = "overall";
let avatarMap = new Map();
let openPhases = [];

/* ─── INIT ───────────────────────────────────────────────────────────────── */
async function init() {
    try {
        const user = await authReady;
        userId = user.id;
    } catch (_) {
        return; // auth-guard handles redirect
    }

    // 1. Fetch available phases and user avatars globally once
    const [{ data: phases }, { data: profiles }] = await Promise.all([
        supabase.from("ppl_fantasy_days").select("id, phase").order("created_at"),
        supabase.from("user_profiles").select("user_id, team_photo_url")
    ]);

    openPhases = phases || [];
    avatarMap = new Map((profiles || []).map(p => [p.user_id, p.team_photo_url]));

    renderTabs();
    await fetchAndRenderData();

    document.getElementById("skeletonScreen")?.classList.add("hidden");
}

init();

function renderTabs() {
    let html = `<button class="xi-tab active" data-phase="overall">Overall</button>`;
    
    openPhases.forEach(p => {
        const name = p.phase === 'group_a' ? 'Group A' : p.phase === 'group_b' ? 'Group B' : 'Knockout';
        html += `<button class="xi-tab" data-phase="${p.id}">${name}</button>`;
    });

    phaseTabsContainer.innerHTML = html;

    // Attach listeners
    phaseTabsContainer.querySelectorAll(".xi-tab").forEach(tab => {
        tab.addEventListener("click", async (e) => {
            phaseTabsContainer.querySelectorAll(".xi-tab").forEach(t => t.classList.remove("active"));
            e.currentTarget.classList.add("active");
            currentPhaseKey = e.currentTarget.dataset.phase;
            
            // Show loading state while switching
            leaderboardSummary.textContent = "Updating...";
            podiumContainer.innerHTML = "";
            leaderboardContainer.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-faint)">Loading standings...</div>`;
            
            await fetchAndRenderData();
        });
    });
}

/* ─── DATA FETCHING & MAPPING ────────────────────────────────────────────── */
async function fetchAndRenderData() {
    let normalized = [];

    if (currentPhaseKey === "overall") {
        // Fetch Overall
        const { data, error } = await supabase
            .from("ppl_overall_leaderboard")
            .select("user_id, team_name, full_name, total_points, overall_rank")
            .order("overall_rank", { ascending: true });

        if (!error && data) {
            normalized = data.map(r => ({
                user_id: r.user_id,
                name: r.team_name || r.full_name || "Manager",
                points: parseFloat(r.total_points || 0),
                rank: r.overall_rank
            }));
        }
    } else {
        // Fetch Phase Specific
        const { data, error } = await supabase
            .from("ppl_fantasy_scores")
            .select("user_id, phase_points, rank_for_phase, ppl_user_teams!inner(user_name)")
            .eq("phase_id", currentPhaseKey)
            .order("rank_for_phase", { ascending: true });

        if (!error && data) {
            normalized = data.map(r => ({
                user_id: r.user_id,
                name: r.ppl_user_teams?.user_name || "Manager",
                points: parseFloat(r.phase_points || 0),
                rank: r.rank_for_phase
            }));
        }
    }

    renderLeaderboard(normalized);
}

/* ─── RENDERER ───────────────────────────────────────────────────────────── */
function renderLeaderboard(leaderboard) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    if (leaderboard.length === 0) {
        podiumContainer.innerHTML  = "";
        leaderboardContainer.innerHTML = "";
        leaderboardSummary.textContent = "Rankings appear after matches complete.";
        leaderboardSummary.classList.add("unranked");
        return;
    }

    const top3 = leaderboard.slice(0, 3);
    const rest = leaderboard.slice(3);

    const p1 = top3[0] || { name: "TBA", points: 0, rank: 1, user_id: null };
    const p2 = top3[1] || { name: "TBA", points: 0, rank: 2, user_id: null };
    const p3 = top3[2] || { name: "TBA", points: 0, rank: 3, user_id: null };

    podiumContainer.replaceChildren();

    // Visual order: 2nd left, 1st centre, 3rd right
    [{ pos: 2, user: p2 }, { pos: 1, user: p1 }, { pos: 3, user: p3 }].forEach(({ pos, user }) => {
        const card = document.createElement("div");
        card.className = `podium-card rank-${pos}`;
        card.onclick   = () => scoutUser(user.user_id, user.name);

        const rankBadge = document.createElement("div");
        rankBadge.className = "rank-badge";
        rankBadge.textContent = `#${user.rank || pos}`;

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
        name.textContent = user.name;

        const points = document.createElement("div");
        points.className   = `podium-pts${user.points > 0 ? " has-pts" : ""}`;
        points.textContent = `${user.points} pts`;

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

    const me = leaderboard.find(row => row.user_id === userId);
    if (me) {
        leaderboardSummary.textContent = `Your Rank: #${me.rank}  ·  ${me.points} pts`;
        leaderboardSummary.classList.remove("unranked");
    } else {
        leaderboardSummary.textContent = "You are not ranked yet.";
        leaderboardSummary.classList.add("unranked");
    }

    // Ranks 4+ list
    leaderboardContainer.replaceChildren();
    rest.forEach(row => {
        const rowEl = document.createElement("div");
        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""}`;
        rowEl.onclick   = () => scoutUser(row.user_id, row.name);

        const rank = document.createElement("div");
        rank.className = "l-rank";
        rank.textContent = `#${row.rank}`;

        const team = document.createElement("div");
        team.className   = "l-team";
        team.textContent = row.name;

        const pts = document.createElement("div");
        pts.className   = `l-pts${row.points > 0 ? " has-pts" : ""}`;
        pts.textContent = `${row.points} pts`;

        const arrow = document.createElement("i");
        arrow.className = "fas fa-chevron-right l-arrow";

        rowEl.append(rank, team, pts, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

function scoutUser(uid, name) {
    if (!uid || uid === "undefined" || uid === "null") return;
    window.location.href = `ppl-team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
}

window.scoutUser = scoutUser;