import { supabase } from "./supabase.js";

const searchInput = document.getElementById("playerSearch");
const teamFilter = document.getElementById("teamFilter");
const matchFilter = document.getElementById("matchFilter");
const statsContainer = document.getElementById("statsContainer");
const loader = document.getElementById("loadingOverlay");

async function initStats() {
    // 1. Parallel Load Filters
    const [teamsRes, matchesRes] = await Promise.all([
        supabase.from('real_teams').select('short_code').order('short_code'),
        supabase.from('matches').select('id, match_number, team_a:real_teams!team_a_id(short_code), team_b:real_teams!team_b_id(short_code)').order('match_number', { ascending: false })
    ]);

    if (teamsRes.data) {
        teamFilter.innerHTML += teamsRes.data.map(t => `<option value="${t.short_code}">${t.short_code}</option>`).join('');
    }

    if (matchesRes.data) {
        matchFilter.innerHTML += matchesRes.data.map(m => `
            <option value="${m.id}">M${m.match_number}: ${m.team_a.short_code} vs ${m.team_b.short_code}</option>
        `).join('');
    }

    await loadPlayerStats();
}

async function loadPlayerStats() {
    loader.style.display = "flex";
    const searchTerm = searchInput.value.toLowerCase();
    const team = teamFilter.value;
    const matchId = matchFilter.value;

    // Fixed Join Syntax for Supabase
    let query = supabase
        .from('player_match_stats')
        .select(`
            *,
            player:players!inner(
                name,
                team:real_teams!inner(short_code)
            ),
            match:matches!inner(match_number)
        `);

    // Apply filters correctly to the joined tables
    if (team) query = query.eq('player.team.short_code', team);
    if (matchId) query = query.eq('match_id', matchId);
    
    const { data: stats, error } = await query.order('created_at', { ascending: false });

    if (!error && stats) {
        const filtered = stats.filter(s => s.player?.name.toLowerCase().includes(searchTerm));
        renderStats(filtered);
    } else {
        console.error("Stats Error:", error);
        statsContainer.innerHTML = `<div class="empty-state">No data available for this selection.</div>`;
    }
    loader.style.display = "none";
}

function renderStats(data) {
    if (data.length === 0) {
        statsContainer.innerHTML = `<div class="empty-state">No player found.</div>`;
        return;
    }

    // Grouping by Player ID
    const grouped = data.reduce((acc, curr) => {
        const pId = curr.player_id;
        if (!acc[pId]) {
            acc[pId] = { 
                name: curr.player?.name || 'Unknown', 
                team: curr.player?.team?.short_code || 'TBA', 
                matches: [] 
            };
        }
        acc[pId].matches.push(curr);
        return acc;
    }, {});

    // Sort players by total points (Descending)
    const sortedPlayers = Object.values(grouped).sort((a, b) => {
        const sumA = a.matches.reduce((s, m) => s + m.fantasy_points, 0);
        const sumB = b.matches.reduce((s, m) => s + m.fantasy_points, 0);
        return sumB - sumA;
    });

    statsContainer.innerHTML = sortedPlayers.map(player => {
        const totalPoints = player.matches.reduce((sum, m) => sum + (m.fantasy_points || 0), 0);
        const isElite = totalPoints > 300; // Visual badge for high performers

        return `
        <div class="player-card ${isElite ? 'elite-border' : ''}">
            <div class="player-header" onclick="this.parentElement.classList.toggle('active')">
                <div class="p-info">
                    <span class="team-badge">${player.team}</span>
                    <span class="p-name">${player.name} ${isElite ? '🔥' : ''}</span>
                </div>
                <div class="p-score">
                    <strong>${totalPoints}</strong> <small>pts</small>
                    <span class="dropdown-arrow">▼</span>
                </div>
            </div>
            <div class="match-history">
                <div class="history-label">Match-by-Match Breakdown</div>
                ${player.matches.map(m => renderDetailedHistoryItem(m)).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderDetailedHistoryItem(m) {
    const log = [];
    
    // --- BATTING STATS ---
    if (m.runs > 0) {
        // Show balls faced if available, e.g., "40 Runs (20b)"
        const ballsText = m.balls ? ` (${m.balls}b)` : '';
        log.push(`<span class="stat-tag bat">🏏 ${m.runs} Runs${ballsText}</span>`);
    }
    if (m.fours > 0 || m.sixes > 0) {
        log.push(`<span class="stat-tag boundary">🎯 ${m.fours || 0}x4, ${m.sixes || 0}x6</span>`);
    }
    if (m.sr_points && m.sr_points !== 0) {
        log.push(`<span class="stat-tag bonus">⚡ SR ${m.sr_points > 0 ? '+' : ''}${m.sr_points}</span>`);
    }
    if (m.duck_penalty && m.duck_penalty < 0) {
        log.push(`<span class="stat-tag penalty">🦆 Duck ${m.duck_penalty}</span>`);
    }
    
    // --- BOWLING STATS ---
    if (m.wickets > 0) log.push(`<span class="stat-tag bowl">🎳 ${m.wickets} Wkts</span>`);
    if (m.maidens > 0) log.push(`<span class="stat-tag bowl">🧱 ${m.maidens} Mdn</span>`);
    if (m.er_points && m.er_points !== 0) {
        log.push(`<span class="stat-tag bonus">📉 Econ ${m.er_points > 0 ? '+' : ''}${m.er_points}</span>`);
    }
    
    // --- FIELDING STATS ---
    if (m.catches > 0) log.push(`<span class="stat-tag field">🧤 ${m.catches} Cth</span>`);
    if (m.stumpings > 0) log.push(`<span class="stat-tag field">🏃‍♂️ ${m.stumpings} Stmp</span>`);
    if (m.run_outs && m.run_outs > 0) log.push(`<span class="stat-tag field">🎯 ${m.run_outs} RO</span>`);
    
    // --- AWARDS ---
    if (m.is_player_of_match) log.push(`<span class="stat-tag gold">🏆 POM</span>`);

    // Senior UI Tip: Highlight big games (100+ points)
    const isBigGame = m.fantasy_points >= 100;

    return `
        <div class="history-item ${isBigGame ? 'big-game' : ''}">
            <div class="h-top">
                <span>Match ${m.match?.match_number || '#'}</span>
                <span class="h-pts">${isBigGame ? '🌟 ' : ''}+${m.fantasy_points} pts</span>
            </div>
            <div class="detailed-stat-grid">
                ${log.length > 0 ? log.join('') : '<span class="stat-tag empty">Played</span>'}
            </div>
        </div>
    `;
}

// --- EVENT LISTENERS ---
let searchTimeout;

searchInput.addEventListener("input", () => {
    // Clear the previous timer if they are still typing
    clearTimeout(searchTimeout);
    
    // Wait 400ms after they stop typing before hitting the database
    searchTimeout = setTimeout(() => {
        loadPlayerStats();
    }, 400);
});

teamFilter.addEventListener("change", () => loadPlayerStats());
matchFilter.addEventListener("change", () => loadPlayerStats());

initStats();