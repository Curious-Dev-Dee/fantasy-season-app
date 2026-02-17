import { supabase } from "./supabase.js";

const leaderboardContainer = document.getElementById("leaderboardContainer");
const leaderboardSummary = document.getElementById("leaderboardSummary");
const podiumContainer = document.getElementById("podiumContainer");

init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }
  const userId = session.user.id;

  const { data: activeTournament } = await supabase.from("active_tournament").select("*").single();
  if (!activeTournament) return;

  // 1. Fetch Leaderboard & User Profiles in parallel for speed
  const [leaderboardRes, profilesRes] = await Promise.all([
    supabase
      .from("leaderboard_view")
      .select("*")
      .eq("tournament_id", activeTournament.id)
      .order("rank", { ascending: true }),
    supabase
      .from("user_profiles")
      .select("user_id, team_photo_url")
  ]);

  const leaderboard = leaderboardRes.data;
  const profiles = profilesRes.data || [];

  if (!leaderboard || leaderboard.length === 0) {
    leaderboardSummary.textContent = "Rankings will appear after the first match.";
    return;
  }

  // 2. Create a map for quick photo URL lookups
  const avatarMap = new Map(profiles.map(p => [p.user_id, p.team_photo_url]));

  renderLeaderboard(leaderboard, userId, avatarMap);
}

function renderLeaderboard(leaderboard, userId, avatarMap) {
  // 1. Split Data
  const top3 = leaderboard.slice(0, 3);
  const remaining = leaderboard.slice(3);

  // 2. Render Podium [2nd, 1st, 3rd layout]
  const p2 = top3[1] || { team_name: 'TBA', total_points: 0, rank: 2, user_id: null };
  const p1 = top3[0] || { team_name: 'TBA', total_points: 0, rank: 1, user_id: null };
  const p3 = top3[2] || { team_name: 'TBA', total_points: 0, rank: 3, user_id: null };

  podiumContainer.innerHTML = [p2, p1, p3].map(user => {
    // Generate Avatar URL
    let avatarStyle = '';
    const photoPath = avatarMap.get(user.user_id);
    if (photoPath) {
      const { data } = supabase.storage.from('team-avatars').getPublicUrl(photoPath);
      // Add timestamp to bypass browser caching
      const avatarUrl = `${data.publicUrl}?t=${new Date().getTime()}`;
      avatarStyle = `style="background-image: url('${avatarUrl}');"`;
    }

    return `
    <div class="podium-card ${user.rank === 1 ? 'first' : ''}" 
         onclick="scoutUser('${user.user_id}', '${user.team_name}')">
        <div class="rank-badge">${user.rank}</div>
        <div class="podium-avatar" id="avatar-${user.rank}" ${avatarStyle}></div>
        <div class="podium-name">${user.team_name || 'Anonymous'}</div>
        <div class="podium-pts">${user.total_points} pts</div>
    </div>
  `}).join('');

  // 3. Render User Summary
  const currentUserRow = leaderboard.find(row => row.user_id === userId);
  if (currentUserRow) {
    leaderboardSummary.innerHTML = `
      Your Rank: #${currentUserRow.rank} &nbsp;•&nbsp; Score: ${currentUserRow.total_points}
    `;
  } else {
    leaderboardSummary.innerHTML = `You are not ranked yet.`;
  }

  // 4. Render Remaining List (4th onwards)
  leaderboardContainer.innerHTML = remaining.map(row => `
    <div class="leader-row ${row.user_id === userId ? 'you' : ''}" 
         onclick="scoutUser('${row.user_id}', '${row.team_name}')">
      <div class="l-rank">#${row.rank}</div>
      <div class="l-team">${row.team_name}</div>
      <div class="l-pts">${row.total_points} pts</div>
      <div class="l-arrow"><i class="fas fa-chevron-right"></i></div>
    </div>
  `).join('');
}

// Global function to navigate to team view
window.scoutUser = (uid, name) => {
    if (!uid || uid === 'undefined' || uid === 'null') return;
    // Ensure this filename matches your actual file (view-team.html or team-view.html)
    window.location.href = `team-view.html?uid=${uid}&name=${encodeURIComponent(name)}`;
};