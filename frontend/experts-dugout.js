import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// ─── STATE ────────────────────────────────────────────
let currentUserId      = null;
let activeTournamentId = null;
let currentMode        = "overall";
let currentLeagueId    = null;
let allTeams           = [];          // full leaderboard rows
let selectedUserId     = null;
let rank1UserId        = null;
let rank1TeamName      = null;

// ─── BOOT ─────────────────────────────────────────────
async function boot() {
  try {
    const user = await authReady;
    currentUserId = user.id;
    await init();
  } catch (err) {
    console.warn("Auth failed:", err.message);
    revealApp();
  }
}
boot();

// ─── INIT ─────────────────────────────────────────────
async function init() {
  document.body.classList.add("loading-state");
  try {
    const { data: activeT } = await supabase
      .from("active_tournament")
      .select("*")
      .maybeSingle();

    if (!activeT) { revealApp(); return; }
    activeTournamentId = activeT.id;

    // Check league membership
    const { data: member } = await supabase
      .from("league_members")
      .select("league_id")
      .eq("user_id", currentUserId)
      .maybeSingle();
    currentLeagueId = member?.league_id || null;

    if (!currentLeagueId) {
      const toggleRow = document.querySelector(".ed-toggle-row");
      if (toggleRow) toggleRow.style.display = "none";
      currentMode = "overall";
    } else {
      // Default to league view if user is in a league
      currentMode = "league";
      document.getElementById("toggleOverall")?.classList.remove("active");
      document.getElementById("toggleLeague")?.classList.add("active");
    }

    setupListeners();
    setupInfoPanel();
    await loadTeamList();

    // Auto-select current user if in list
    const sel = document.getElementById("teamSelector");
    if (sel && currentUserId) {
      sel.value = currentUserId;
      if (sel.value === currentUserId) {
        selectedUserId = currentUserId;
        await loadDugout(currentUserId);
      }
    }
  } catch (err) {
    console.error("Init error:", err);
  } finally {
    revealApp();
  }
}

function revealApp() {
  document.body.classList.remove("loading-state");
  document.body.classList.add("loaded");
}

// ─── LISTENERS ────────────────────────────────────────
function setupListeners() {
  document.getElementById("toggleOverall")?.addEventListener("click", async () => {
    if (currentMode === "overall") return;
    currentMode = "overall";
    document.getElementById("toggleOverall").classList.add("active");
    document.getElementById("toggleLeague").classList.remove("active");
    await loadTeamList();
  });

  document.getElementById("toggleLeague")?.addEventListener("click", async () => {
    if (currentMode === "league" || !currentLeagueId) return;
    currentMode = "league";
    document.getElementById("toggleLeague").classList.add("active");
    document.getElementById("toggleOverall").classList.remove("active");
    await loadTeamList();
  });

  document.getElementById("teamSelector")?.addEventListener("change", async e => {
    const uid = e.target.value;
    if (!uid) { showEmptyState(); return; }
    selectedUserId = uid;
    await loadDugout(uid);
  });
}

// ─── TEAM LIST ────────────────────────────────────────
async function loadTeamList() {
  const sel = document.getElementById("teamSelector");
  if (!sel) return;
  sel.innerHTML = '<option value="">Select a team to analyse...</option>';

  try {
    let data = [];
    if (currentMode === "overall") {
      const { data: lb } = await supabase
        .from("leaderboard_view")
        .select("user_id, team_name, total_points, rank")
        .eq("tournament_id", activeTournamentId)
        .order("total_points", { ascending: false });
      data = lb || [];
    } else {
      const { data: lb } = await supabase
        .from("private_league_leaderboard")
        .select("user_id, team_name, total_points, rank_in_league")
        .eq("league_id", currentLeagueId)
        .order("total_points", { ascending: false });
      data = lb || [];
    }

    allTeams = data;
    rank1UserId   = data[0]?.user_id   || null;
    rank1TeamName = data[0]?.team_name || "Rank 1";

    data.forEach(row => {
      const opt = document.createElement("option");
      opt.value = row.user_id;
      const pts = row.total_points > 0 ? ` · ${row.total_points.toLocaleString()} pts` : "";
      opt.textContent = `${row.team_name || "Anonymous"}${pts}`;
      if (row.user_id === currentUserId) opt.textContent = "★ " + opt.textContent + " (You)";
      sel.appendChild(opt);
    });

    if (selectedUserId) {
      sel.value = selectedUserId;
      if (!sel.value) selectedUserId = null;
    }
  } catch (err) {
    console.error("Team list error:", err);
  }
}

