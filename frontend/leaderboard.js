import { supabase } from "./supabase.js";

const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary = document.getElementById("leaderboardSummary");
const podiumContainer = document.getElementById("podiumContainer");

init();

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    const userId = session.user.id;

    const urlParams = new URLSearchParams(window.location.search);
    const leagueId = urlParams.get("league_id");

    const { data: activeTournament } = await supabase.from("active_tournament").select("*").single();
    if (!activeTournament) return;

    let query;
    if (leagueId) {
        query = supabase.from("private_league_leaderboard").select("*").eq("league_id", leagueId);
        document.querySelector("h1").textContent = "League Standings";
    } else {
        query = supabase.from("leaderboard_view").select("*").eq("tournament_id", activeTournament.id);
    }

    const [leaderboardRes, profilesRes] = await Promise.all([
        query.order("total_points", { ascending: false }),
        // Because you have max 100 users, this query is perfectly safe and fast!
        supabase.from("user_profiles").select("user_id, team_photo_url")
    ]);

    const leaderboard = leaderboardRes.data || [];
    const profiles = profilesRes.data || [];
    const normalizedData = leaderboard.map((row) => ({
        ...row,
        rank: leagueId ? row.rank_in_league : row.rank
    }));

    const avatarMap = new Map(profiles.map((profile) => [profile.user_id, profile.team_photo_url]));
    renderLeaderboard(normalizedData, userId, avatarMap);
}

function renderLeaderboard(leaderboard, userId, avatarMap) {
    if (!podiumContainer || !leaderboardContainer || !leaderboardSummary) return;

    // THE FIX: Handle Day 1 elegantly
    if (leaderboard.length === 0) {
        podiumContainer.innerHTML = '<p style="color:#94a3b8; margin: auto; padding: 20px;">No rankings available yet.</p>';
        leaderboardContainer.innerHTML = '';
        leaderboardSummary.textContent = "Rankings will appear after Match 1.";
        return;
    }

    const top3 = leaderboard.slice(0, 3);
    // ... [rest of the function continues normally]
    
    const remaining = leaderboard.slice(3);

    const p2 = top3[1] || { team_name: "TBA", total_points: 0, rank: 2, user_id: null };
    const p1 = top3[0] || { team_name: "TBA", total_points: 0, rank: 1, user_id: null };
    const p3 = top3[2] || { team_name: "TBA", total_points: 0, rank: 3, user_id: null };

podiumContainer.replaceChildren();
    
    // THE FIX: explicitly map the visual position (pos) separate from the database rank!
    const podiumPositions = [
        { pos: 2, user: p2 },
        { pos: 1, user: p1 },
        { pos: 3, user: p3 }
    ];

    // Create the Podium
    podiumPositions.forEach(({ pos, user }) => {
        const card = document.createElement("div");
        // Use 'pos' so the CSS layout NEVER breaks, even during a tie!
        card.className = `podium-card rank-${pos}`; 
        card.onclick = () => window.scoutUser(user.user_id, user.team_name || "Anonymous");

        const rankBadge = document.createElement("div");
        rankBadge.className = "rank-badge";
        // Print the actual database rank (or default to pos if TBA)
        rankBadge.textContent = String(user.rank || pos);

        const avatar = document.createElement("div");
        avatar.className = "podium-avatar";
        
        // Add default avatar background just in case
        avatar.style.backgroundImage = `url('https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_dark_72dp.png')`;

        if (user.user_id) {
            const photoPath = avatarMap.get(user.user_id);
            if (photoPath) {
                const { data } = supabase.storage.from("team-avatars").getPublicUrl(photoPath);
                // THE FIX: Removed the Date.now() cache-buster!
                avatar.style.backgroundImage = `url('${data.publicUrl}')`;
            }
        }

        const name = document.createElement("div");
        name.className = "podium-name";
        name.textContent = user.team_name || "Anonymous";

        const points = document.createElement("div");
        points.className = "podium-pts";
        points.textContent = `${user.total_points} pts`;

        card.append(rankBadge, avatar, name, points);
        podiumContainer.appendChild(card);
    });

    // Update Summary
    const currentUserRow = leaderboard.find((row) => row.user_id === userId);
    leaderboardSummary.textContent = currentUserRow
        ? `Your Rank: #${currentUserRow.rank} | Score: ${currentUserRow.total_points}`
        : "You are not ranked yet.";

    // Render Remaining List (Ranks 4 to 100)
    leaderboardContainer.replaceChildren();
    remaining.forEach((row) => {
        const rowEl = document.createElement("div");
        
        // Determine the border color class based on rank
        let borderClass = "";
        if (row.rank >= 4 && row.rank <= 5) borderClass = "border-orange";
        else if (row.rank >= 6 && row.rank <= 10) borderClass = "border-yellow";
        else if (row.rank > 10) borderClass = "border-red";

        rowEl.className = `leader-row ${row.user_id === userId ? "you" : ""} ${borderClass}`.trim();
        rowEl.onclick = () => window.scoutUser(row.user_id, row.team_name || "Anonymous");

        const rank = document.createElement("div");
        rank.className = "l-rank";
        rank.textContent = `#${row.rank}`;

        const team = document.createElement("div");
        team.className = "l-team";
        team.textContent = row.team_name || "Anonymous";

        const points = document.createElement("div");
        points.className = "l-pts";
        points.textContent = `${row.total_points} pts`;

        const arrow = document.createElement("div");
        arrow.className = "l-arrow";
        const icon = document.createElement("i");
        icon.className = "fas fa-chevron-right";
        arrow.appendChild(icon);

        rowEl.append(rank, team, points, arrow);
        leaderboardContainer.appendChild(rowEl);
    });
}

window.scoutUser = (uid, name) => {
    if (!uid || uid === "undefined" || uid === "null") return;
    window.location.href = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
};