// ─── LOAD DUGOUT ──────────────────────────────────────
async function loadDugout(userId) {
  const content = document.getElementById("dugoutContent");
  if (!content) return;

  content.innerHTML = buildSkeletonHTML();

  try {
    // Fetch view + players RPC + match history in parallel
    const [viewRes, playerRes, historyRes] = await Promise.all([
      supabase
        .from("team_lab_view")
        .select("*")
        .eq("user_id", userId)
        .eq("tournament_id", activeTournamentId)
        .maybeSingle(),
      supabase.rpc("get_team_lab_players", {
        p_user_id: userId,
        p_tournament_id: activeTournamentId
      }),
      supabase
        .from("user_match_points")
        .select("match_id, total_points, created_at")
        .eq("user_id", userId)
        .eq("tournament_id", activeTournamentId)
        .order("created_at", { ascending: true })
    ]);

    const d       = viewRes.data;
    const players = playerRes.data;
    const history = historyRes.data || [];

    if (!d || d.matches_played === 0) {
      content.innerHTML = `
        <div class="ed-empty-state">
          <div class="ed-empty-icon"><i class="fas fa-info-circle"></i></div>
          <p class="ed-empty-title">No data yet</p>
          <p class="ed-empty-sub">This team hasn't played any matches yet</p>
        </div>`;
      return;
    }

    // Parse JSON fields that come back as strings from the view
    const safeJSON = (val) => {
      if (!val) return null;
      if (typeof val === "object") return val;
      try { return JSON.parse(val); } catch { return null; }
    };

    d.last_5_scores   = safeJSON(d.last_5_scores);
    d.booster_history = safeJSON(d.booster_history);
    d.rank_journey    = safeJSON(d.rank_journey);

    // Total players in leaderboard for percentile display
    const totalPlayers = allTeams.filter(t => t.total_points > 0).length || 1;
    const teamRow      = allTeams.find(t => t.user_id === userId);

    // Avatar URL
    let avatarUrl = null;
    if (d.team_photo_url) {
      avatarUrl = supabase.storage
        .from("team-avatars")
        .getPublicUrl(d.team_photo_url).data.publicUrl;
    }

    // Build DOM
    content.innerHTML = "";
    content.className = "ed-main";

    content.appendChild(buildHero(d, teamRow, avatarUrl, userId, totalPlayers));
    content.appendChild(buildKeyInsights(d, players, teamRow, totalPlayers));
    content.appendChild(buildStrengthZone(d, players));
    content.appendChild(buildMomentumScore(d));
    content.appendChild(buildFormIndicator(d));
    content.appendChild(buildOverview(d));
    content.appendChild(buildAdSlot());
    content.appendChild(buildScoreTrends(d, history));
    content.appendChild(buildRankJourney(d, totalPlayers));
    content.appendChild(buildBestWorst(d));
    content.appendChild(buildStreaks(d));
    content.appendChild(buildSubsTrends(d));
    content.appendChild(buildCaptainStats(d));
    content.appendChild(buildBoosterROI(d));
    content.appendChild(buildH2H(d, userId));

    if (players) {
      content.appendChild(buildTopScorers(players));
      content.appendChild(buildMostPicked(players));
      content.appendChild(buildByRole(players));
      content.appendChild(buildPlayerCategories(players));
      content.appendChild(buildPlayerUsage(players));
    }

    content.appendChild(buildCompareSection(userId));
    content.appendChild(buildAdSlot());
    content.appendChild(buildShareCard(d, teamRow, totalPlayers));

    // Charts after render
    setTimeout(() => {
      drawBarChart(history, Number(d.avg_score_per_match || 0));
      drawRankChart(d.rank_journey || [], totalPlayers);
    }, 60);

  } catch (err) {
    console.error("Dugout load error:", err);
    content.innerHTML = `
      <div class="ed-empty-state">
        <div class="ed-empty-icon"><i class="fas fa-exclamation-triangle"></i></div>
        <p class="ed-empty-title">Failed to load</p>
        <p class="ed-empty-sub">Check your connection and try again</p>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════
//  SECTION BUILDERS
// ══════════════════════════════════════════════════════

// ─── HERO ─────────────────────────────────────────────
function buildHero(d, teamRow, avatarUrl, userId, totalPlayers) {
  const rank = teamRow ? (teamRow.rank || teamRow.rank_in_league || "--") : (d.user_rank || "--");
  const rankNum = parseInt(rank);

  let pctBadge = "";
  if (!isNaN(rankNum) && totalPlayers > 1) {
    const pct = Math.round(((totalPlayers - rankNum) / (totalPlayers - 1)) * 100);
    pctBadge = `<div class="ed-percentile-badge">Top ${100 - pct}% of ${totalPlayers} managers</div>`;
  }

  // Rank trend from journey
  let trendHtml = "";
  const journey = (d.rank_journey || []).sort((a, b) => a.match_number - b.match_number);
  if (journey.length >= 2) {
    const last = journey[journey.length - 1];
    const prev = journey[journey.length - 2];
    const diff = prev.rank - last.rank;
    if (diff > 0) trendHtml = `<div class="ed-rank-trend up"><i class="fas fa-arrow-up"></i> ${diff} places</div>`;
    else if (diff < 0) trendHtml = `<div class="ed-rank-trend down"><i class="fas fa-arrow-down"></i> ${Math.abs(diff)} places</div>`;
    else trendHtml = `<div class="ed-rank-trend neutral"><i class="fas fa-minus"></i> No change</div>`;
  }

  const wrap = document.createElement("div");
  wrap.className = "ed-team-hero";

  const avatar = document.createElement("div");
  avatar.className = "ed-team-avatar";
  if (avatarUrl) {
    avatar.style.backgroundImage = `url('${avatarUrl}')`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
  } else {
    avatar.textContent = (d.team_name || "?").slice(0, 2).toUpperCase();
  }

  const info = document.createElement("div");
  info.className = "ed-team-info";
  info.innerHTML = `
    <div class="ed-team-name">${d.team_name || "Anonymous"}</div>
    <div class="ed-team-rank">Rank #${rank}</div>
    ${trendHtml}
    ${pctBadge}`;

  const right = document.createElement("div");
  right.innerHTML = `
    <div class="ed-team-pts">${Number(d.total_points || 0).toLocaleString()}</div>
    <div class="ed-team-pts-label">Total pts</div>`;

  wrap.append(avatar, info, right);
  return wrap;
}

// ─── KEY INSIGHTS ─────────────────────────────────────
function buildKeyInsights(d, players, teamRow, totalPlayers) {
  const sec  = createSection("fas fa-lightbulb", "gd", "Key Insights");
  const body = sec.querySelector(".ed-section-body");

  const avg         = Number(d.avg_score_per_match || 0);
  const last3       = Number(d.avg_score_last_3    || 0);
  const capRate     = Number(d.captain_success_rate || 0);
  const consistency = Number(d.consistency_score   || 0);
  const bestStreak  = Number(d.best_streak          || 0);
  const boostersRem = Number(d.boosters_remaining   ?? 7);
  const matchCount  = Number(d.matches_played       || 0);
  const subsRem     = Number(d.subs_remaining       ?? 130);

  const boostHist   = d.booster_history || [];
  const boostersUsed = boostHist.length;
  const boostPtsTotal = boostHist.reduce((s, b) => s + (b.points || 0), 0);
  const boostAvgDelta = boostersUsed > 0 && avg > 0
    ? Math.round(boostPtsTotal / boostersUsed - avg) : null;

  const rank = teamRow ? (teamRow.rank || teamRow.rank_in_league || null) : (d.user_rank || null);
  const pct  = rank && totalPlayers > 1
    ? Math.round(((totalPlayers - rank) / (totalPlayers - 1)) * 100) : null;

  const insights = [];

  if (rank === 1) {
    insights.push({ cls: "positive", emoji: "👑", text: `You are <strong>Rank #1</strong> — the best manager in the tournament right now!` });
  } else if (pct !== null && pct >= 80) {
    insights.push({ cls: "positive", emoji: "🏆", text: `You are in the <strong>Top ${100 - pct}%</strong> of ${totalPlayers} active managers — elite territory.` });
  }

  // Sub budget warning — critical
  if (subsRem <= 0) {
    insights.push({ cls: "danger", emoji: "🚨", text: `<strong>Sub budget exhausted</strong> — ${Math.abs(subsRem)} subs over limit. Your team is frozen from here.` });
  } else if (subsRem < 20 && matchCount < 50) {
    insights.push({ cls: "warning", emoji: "⚠️", text: `Only <strong>${subsRem} subs remaining</strong> with ~${70 - matchCount} league matches left. Use them wisely.` });
  }

  // Booster hoarding
  if (boostersRem >= 4 && matchCount >= 8) {
    insights.push({ cls: "warning", emoji: "⚠️", text: `<strong>${boostersRem} boosters unused</strong> after ${matchCount} matches — you're leaving massive points on the table.` });
  }

  // Form trend
  if (avg > 0 && last3 > 0) {
    const delta = Math.round(last3 - avg);
    if (delta >= 20) {
      insights.push({ cls: "positive", emoji: "📈", text: `On fire — last 3 match avg is <strong>+${delta} pts above</strong> your season average.` });
    } else if (delta <= -20) {
      insights.push({ cls: "warning", emoji: "📉", text: `Form has dipped — last 3 avg is <strong>${Math.abs(delta)} pts below</strong> your season average.` });
    }
  }

  // Captain
  if (capRate >= 70) {
    insights.push({ cls: "positive", emoji: "👑", text: `Elite captaincy — your captain beat the match average in <strong>${capRate}% of matches</strong>.` });
  } else if (capRate > 0 && capRate < 45) {
    insights.push({ cls: "warning", emoji: "⚠️", text: `Captain picks need work — only <strong>${capRate}% success rate</strong>. League avg is ~52%.` });
  }

  // Booster ROI
  if (boostAvgDelta !== null && boostersUsed >= 2) {
    if (boostAvgDelta >= 50) {
      insights.push({ cls: "positive", emoji: "🚀", text: `Excellent booster timing — boosters averaged <strong>+${boostAvgDelta} pts above</strong> your no-booster avg.` });
    } else if (boostAvgDelta < 0) {
      insights.push({ cls: "warning", emoji: "⚠️", text: `Boosters underperforming — averaging <strong>${Math.abs(boostAvgDelta)} pts BELOW</strong> your season avg.` });
    }
  }

  // Streak
  if (bestStreak >= 5) {
    insights.push({ cls: "positive", emoji: "🔥", text: `Your best hot streak was <strong>${bestStreak} matches in a row</strong> at 250+ pts — exceptional consistency.` });
  }

  // Consistency
  if (consistency >= 70) {
    insights.push({ cls: "positive", emoji: "🎯", text: `Rock-solid consistency score of <strong>${consistency}/100</strong> — you show up every single match.` });
  }

  const shown = insights.slice(0, 5);

  if (!shown.length) {
    body.innerHTML = '<div class="ed-no-data">Play more matches to unlock your key insights.</div>';
    return sec;
  }

  body.innerHTML = shown.map(i => `
    <div class="ed-insight-row ${i.cls}">
      <span class="ed-insight-emoji">${i.emoji}</span>
      <span class="ed-insight-text">${i.text}</span>
    </div>`).join("");

  return sec;
}

// ─── STRENGTH ZONE ────────────────────────────────────
function buildStrengthZone(d, players) {
  const sec  = createSection("fas fa-shield-halved", "green", "Strong & Weak Zones");
  const body = sec.querySelector(".ed-section-body");

  const avg         = Number(d.avg_score_per_match || 0);
  const last3       = Number(d.avg_score_last_3    || 0);
  const capRate     = Number(d.captain_success_rate || 0);
  const consistency = Number(d.consistency_score   || 0);
  const bestStreak  = Number(d.best_streak          || 0);
  const worstStreak = Number(d.worst_streak         || 0);
  const worstMatch  = Number(d.worst_match_score    || 0);
  const boostersRem = Number(d.boosters_remaining   ?? 7);
  const matchCount  = Number(d.matches_played       || 0);
  const subsRem     = Number(d.subs_remaining       ?? 130);
  const boostHist   = d.booster_history || [];
  const bestBoostPts = boostHist.length ? Math.max(...boostHist.map(b => b.points || 0)) : 0;

  // Category split from players RPC
  const breakdown   = players?.category_breakdown || [];
  const totalCatPts = breakdown.reduce((a, b) => a + (Number(b.total_points) || 0), 0);
  const indianPct   = totalCatPts > 0
    ? (Number(breakdown.find(c => c.category === "indian")?.total_points || 0) / totalCatPts * 100) : 0;
  const overseasPct = totalCatPts > 0
    ? (Number(breakdown.find(c => c.category === "overseas")?.total_points || 0) / totalCatPts * 100) : 0;

  const strengths = [], weaknesses = [];

  if (capRate >= 68)                        strengths.push({ icon: "👑", title: "Elite Captaincy", desc: `Captain beat avg in ${capRate}% of matches — a huge scoring multiplier.` });
  if (consistency >= 65)                    strengths.push({ icon: "🎯", title: "Rock Solid",       desc: `Consistency ${consistency}/100 — you deliver across all conditions.` });
  if (avg > 0 && last3 > avg)              strengths.push({ icon: "🔥", title: "Red Hot Form",      desc: `Last 3 avg (${last3}) is above season avg (${avg}).` });
  if (bestStreak >= 5)                      strengths.push({ icon: "💥", title: "Explosive Runs",   desc: `${bestStreak} matches in a row above 250 pts.` });
  if (indianPct > 55)                       strengths.push({ icon: "🇮🇳", title: "Strong Core",    desc: `${indianPct.toFixed(0)}% of points from Indian players — solid foundation.` });
  if (worstMatch > 150 && matchCount >= 5)  strengths.push({ icon: "🛡️", title: "High Floor",      desc: `Even your worst match was ${worstMatch} pts — rarely collapse.` });
  if (bestBoostPts > 0 && bestBoostPts > avg * 1.5)
                                            strengths.push({ icon: "🚀", title: "Booster Timing",   desc: `Best booster hit ${bestBoostPts} pts — 50%+ above your avg.` });
  if (subsRem >= 90)                        strengths.push({ icon: "💰", title: "Sub Budget Intact", desc: `${subsRem} subs remaining — plenty of flexibility for the run-in.` });

  if (subsRem <= 0)                         weaknesses.push({ icon: "🚨", title: "Budget Frozen",     desc: `${Math.abs(subsRem)} subs over budget. Team effectively locked.` });
  if (capRate > 0 && capRate < 50)          weaknesses.push({ icon: "👎", title: "Poor Captain Picks", desc: `Only ${capRate}% success rate. League avg is ~52%.` });
  if (consistency > 0 && consistency < 45)  weaknesses.push({ icon: "📉", title: "Very Inconsistent",  desc: `Score variance too high — ${consistency}/100 consistency.` });
  if (avg > 0 && last3 > 0 && last3 < avg * 0.8)
                                            weaknesses.push({ icon: "❄️", title: "Dropping Form",     desc: `Last 3 avg (${last3}) well below season avg (${avg}).` });
  if (worstStreak >= 4)                     weaknesses.push({ icon: "🥶", title: "Cold Streaks",       desc: `${worstStreak} matches in a row at 150 pts or below.` });
  if (boostersRem > 4 && matchCount > 8)   weaknesses.push({ icon: "⚠️", title: "Underusing Boosters", desc: `${boostersRem} boosters left after ${matchCount} matches.` });
  if (overseasPct > 55 && matchCount >= 5) weaknesses.push({ icon: "✈️", title: "Overseas Dependent", desc: `${overseasPct.toFixed(0)}% from overseas — risky if rotation squad.` });

  const topS = strengths.slice(0, 3);
  const topW = weaknesses.slice(0, 3);

  if (!topS.length && !topW.length) {
    body.innerHTML = '<div class="ed-no-data">Not enough data to analyse zones yet.</div>';
    return sec;
  }

  const buildItems = list => list.map(i => `
    <div class="ed-zone-item">
      <span class="ed-zone-icon">${i.icon}</span>
      <div class="ed-zone-info">
        <div class="ed-zone-title">${i.title}</div>
        <div class="ed-zone-desc">${i.desc}</div>
      </div>
    </div>`).join("");

  body.innerHTML =
    (topS.length ? `<div class="ed-zone-block strong"><div class="ed-zone-header"><i class="fas fa-circle-check"></i> Strong Zone</div>${buildItems(topS)}</div>` : "") +
    (topW.length ? `<div class="ed-zone-block weak" style="${topS.length ? "margin-top:10px" : ""}"><div class="ed-zone-header"><i class="fas fa-circle-exclamation"></i> Weak Zone</div>${buildItems(topW)}</div>` : "");

  return sec;
}

// ─── MOMENTUM SCORE ───────────────────────────────────
function buildMomentumScore(d) {
  const sec  = createSection("fas fa-bolt-lightning", "green", "Momentum Score");
  const body = sec.querySelector(".ed-section-body");

  const avg         = Number(d.avg_score_per_match || 0);
  const last3       = Number(d.avg_score_last_3    || 0);
  const last6       = Number(d.avg_score_last_6    || 0);
  const consistency = Number(d.consistency_score   || 0);
  const matchCount  = Number(d.matches_played      || 0);

  if (matchCount < 3 || !avg) {
    body.innerHTML = '<div class="ed-no-data">Play at least 3 matches to unlock Momentum Score.</div>';
    return sec;
  }

  let formScore = 20;
  if (last3 > 0 && last6 > 0) {
    const trendPct = ((last3 - last6) / last6) * 100;
    if      (trendPct >= 20)  formScore = 40;
    else if (trendPct >= 10)  formScore = 35;
    else if (trendPct >= 0)   formScore = 28;
    else if (trendPct >= -10) formScore = 15;
    else                      formScore = 5;
  }

  const consScore = Math.round((consistency / 100) * 30);

  let recentScore = 15;
  if (last3 > 0 && avg > 0) {
    const pct = ((last3 - avg) / avg) * 100;
    if      (pct >= 20)  recentScore = 30;
    else if (pct >= 10)  recentScore = 25;
    else if (pct >= 0)   recentScore = 18;
    else if (pct >= -10) recentScore = 10;
    else                 recentScore = 3;
  }

  const total = Math.min(100, formScore + consScore + recentScore);

  let grade, gradeColor, gradeDesc, gradeEmoji;
  if      (total >= 80) { grade = "A+"; gradeColor = "#9AE000"; gradeDesc = "Unstoppable right now";     gradeEmoji = "🚀"; }
  else if (total >= 65) { grade = "A";  gradeColor = "#9AE000"; gradeDesc = "Strong upward momentum";    gradeEmoji = "📈"; }
  else if (total >= 50) { grade = "B";  gradeColor = "#f59e0b"; gradeDesc = "Steady — holding your own"; gradeEmoji = "➡️"; }
  else if (total >= 35) { grade = "C";  gradeColor = "#fb923c"; gradeDesc = "Losing ground recently";    gradeEmoji = "📉"; }
  else                  { grade = "D";  gradeColor = "#ef4444"; gradeDesc = "Form has dropped sharply";  gradeEmoji = "🥶"; }

  const bar = (label, score, max, explain) => `
    <div class="ed-momentum-bar-row">
      <div class="ed-momentum-bar-label">${label}</div>
      <div class="ed-momentum-bar-track">
        <div class="ed-momentum-bar-fill" style="width:${Math.round((score/max)*100)}%;background:${gradeColor}"></div>
      </div>
      <div class="ed-momentum-bar-val">${score}/${max}</div>
    </div>
    <div class="ed-momentum-bar-explain">${explain}</div>`;

  body.innerHTML = `
    <div class="ed-momentum-wrap">
      <div class="ed-momentum-circle" style="border-color:${gradeColor}">
        <div class="ed-momentum-grade" style="color:${gradeColor}">${grade}</div>
        <div class="ed-momentum-total" style="color:${gradeColor}">${total}/100</div>
      </div>
      <div class="ed-momentum-info">
        <div class="ed-momentum-emoji">${gradeEmoji}</div>
        <div class="ed-momentum-desc" style="color:${gradeColor}">${gradeDesc}</div>
        <div class="ed-momentum-sub">Formula: Form Trend (40) + Consistency (30) + Recent vs Avg (30)</div>
      </div>
    </div>
    <div class="ed-momentum-bars">
      ${bar("Form Trend",   formScore,  40, `Last 3 avg vs last 6 avg — are you trending up or down?`)}
      ${bar("Consistency",  consScore,  30, `Your consistency score ${consistency}/100 → 30pt scale`)}
      ${bar("Recent Form",  recentScore, 30, `Last 3 avg (${last3}) vs season avg (${avg})`)}
    </div>`;

  return sec;
}

// ─── FORM INDICATOR ───────────────────────────────────
function buildFormIndicator(d) {
  const sec  = createSection("fas fa-fire", "rd", "Current Form");
  const body = sec.querySelector(".ed-section-body");

  const scores = d.last_5_scores || [];
  const avg    = Number(d.avg_score_per_match || 0);

  if (!scores.length) {
    body.innerHTML = '<div class="ed-no-data">No matches played yet.</div>';
    return sec;
  }

  const hot  = Math.max(avg * 1.15, 200);
  const good = avg;
  const ok   = avg * 0.75;

  const dots = scores.map(s => {
    let cls = "bad", label = "❌";
    if (s >= hot)       { cls = "hot";  label = "🔥"; }
    else if (s >= good) { cls = "good"; label = "✅"; }
    else if (s >= ok)   { cls = "ok";   label = "🟡"; }

    return `<div class="form-dot-wrap">
      <div class="form-dot-label">${label}</div>
      <div class="form-dot ${cls}"></div>
      <span class="form-dot-score">${s}</span>
    </div>`;
  }).join("");

  const recent    = scores.slice(0, 3);
  const avgRecent = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  const delta     = Math.round(avgRecent - avg);
  const trend     = delta >= 0
    ? `📈 Last 3 avg is <strong>+${delta} pts</strong> above season avg — improving!`
    : `📉 Last 3 avg is <strong>${Math.abs(delta)} pts</strong> below season avg — declining.`;

  body.innerHTML = `
    <div class="ed-form-row">${dots}</div>
    <div class="ed-form-legend">
      <span class="fl-item">🔥 >${Math.round(hot)} pts</span>
      <span class="fl-item">✅ Above avg (${Math.round(avg)})</span>
      <span class="fl-item">🟡 Near avg</span>
      <span class="fl-item">❌ Below avg</span>
    </div>
    <div class="ed-form-trend">${trend} · Newest first</div>`;

  return sec;
}

// ─── SEASON OVERVIEW ──────────────────────────────────
function buildOverview(d) {
  const sec  = createSection("fas fa-chart-bar", "green", "Season Overview");
  const body = sec.querySelector(".ed-section-body");

  const cs = Number(d.consistency_score || 0);
  const cc = !d.consistency_score ? "wh" : cs >= 70 ? "neon" : cs >= 50 ? "gd" : "rd";
  const subsRem = d.subs_remaining;
  const subsDisplay = subsRem === null || subsRem === undefined ? "--"
    : subsRem === 999 ? "∞"
    : subsRem <= 0 ? `<span style="color:var(--red)">${subsRem}</span>`
    : subsRem;

  body.innerHTML = `
    <div class="ed-stat-grid">
      <div class="ed-stat-cell">
        <span class="ed-stat-val wh">${d.matches_played || 0}</span>
        <span class="ed-stat-lbl">Matches Played</span>
      </div>
      <div class="ed-stat-cell">
        <span class="ed-stat-val gd">${d.boosters_remaining ?? 7}</span>
        <span class="ed-stat-lbl">Boosters Left</span>
      </div>
      <div class="ed-stat-cell">
        <span class="ed-stat-val bl">${subsDisplay}</span>
        <span class="ed-stat-lbl">Subs Left</span>
      </div>
    </div>
    <div class="ed-consistency-row">
      <div class="ed-consistency-header">
        <div>
          <div class="ed-consistency-label">Consistency Score</div>
          <div class="ed-consistency-formula">Score variance + captain hit rate</div>
        </div>
        <span class="ed-consistency-val ${cc}">${d.consistency_score != null ? `${cs}/100` : "Not enough data"}</span>
      </div>
      ${d.consistency_score != null ? `
        <div class="ed-consistency-bar">
          <div class="ed-consistency-fill" style="width:${cs}%"></div>
        </div>
        <div class="ed-consistency-grade">
          ${cs >= 70 ? "🎯 Rock solid — you show up every match."
          : cs >= 50 ? "📊 Average — some big score swings."
          : "⚠️ Very inconsistent — scores vary a lot."}
        </div>` : ""}
    </div>`;

  return sec;
}

// ─── SCORE TRENDS ─────────────────────────────────────
function buildScoreTrends(d, history) {
  const sec  = createSection("fas fa-chart-line", "green", "Score Trends");
  const body = sec.querySelector(".ed-section-body");

  const avg = Number(d.avg_score_per_match || 0);
  const tc  = (r) => r && avg ? (Number(r) >= avg ? "neon" : "rd") : "";
  const ta  = (r) => {
    if (!r || !avg) return "";
    const delta = Math.round(Number(r) - avg);
    const sign  = delta >= 0 ? "+" : "";
    return `<span class="${delta >= 0 ? "trend-up" : "trend-down"}">${sign}${delta} vs avg</span>`;
  };

  body.innerHTML = `
    <div class="ed-stat-grid two-col" style="margin-bottom:10px">
      <div class="ed-stat-cell">
        <span class="ed-stat-val">${avg || 0}</span>
        <span class="ed-stat-lbl">Season Avg / Match</span>
      </div>
      <div class="ed-stat-cell">
        <span class="ed-stat-val wh">${Number(d.total_points || 0).toLocaleString()}</span>
        <span class="ed-stat-lbl">Total Points</span>
      </div>
    </div>
    <div class="ed-trend-row">
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 3</span>
        <span class="ed-trend-val ${tc(d.avg_score_last_3)}">${d.avg_score_last_3 ?? "--"}</span>
        <span class="ed-trend-sub">avg pts</span>
        ${ta(d.avg_score_last_3)}
      </div>
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 6</span>
        <span class="ed-trend-val ${tc(d.avg_score_last_6)}">${d.avg_score_last_6 ?? "--"}</span>
        <span class="ed-trend-sub">avg pts</span>
        ${ta(d.avg_score_last_6)}
      </div>
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 10</span>
        <span class="ed-trend-val ${tc(d.avg_score_last_10)}">${d.avg_score_last_10 ?? "--"}</span>
        <span class="ed-trend-sub">avg pts</span>
        ${ta(d.avg_score_last_10)}
      </div>
    </div>
    <div style="margin-top:12px">
      <div class="ed-chart-label">Match-by-match scores · Tap a bar for details</div>
      <div class="ed-chart-wrap" style="position:relative">
        <canvas id="scoreChart"></canvas>
        <div id="scoreTooltip" class="ed-chart-tooltip hidden"></div>
      </div>
    </div>`;

  return sec;
}

// ─── SCORE BAR CHART ──────────────────────────────────
function drawBarChart(history, avg) {
  const canvas = document.getElementById("scoreChart");
  if (!canvas) return;
  if (!history.length) {
    canvas.parentElement.innerHTML = '<div style="text-align:center;color:var(--text-faint);font-size:12px;padding:20px">No match data yet</div>';
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 300;
  const H   = 120;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const data = history.map(h => h.total_points || 0);
  const max  = Math.max(...data, 1);
  const pL = 4, pR = 4, pT = 14, pB = 22;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const bW = Math.max(5, Math.floor(cW / data.length) - 2);
  const gap = Math.max(1, Math.floor((cW - bW * data.length) / Math.max(data.length - 1, 1)));

  ctx.clearRect(0, 0, W, H);

  // Avg line
  if (avg) {
    const ay = pT + cH - Math.round((avg / max) * cH);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(154,224,0,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pL, ay); ctx.lineTo(W - pR, ay); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(154,224,0,0.6)";
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`avg ${avg}`, W - pR - 2, ay - 3);
  }

  canvas._barData = [];

  data.forEach((val, i) => {
    const bH  = Math.max(3, Math.round((val / max) * cH));
    const x   = pL + i * (bW + gap);
    const y   = pT + cH - bH;
    const isHot   = val >= (avg * 1.15 || 200);
    const isAbove = val >= avg;

    ctx.fillStyle = isHot ? "#9AE000" : isAbove ? "rgba(154,224,0,0.55)" : "rgba(154,224,0,0.18)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bW, bH, [3, 3, 0, 0]);
    else ctx.rect(x, y, bW, bH);
    ctx.fill();

    if (data.length <= 30) {
      ctx.fillStyle = "rgba(100,116,139,0.7)";
      ctx.font = "600 6px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`M${i + 1}`, x + bW / 2, H - 4);
    }

    canvas._barData.push({ x, y, w: bW, h: bH, val, match: i + 1 });
  });

  const showTip = (clientX) => {
    const rect  = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const cx    = (clientX - rect.left) * scaleX;
    const tip   = document.getElementById("scoreTooltip");
    if (!tip) return;
    const bar = canvas._barData.find(b => cx >= b.x && cx <= b.x + b.w);
    if (bar) {
      tip.textContent = `Match ${bar.match}: ${bar.val} pts`;
      tip.classList.remove("hidden");
      const tipLeft = Math.min((bar.x / W) * 100, 68);
      tip.style.left = `${tipLeft}%`;
      tip.style.top  = "0px";
    } else {
      tip.classList.add("hidden");
    }
  };

  canvas.addEventListener("click",      e => showTip(e.clientX));
  canvas.addEventListener("touchstart", e => { e.preventDefault(); showTip(e.touches[0].clientX); }, { passive: false });
}

// ─── RANK JOURNEY ─────────────────────────────────────
function buildRankJourney(d, totalPlayers) {
  const sec  = createSection("fas fa-route", "bl", "Rank Journey");
  const body = sec.querySelector(".ed-section-body");

  const journey = (d.rank_journey || []).sort((a, b) => a.match_number - b.match_number);

  if (!journey.length) {
    body.innerHTML = '<div class="ed-no-data">Not enough match data yet.</div>';
    return sec;
  }

  if (journey.length === 1) {
    const pct = totalPlayers > 1 ? Math.round(((totalPlayers - journey[0].rank) / (totalPlayers - 1)) * 100) : null;
    body.innerHTML = `
      <div style="text-align:center;padding:14px 0">
        <div style="font-family:var(--font-display);font-size:28px;font-weight:900;color:var(--accent)">#${journey[0].rank}</div>
        <div style="font-family:var(--font-body);font-size:11px;color:var(--text-faint);margin-top:4px">Rank after M${journey[0].match_number}</div>
        ${pct !== null ? `<div style="font-family:var(--font-display);font-size:12px;color:var(--gold);margin-top:6px">Top ${100 - pct}% of ${totalPlayers} managers</div>` : ""}
      </div>`;
    return sec;
  }

  body.innerHTML = `
    <div class="ed-rank-journey-wrap"><canvas id="rankChart"></canvas></div>
    <div style="font-family:var(--font-body);font-size:10px;color:var(--text-faint);text-align:center;margin-top:6px;font-style:italic">
      Lower = better rank · 🟡 Gold dot = Rank 1 · Showing last 10 matches
    </div>
    <div id="rankTooltip" class="ed-chart-tooltip hidden" style="margin-top:6px;position:relative"></div>`;

  return sec;
}

function drawRankChart(journey, totalPlayers) {
  const canvas = document.getElementById("rankChart");
  if (!canvas || !journey.length) return;

  const sorted = [...journey].sort((a, b) => a.match_number - b.match_number);
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 300;
  const H   = 110;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const ranks = sorted.map(r => r.rank);
  const minR  = Math.min(...ranks);
  const maxR  = Math.max(...ranks, totalPlayers > 0 ? Math.min(totalPlayers, minR + 10) : minR + 5);
  const range = Math.max(maxR - minR, 1);

  const pL = 30, pR = 10, pT = 14, pB = 24;
  const cW = W - pL - pR;
  const cH = H - pT - pB;

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  [minR, Math.round((minR + maxR) / 2), maxR].forEach(r => {
    const y = pT + Math.round(((r - minR) / range) * cH);
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W - pR, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "right";
    ctx.fillText(`#${r}`, pL - 4, y + 3);
  });

  // Top 25% line
  if (totalPlayers > 1) {
    const topQ = Math.ceil(totalPlayers * 0.25);
    const topY = pT + Math.round(((topQ - minR) / range) * cH);
    if (topY > pT && topY < pT + cH) {
      ctx.strokeStyle = "rgba(245,158,11,0.2)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(pL, topY); ctx.lineTo(W - pR, topY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(245,158,11,0.5)"; ctx.font = "600 7px sans-serif"; ctx.textAlign = "left";
      ctx.fillText("Top 25%", pL + 2, topY - 3);
    }
  }

  // Line + fill
  ctx.beginPath();
  sorted.forEach((pt, i) => {
    const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
    const y = pT + Math.round(((pt.rank - minR) / range) * cH);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "rgba(154,224,0,0.7)"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();

  ctx.beginPath();
  sorted.forEach((pt, i) => {
    const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
    const y = pT + Math.round(((pt.rank - minR) / range) * cH);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pL + cW, pT + cH); ctx.lineTo(pL, pT + cH); ctx.closePath();
  const grad = ctx.createLinearGradient(0, pT, 0, pT + cH);
  grad.addColorStop(0, "rgba(154,224,0,0.12)"); grad.addColorStop(1, "rgba(154,224,0,0)");
  ctx.fillStyle = grad; ctx.fill();

  // Dots
  canvas._rankData = [];
  sorted.forEach((pt, i) => {
    const x = pL + (i / Math.max(sorted.length - 1, 1)) * cW;
    const y = pT + Math.round(((pt.rank - minR) / range) * cH);
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = pt.rank === 1 ? "#f59e0b" : "#9AE000"; ctx.fill();
    ctx.fillStyle = pt.rank === 1 ? "#f59e0b" : "rgba(154,224,0,0.9)";
    ctx.font = "700 8px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`#${pt.rank}`, x, y - 9);
    ctx.fillStyle = "rgba(100,116,139,0.7)"; ctx.font = "600 7px sans-serif";
    ctx.fillText(`M${pt.match_number}`, x, H - 5);
    const pctM = totalPlayers > 1 ? Math.round(((totalPlayers - pt.rank) / (totalPlayers - 1)) * 100) : null;
    canvas._rankData.push({ x, y, rank: pt.rank, match: pt.match_number, pct: pctM });
  });

  canvas.addEventListener("click", e => {
    const rect = canvas.getBoundingClientRect();
    const cx   = (e.clientX - rect.left) * (W / rect.width);
    const tip  = document.getElementById("rankTooltip");
    if (!tip) return;
    const closest = canvas._rankData.reduce((best, pt) =>
      Math.abs(pt.x - cx) < Math.abs(best.x - cx) ? pt : best);
    if (closest) {
      const pctStr = closest.pct !== null ? ` · Top ${100 - closest.pct}%` : "";
      tip.textContent = `Match ${closest.match}: Rank #${closest.rank}${pctStr}`;
      tip.classList.remove("hidden");
    }
  });
}

// ─── BEST / WORST ─────────────────────────────────────
function buildBestWorst(d) {
  const sec  = createSection("fas fa-trophy", "gd", "Best & Worst Match");
  const body = sec.querySelector(".ed-section-body");

  const avg = Number(d.avg_score_per_match || 0);
  const bd  = avg > 0 ? Math.round((d.best_match_score  || 0) - avg) : null;
  const wd  = avg > 0 ? Math.round((d.worst_match_score || 0) - avg) : null;

  body.innerHTML = `
    <div class="ed-best-worst">
      <div class="ed-bw-cell best">
        <span class="ed-bw-icon">🏆</span>
        <span class="ed-bw-val">${d.best_match_score || 0}</span>
        <span class="ed-bw-lbl">Best Match</span>
        ${bd !== null ? `<span class="ed-bw-delta positive">+${bd} vs avg</span>` : ""}
      </div>
      <div class="ed-bw-cell worst">
        <span class="ed-bw-icon">📉</span>
        <span class="ed-bw-val">${d.worst_match_score || 0}</span>
        <span class="ed-bw-lbl">Worst Match</span>
        ${wd !== null ? `<span class="ed-bw-delta negative">${wd} vs avg</span>` : ""}
      </div>
    </div>`;

  return sec;
}

// ─── STREAKS ──────────────────────────────────────────
function buildStreaks(d) {
  const sec  = createSection("fas fa-bolt", "gd", "Streaks");
  const body = sec.querySelector(".ed-section-body");

  body.innerHTML = `
    <div class="ed-streak-grid">
      <div class="ed-streak-cell hot">
        <div class="ed-streak-icon">🔥</div>
        <div class="ed-streak-val">${d.best_streak || 0}</div>
        <div class="ed-streak-lbl">Best Streak</div>
        <div class="ed-streak-sub">250+ pts in a row</div>
      </div>
      <div class="ed-streak-cell cold">
        <div class="ed-streak-icon">🥶</div>
        <div class="ed-streak-val">${d.worst_streak || 0}</div>
        <div class="ed-streak-lbl">Worst Streak</div>
        <div class="ed-streak-sub">150 pts or below in a row</div>
      </div>
    </div>`;

  return sec;
}

// ─── SUBS ANALYSIS ────────────────────────────────────
function buildSubsTrends(d) {
  const sec  = createSection("fas fa-exchange-alt", "bl", "Subs Analysis");
  const body = sec.querySelector(".ed-section-body");

  const totalSubs   = Number(d.total_subs_used || 0);
  const matchCount  = Number(d.matches_played  || 0);
  const avgPerMatch = matchCount > 0 ? (totalSubs / matchCount).toFixed(1) : "--";
  const subsRem     = Number(d.subs_remaining ?? 130);
  const idealPace   = 1.86;
  const pace        = parseFloat(avgPerMatch);
  const paceOk      = !isNaN(pace) && pace <= idealPace + 0.3;

  body.innerHTML = `
    <div class="ed-stat-grid two-col" style="margin-bottom:10px">
      <div class="ed-stat-cell">
        <span class="ed-stat-val bl">${avgPerMatch}</span>
        <span class="ed-stat-lbl">Avg Subs / Match</span>
      </div>
      <div class="ed-stat-cell">
        <span class="ed-stat-val wh">${totalSubs}</span>
        <span class="ed-stat-lbl">Total Subs Used</span>
      </div>
    </div>
    <div class="ed-trend-row">
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 3</span>
        <span class="ed-trend-val">${d.avg_subs_last_3 ?? "--"}</span>
        <span class="ed-trend-sub">avg subs</span>
      </div>
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 6</span>
        <span class="ed-trend-val">${d.avg_subs_last_6 ?? "--"}</span>
        <span class="ed-trend-sub">avg subs</span>
      </div>
      <div class="ed-trend-cell">
        <span class="ed-trend-label">Last 10</span>
        <span class="ed-trend-val">${d.avg_subs_last_10 ?? "--"}</span>
        <span class="ed-trend-sub">avg subs</span>
      </div>
    </div>
    <div class="ed-sub-pace-note">
      <strong>Pace check:</strong> Ideal ≤1.86 subs/match over 70 matches (130 total).
      ${subsRem <= 0
        ? `<span style="color:var(--red)">⚠️ You are out of subs — team is frozen.</span>`
        : paceOk
          ? `✅ Your pace looks sustainable with <strong>${subsRem} subs</strong> remaining.`
          : `⚠️ You are burning subs at <strong>${avgPerMatch}/match</strong> — may run short later.`}
    </div>`;

  return sec;
}

// ─── CAPTAIN STATS ────────────────────────────────────
function buildCaptainStats(d) {
  const sec  = createSection("fas fa-crown", "gd", "Captain Performance");
  const body = sec.querySelector(".ed-section-body");

  const rate  = d.captain_success_rate != null ? Number(d.captain_success_rate) : null;
  const color = rate == null ? "#64748b" : rate >= 68 ? "#9AE000" : rate >= 52 ? "#f59e0b" : "#ef4444";
  const label = rate == null ? "Not enough data"
    : rate >= 68 ? "Elite captaincy!"
    : rate >= 52 ? "Above average"
    : "Needs improvement";

  body.innerHTML = `
    <div class="ed-captain-wrap">
      <div class="ed-captain-circle" style="border-color:${color}">
        <span class="ed-captain-pct" style="color:${color}">${rate != null ? rate + "%" : "--"}</span>
        <span class="ed-captain-sub">success</span>
      </div>
      <div class="ed-captain-info">
        <div class="ed-captain-label" style="color:${color}">${label}</div>
        <div class="ed-captain-desc">
          Your captain scored above the match average in ${rate != null ? rate + "%" : "--"} of matches.
          <strong style="color:var(--text-primary)">League avg ~52%.</strong>
          Captain + VC account for ~60–70% of your total score every match.
        </div>
      </div>
    </div>`;

  return sec;
}

// ─── BOOSTER ROI ──────────────────────────────────────
function buildBoosterROI(d) {
  const sec  = createSection("fas fa-rocket", "pu", "Booster ROI");
  const body = sec.querySelector(".ed-section-body");

  const history = d.booster_history || [];
  const boostersRem = Number(d.boosters_remaining ?? 7);

  if (!history.length) {
    body.innerHTML = `
      <div class="ed-no-data">No boosters used yet.</div>
      <div class="ed-booster-bench">
        <strong>${boostersRem} boosters remaining.</strong> Use them strategically — TOTAL_2X averages 1,109 pts, INDIAN_2X 963 pts, CAPTAIN_3X 811 pts across the league.
      </div>`;
    return sec;
  }

  const avg    = Number(d.avg_score_per_match || 0);
  const emojiMap = { TOTAL_2X:"🚀", INDIAN_2X:"🇮🇳", OVERSEAS_2X:"✈️", UNCAPPED_2X:"🧢", CAPTAIN_3X:"👑", MOM_2X:"🏆", FREE_11:"🆓" };
  const nameMap  = { TOTAL_2X:"Total 2X", INDIAN_2X:"Indian 2X", OVERSEAS_2X:"Overseas 2X", UNCAPPED_2X:"Uncapped 2X", CAPTAIN_3X:"Captain 3X", MOM_2X:"MOM 2X", FREE_11:"Free 11" };
  const best = [...history].sort((a, b) => (b.points || 0) - (a.points || 0))[0];

  const totalBoostPts = history.reduce((s, b) => s + (b.points || 0), 0);
  const avgBoostPts   = Math.round(totalBoostPts / history.length);
  const avgDelta      = avg > 0 ? Math.round(avgBoostPts - avg) : null;
  const deltaStr      = avgDelta !== null
    ? (avgDelta >= 0
      ? `<span class="neon-text">+${avgDelta} above your no-booster avg</span>`
      : `<span class="red-text">${avgDelta} below your avg ⚠️</span>`)
    : "";

  const rows = history.map(b => {
    const isBest = b.match_number === best.match_number && b.booster === best.booster;
    const delta  = avg > 0 ? Math.round((b.points || 0) - avg) : null;
    const dHtml  = delta !== null
      ? `<span class="ed-booster-delta ${delta >= 0 ? "pos" : "neg"}">${delta >= 0 ? "+" : ""}${delta}</span>`
      : "";
    return `
      <div class="ed-booster-row${isBest ? " best-booster" : ""}">
        <span class="ed-booster-emoji">${emojiMap[b.booster] || "⚡"}</span>
        <div class="ed-booster-info">
          <span class="ed-booster-name">${nameMap[b.booster] || b.booster}</span>
          <span class="ed-booster-match">Match ${b.match_number}</span>
        </div>
        <div class="ed-booster-right">
          <div class="ed-booster-pts${isBest ? " best" : ""}">${b.points || 0}<span class="ed-booster-ptsl">pts</span></div>
          ${dHtml}
        </div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="ed-booster-summary">
      <div class="ed-booster-sum-stat">
        <span class="ed-stat-val pu">${history.length}</span>
        <span class="ed-stat-lbl">Used</span>
      </div>
      <div class="ed-booster-sum-stat">
        <span class="ed-stat-val wh">${avgBoostPts}</span>
        <span class="ed-stat-lbl">Avg pts</span>
      </div>
      <div class="ed-booster-sum-stat" style="flex:2;text-align:left;padding-left:8px">
        <span class="ed-stat-lbl" style="font-size:10px">vs no-booster avg: ${deltaStr}</span>
      </div>
    </div>
    <div class="ed-booster-best-tag">Best: ${emojiMap[best.booster] || "⚡"} ${nameMap[best.booster] || best.booster} → ${best.points || 0} pts in M${best.match_number}</div>
    <div class="ed-booster-list">${rows}</div>
    ${boostersRem > 0 ? `<div class="ed-booster-bench"><strong>${boostersRem} boosters left</strong> — league benchmarks: TOTAL_2X avg 1,109 pts · INDIAN_2X 963 pts · CAPTAIN_3X 811 pts. Save big boosters for high-scoring fixture clusters.</div>` : ""}`;

  return sec;
}

// ─── H2H ──────────────────────────────────────────────
function buildH2H(d, userId) {
  const sec  = createSection("fas fa-swords", "rd", "Head to Head vs Rank 1");
  const body = sec.querySelector(".ed-section-body");

  if (!rank1UserId || rank1UserId === userId) {
    body.innerHTML = '<div class="ed-no-data">You ARE Rank 1! Nothing to compare.</div>';
    return sec;
  }

  const wins   = Number(d.h2h_wins_vs_rank1 || 0);
  const total  = Number(d.matches_played || 0);
  const losses = Math.max(0, total - wins);
  const pct    = total > 0 ? Math.round((wins / total) * 100) : 0;

  body.innerHTML = `
    <div class="ed-h2h-scope-note">⚠️ Compared against <strong>${rank1TeamName}</strong> — match-by-match score comparison.</div>
    <div class="ed-h2h-row">
      <div class="ed-h2h-side win"><div class="ed-h2h-val">${wins}</div><div class="ed-h2h-lbl">You Won</div></div>
      <div class="ed-h2h-vs">VS<br><span style="font-size:9px;color:var(--text-faint)">${rank1TeamName}</span></div>
      <div class="ed-h2h-side loss"><div class="ed-h2h-val">${losses}</div><div class="ed-h2h-lbl">They Won</div></div>
    </div>
    <div class="ed-h2h-bar"><div class="ed-h2h-fill" style="width:${pct}%"></div></div>
    <div class="ed-h2h-note">You beat Rank 1 in ${pct}% of individual matches</div>`;

  return sec;
}

// ─── PLAYER SECTIONS ──────────────────────────────────
function buildTopScorers(players) {
  const sec  = createSection("fas fa-star", "gd", "Top Point Earners");
  const body = sec.querySelector(".ed-section-body");
  const list = players?.top_scorers || [];
  if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet.</div>'; return sec; }
  body.innerHTML = `<div class="ed-player-list">${list.map((p, i) => playerCardHTML(p, i + 1)).join("")}</div>`;
  return sec;
}

function buildMostPicked(players) {
  const sec  = createSection("fas fa-heart", "pu", "Most Loyal Players");
  const body = sec.querySelector(".ed-section-body");
  const list = players?.most_picked || [];
  if (!list.length) { body.innerHTML = '<div class="ed-no-data">No match data yet.</div>'; return sec; }
  body.innerHTML = `<div class="ed-player-list">${list.map((p, i) => playerCardHTML(p, i + 1)).join("")}</div>`;
  return sec;
}

function buildByRole(players) {
  const sec  = createSection("fas fa-users", "bl", "Top by Role");
  const body = sec.querySelector(".ed-section-body");

  const roles = [
    { key: "top_wk",   label: "🧤 WK"   },
    { key: "top_bat",  label: "🏏 BAT"  },
    { key: "top_ar",   label: "⚡ AR"   },
    { key: "top_bowl", label: "🎳 BOWL" }
  ];

  const tabs    = document.createElement("div"); tabs.className = "ed-role-tabs";
  const listWrap = document.createElement("div"); listWrap.className = "ed-player-list";
  let active = "top_wk";

  const renderRole = key => {
    listWrap.innerHTML = "";
    const list = players?.[key] || [];
    if (!list.length) { listWrap.innerHTML = '<div class="ed-no-data">No data for this role yet.</div>'; return; }
    listWrap.innerHTML = list.map((p, i) => playerCardHTML(p, i + 1)).join("");
  };

  roles.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "ed-role-tab" + (r.key === active ? " active" : "");
    btn.textContent = r.label;
    btn.onclick = () => {
      tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      active = r.key;
      renderRole(r.key);
    };
    tabs.appendChild(btn);
  });

  renderRole(active);
  body.appendChild(tabs);
  body.appendChild(listWrap);
  return sec;
}

function buildPlayerCategories(players) {
  const sec  = createSection("fas fa-flag", "green", "Player Categories");
  const body = sec.querySelector(".ed-section-body");

  const breakdown   = players?.category_breakdown || [];
  const totalPts    = breakdown.reduce((a, b) => a + (Number(b.total_points) || 0), 0);
  const catColors   = { indian: "#9AE000", overseas: "#7cc4ff", uncapped: "#f59e0b" };
  const catLabels   = { indian: "Indian", overseas: "Overseas", uncapped: "Uncapped" };
  const catIcons    = { indian: "🇮🇳", overseas: "✈️", uncapped: "🧢" };

  // Bar
  const barSegs = breakdown.map(c => {
    const pct = totalPts > 0 ? Math.round((Number(c.total_points) / totalPts) * 100) : 0;
    return `<div class="ed-cat-bar-seg" style="width:${pct}%;background:${catColors[c.category] || "#64748b"}"></div>`;
  }).join("");

  // Summary rows
  const summaryRows = breakdown.map(c => {
    const pct   = totalPts > 0 ? Math.round((Number(c.total_points) / totalPts) * 100) : 0;
    const color = catColors[c.category] || "#64748b";
    return `
      <div class="ed-cat-row">
        <div class="ed-cat-row-left">
          <span class="ed-cat-dot" style="background:${color}"></span>
          <span class="ed-cat-name">${catIcons[c.category] || ""} ${catLabels[c.category] || c.category}</span>
        </div>
        <div class="ed-cat-row-right">
          <div class="ed-cat-pill"><span class="ed-cat-pill-val">${c.total_players || c.total_picks || "--"}</span><span class="ed-cat-pill-lbl">players</span></div>
          <div class="ed-cat-pill"><span class="ed-cat-pill-val" style="color:${color}">${Number(c.total_points || 0).toLocaleString()}</span><span class="ed-cat-pill-lbl">pts</span></div>
          <div class="ed-cat-pill"><span class="ed-cat-pill-val" style="color:${color}">${pct}%</span><span class="ed-cat-pill-lbl">share</span></div>
        </div>
      </div>`;
  }).join("");

  const tabs      = document.createElement("div"); tabs.className = "ed-role-tabs";
  const listWrap  = document.createElement("div"); listWrap.className = "ed-player-list";
  const sumWrap   = document.createElement("div"); sumWrap.id = "uncappedSumWrap";

  const tabList = [
    { key: "top_indian",   label: "🇮🇳 Indian"  },
    { key: "top_overseas", label: "✈️ Overseas" },
    { key: "top_uncapped", label: "🧢 Uncapped" }
  ];
  let activeKey = "top_indian";

  const renderCat = key => {
    listWrap.innerHTML = ""; sumWrap.innerHTML = "";
    if (key === "top_uncapped") {
      const us = players?.uncapped_summary;
      if (us) {
        sumWrap.innerHTML = `
          <div class="ed-uncapped-summary">
            <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.total_picks || 0}</span><span class="ed-uncapped-lbl">Total Picks</span></div>
            <div class="ed-uncapped-divider"></div>
            <div class="ed-uncapped-stat"><span class="ed-uncapped-val gold">${Number(us.total_points || 0).toLocaleString()}</span><span class="ed-uncapped-lbl">Total pts</span></div>
            <div class="ed-uncapped-divider"></div>
            <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.avg_points_per_pick || 0}</span><span class="ed-uncapped-lbl">Avg/pick</span></div>
            <div class="ed-uncapped-divider"></div>
            <div class="ed-uncapped-stat"><span class="ed-uncapped-val">${us.matches_with_uncapped || 0}</span><span class="ed-uncapped-lbl">Matches used</span></div>
          </div>`;
      }
    }
    const list = players?.[key] || [];
    if (!list.length) { listWrap.innerHTML = '<div class="ed-no-data">No data for this category yet.</div>'; return; }
    listWrap.innerHTML = list.map((p, i) => playerCardHTML(p, i + 1)).join("");
  };

  tabList.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "ed-role-tab" + (t.key === activeKey ? " active" : "");
    btn.textContent = t.label;
    btn.onclick = () => {
      tabs.querySelectorAll(".ed-role-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeKey = t.key;
      renderCat(t.key);
    };
    tabs.appendChild(btn);
  });

  renderCat("top_indian");
  body.innerHTML = `
    <div class="ed-cat-breakdown">
      <div class="ed-cat-breakdown-label">Points share by category</div>
      <div class="ed-cat-bar">${barSegs}</div>
    </div>
    <div class="ed-cat-summary">${summaryRows}</div>`;
  body.appendChild(tabs);
  body.appendChild(sumWrap);
  body.appendChild(listWrap);
  return sec;
}

function buildPlayerUsage(players) {
  const sec  = createSection("fas fa-users-line", "pu", "Player Usage");
  const body = sec.querySelector(".ed-section-body");

  const u = players?.player_usage || {};
  body.innerHTML = `
    <div class="ed-stat-grid two-col" style="margin-bottom:10px">
      <div class="ed-stat-cell"><span class="ed-stat-val pu">${u.unique_players_appeared ?? "--"}</span><span class="ed-stat-lbl">Unique Players Used</span></div>
      <div class="ed-stat-cell"><span class="ed-stat-val wh">${u.total_appearances ?? "--"}</span><span class="ed-stat-lbl">Total Appearances</span></div>
    </div>
    <div class="ed-stat-grid two-col">
      <div class="ed-stat-cell"><span class="ed-stat-val bl">${u.avg_appearances_per_match ?? "--"}</span><span class="ed-stat-lbl">Avg per Match</span></div>
      <div class="ed-stat-cell"><span class="ed-stat-val gd">${u.avg_pts_per_appearance ?? "--"}</span><span class="ed-stat-lbl">Avg Pts / Appearance</span></div>
    </div>
    <div class="ed-player-usage-note">
      <strong>${u.unique_players_appeared ?? "--"} players</strong> took the field across the season —
      <strong>${u.total_appearances ?? "--"} total appearances</strong>,
      averaging <strong>${u.avg_appearances_per_match ?? "--"} per match</strong>
      and earning <strong style="color:var(--gold)">${u.avg_pts_per_appearance ?? "--"} pts each time</strong>.
    </div>`;

  return sec;
}

// ─── COMPARE ──────────────────────────────────────────
function buildCompareSection(userId) {
  const sec  = createSection("fas fa-code-compare", "pu", "Compare with Another Team");
  const body = sec.querySelector(".ed-section-body");

  const opts = allTeams
    .filter(t => t.user_id !== userId && t.total_points > 0)
    .map(t => `<option value="${t.user_id}">${t.team_name || "Anonymous"} · ${Number(t.total_points).toLocaleString()} pts</option>`)
    .join("");

  body.innerHTML = `
    <div class="ed-compare-select-wrap">
      <i class="fas fa-users ed-select-icon"></i>
      <select id="compareSelector" class="ed-select" style="padding-left:38px">
        <option value="">Pick a team to compare...</option>
        ${opts}
      </select>
      <i class="fas fa-chevron-down ed-select-arrow"></i>
    </div>
    <div id="compareResult"></div>`;

  setTimeout(() => {
    document.getElementById("compareSelector")?.addEventListener("change", async e => {
      const cUid = e.target.value;
      const result = document.getElementById("compareResult");
      if (!cUid || !result) { if (result) result.innerHTML = ""; return; }
      await loadCompare(userId, cUid, result);
    });
  }, 100);

  return sec;
}

async function loadCompare(uid1, uid2, resultEl) {
  resultEl.innerHTML = '<div class="ed-no-data">Loading comparison...</div>';
  try {
    const [r1, r2] = await Promise.all([
      supabase.from("team_lab_view")
        .select("team_name,total_points,avg_score_per_match,best_match_score,worst_match_score,matches_played,captain_success_rate,consistency_score,total_subs_used,subs_remaining,boosters_remaining,booster_history")
        .eq("user_id", uid1).eq("tournament_id", activeTournamentId).maybeSingle(),
      supabase.from("team_lab_view")
        .select("team_name,total_points,avg_score_per_match,best_match_score,worst_match_score,matches_played,captain_success_rate,consistency_score,total_subs_used,subs_remaining,boosters_remaining,booster_history")
        .eq("user_id", uid2).eq("tournament_id", activeTournamentId).maybeSingle()
    ]);

    const a = r1.data, b = r2.data;
    if (!a || !b) { resultEl.innerHTML = '<div class="ed-no-data">Could not load comparison data.</div>'; return; }

    const safeJSON = v => { if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } };
    const aBoostHist = safeJSON(a.booster_history);
    const bBoostHist = safeJSON(b.booster_history);
    const aBoosters  = 7 - (a.boosters_remaining ?? 7);
    const bBoosters  = 7 - (b.boosters_remaining ?? 7);
    const aBoostPts  = aBoostHist.reduce((s, x) => s + (x.points || 0), 0);
    const bBoostPts  = bBoostHist.reduce((s, x) => s + (x.points || 0), 0);
    const aAvgBoost  = aBoosters > 0 ? Math.round(aBoostPts / aBoosters) : "--";
    const bAvgBoost  = bBoosters > 0 ? Math.round(bBoostPts / bBoosters) : "--";

    const allStats = [
      [a.total_points, b.total_points, true],
      [a.avg_score_per_match, b.avg_score_per_match, true],
      [a.best_match_score, b.best_match_score, true],
      [a.worst_match_score, b.worst_match_score, true],
      [a.consistency_score, b.consistency_score, true],
      [a.captain_success_rate, b.captain_success_rate, true],
      [a.total_subs_used, b.total_subs_used, false],
      [a.subs_remaining, b.subs_remaining, true],
      [aBoosters, bBoosters, false],
      [aBoostPts, bBoostPts, true],
      [aAvgBoost, bAvgBoost, true]
    ];

    let aWins = 0, bWins = 0;
    allStats.forEach(([v1, v2, hb]) => {
      const n1 = parseFloat(v1), n2 = parseFloat(v2);
      if (isNaN(n1) || isNaN(n2) || n1 === n2) return;
      if (hb ? n1 > n2 : n1 < n2) aWins++; else bWins++;
    });

    const vc = aWins > bWins ? "var(--accent)" : bWins > aWins ? "var(--red)" : "var(--text-faint)";
    const vt = aWins > bWins ? `${a.team_name || "Team A"} leads <strong>${aWins}–${bWins}</strong>`
      : bWins > aWins ? `${b.team_name || "Team B"} leads <strong>${bWins}–${aWins}</strong>`
      : `Dead heat — <strong>${aWins}–${bWins}</strong>`;

    const row = (lbl, v1, v2, hib = true) => {
      const n1 = parseFloat(v1), n2 = parseFloat(v2);
      let w1 = false, w2 = false;
      if (!isNaN(n1) && !isNaN(n2)) {
        if (hib) { w1 = n1 >= n2; w2 = n2 >= n1; }
        else     { w1 = n1 <= n2; w2 = n2 <= n1; }
      }
      return `<div class="ed-cmp-row">
        <div class="ed-cmp-val${w1 ? " win" : ""}">${v1 ?? "--"}</div>
        <div class="ed-cmp-label">${lbl}</div>
        <div class="ed-cmp-val${w2 ? " win" : ""}">${v2 ?? "--"}</div>
      </div>`;
    };
    const sectionLbl = lbl => `<div class="ed-cmp-section-label">${lbl}</div>`;

    resultEl.innerHTML = `
      <div class="ed-cmp-verdict" style="border-color:${vc}">
        <span style="color:${vc}">${vt}</span>
        <span class="ed-cmp-verdict-sub">across ${allStats.length} stat categories</span>
      </div>
      <div class="ed-cmp-header">
        <div class="ed-cmp-team">${a.team_name || "Team A"}</div>
        <div class="ed-cmp-vs">VS</div>
        <div class="ed-cmp-team">${b.team_name || "Team B"}</div>
      </div>
      ${sectionLbl("📊 Season")}
      ${row("Total Points", Number(a.total_points || 0).toLocaleString(), Number(b.total_points || 0).toLocaleString())}
      ${row("Matches Played", a.matches_played, b.matches_played)}
      ${row("Avg / Match", a.avg_score_per_match, b.avg_score_per_match)}
      ${row("Best Match", a.best_match_score, b.best_match_score)}
      ${row("Worst Match", a.worst_match_score, b.worst_match_score)}
      ${row("Consistency", a.consistency_score, b.consistency_score)}
      ${sectionLbl("👑 Captaincy")}
      ${row("Captain Success %", a.captain_success_rate, b.captain_success_rate)}
      ${sectionLbl("🔄 Subs")}
      ${row("Total Subs Used", a.total_subs_used, b.total_subs_used, false)}
      ${row("Subs Remaining", a.subs_remaining, b.subs_remaining)}
      ${sectionLbl("🚀 Boosters")}
      ${row("Boosters Used", aBoosters, bBoosters, false)}
      ${row("Total Booster Pts", aBoostPts, bBoostPts)}
      ${row("Avg Pts / Booster", aAvgBoost, bAvgBoost)}`;

  } catch (err) {
    console.error("Compare error:", err);
    resultEl.innerHTML = '<div class="ed-no-data">Failed to load comparison.</div>';
  }
}

// ─── SHARE CARD ───────────────────────────────────────
function buildShareCard(d, teamRow, totalPlayers) {
  const sec  = createSection("fas fa-share-alt", "green", "Share Your Stats");
  const body = sec.querySelector(".ed-section-body");

  const rank  = teamRow ? (teamRow.rank || teamRow.rank_in_league || "--") : (d.user_rank || "--");
  const rankN = parseInt(rank);
  const pct   = !isNaN(rankN) && totalPlayers > 1
    ? Math.round(((totalPlayers - rankN) / (totalPlayers - 1)) * 100) : null;
  const pctStr = pct !== null ? `Top ${100 - pct}% of all managers` : "";

  body.innerHTML = `
    <div class="ed-share-card" id="shareCardEl">
      <div class="ed-share-top">
        <div class="ed-share-title">Cricket Experts</div>
        <div class="ed-share-subtitle">Experts Dugout</div>
      </div>
      <div class="ed-share-team">${d.team_name || "My Team"}</div>
      <div class="ed-share-stats">
        <div class="ed-share-stat">
          <span class="ed-share-val">${Number(d.total_points || 0).toLocaleString()}</span>
          <span class="ed-share-lbl">Total pts</span>
        </div>
        <div class="ed-share-stat">
          <span class="ed-share-val">#${rank}</span>
          <span class="ed-share-lbl">Rank</span>
        </div>
        <div class="ed-share-stat">
          <span class="ed-share-val">${d.avg_score_per_match || 0}</span>
          <span class="ed-share-lbl">Avg/match</span>
        </div>
      </div>
      ${pctStr ? `<div class="ed-share-pct">${pctStr}</div>` : ""}
      <div class="ed-share-tagline">cricket-experts.app</div>
    </div>
    <button class="ed-share-btn" onclick="shareStats()">
      <i class="fas fa-share-alt"></i> Share My Stats
    </button>`;

  return sec;
}

window.shareStats = async () => {
  const card = document.getElementById("shareCardEl");
  if (!card) return;
  const text = card.innerText.replace(/\n+/g, " · ");
  if (navigator.share) {
    try { await navigator.share({ title: "My Cricket Experts Stats", text }); } catch (_) {}
  } else {
    await navigator.clipboard.writeText(text);
    showToast("Stats copied to clipboard!", "success");
  }
};

// ─── AD SLOT ──────────────────────────────────────────
//function buildAdSlot() {
  //const wrap = document.createElement("div");
  //wrap.className = "ed-ad-wrap";
  //const body = document.createElement("div");
  ///body.className = "ed-ad-body";
  //const holder = document.createElement("div");
  //holder.style.cssText = "width:100%;text-align:center";
  //if (!document.querySelector('script[data-zone="225656"]')) {
    //const s = document.createElement("script");
    //s.src = "https://quge5.com/88/tag.min.js"; s.async = true;
    //s.setAttribute("data-zone", "225656");
    //s.setAttribute("data-cfasync", "false");
    //holder.appendChild(s);
  //}
  //body.appendChild(holder); wrap.appendChild(body);
  //return wrap;
//}

// ─── HELPERS ──────────────────────────────────────────
function playerCardHTML(p, rank) {
  const rc = rank <= 3 ? `r${rank}` : "";
  return `
    <div class="ed-player-card">
      <div class="ed-player-rank ${rc}">${rank}</div>
      <div class="ed-player-info">
        <span class="ed-player-name">${p.name || "Unknown"}</span>
        <span class="ed-player-meta">${p.role || ""} · ${p.matches_played || p.matches_in_team || 0} matches played</span>
      </div>
      <div style="text-align:right">
        <span class="ed-player-pts">${Number(p.total_points_earned || 0).toLocaleString()}</span>
        <span class="ed-player-pts-lbl">pts earned</span>
      </div>
    </div>`;
}

function createSection(iconClass, iconColor, title) {
  const sec = document.createElement("div");
  sec.className = "ed-section";
  sec.innerHTML = `
    <div class="ed-section-header">
      <div class="ed-section-icon ${iconColor}"><i class="${iconClass}"></i></div>
      <h3 class="ed-section-title">${title}</h3>
    </div>
    <div class="ed-section-body"></div>`;
  return sec;
}

function showEmptyState() {
  const content = document.getElementById("dugoutContent");
  if (!content) return;
  content.innerHTML = `
    <div class="ed-empty-state">
      <div class="ed-empty-icon"><i class="fas fa-magnifying-glass-chart"></i></div>
      <p class="ed-empty-title">Pick a team to analyse</p>
      <p class="ed-empty-sub">Select from the dropdown above</p>
    </div>`;
}

function buildSkeletonHTML() {
  return [90, 120, 200, 140, 160]
    .map(h => `<div class="ed-skeleton" style="height:${h}px;margin-bottom:14px"></div>`)
    .join("");
}

function showToast(msg, type = "success") {
  const c = document.getElementById("toastContainer");
  if (!c) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add("fade-out");
    t.addEventListener("transitionend", () => t.remove(), { once: true });
  }, 3000);
}

function setupInfoPanel() {
  const btn     = document.getElementById("infoBtn");
  const overlay = document.getElementById("infoOverlay");
  const close   = document.getElementById("infoClose");
  btn?.addEventListener("click", () => overlay?.classList.remove("hidden"));
  close?.addEventListener("click", () => overlay?.classList.add("hidden"));
  overlay?.addEventListener("click", e => { if (e.target === overlay) overlay.classList.add("hidden"); });
}