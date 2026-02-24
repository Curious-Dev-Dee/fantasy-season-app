import { supabase } from "./supabase.js";

// Fantasy Point Rules Mapping
const POINT_SYSTEM = {
    run: 1, fours: 1, sixes: 2, wicket: 25, maiden: 8, catch: 8, stumping: 12, direct_ro: 12, assisted_ro: 6, potm: 25
};

const searchInput = document.getElementById("playerSearch");
const teamFilter = document.getElementById("teamFilter");
const matchFilter = document.getElementById("matchFilter");
const statsContainer = document.getElementById("statsContainer");
const loader = document.getElementById("loadingOverlay");

async function initStats() {
    // 1. Load Teams for filter
    const { data: teams } = await supabase.from('real_teams').select('short_code');
    if (teams) {
        teamFilter.innerHTML += teams.map(t => `<option value="${t.short_code}">${t.short_code}</option>`).join('');
    }

    // 2. Load Matches for filter
    const { data: matches } = await supabase
        .from('matches')
        .select('id, match_number, team_a_id, team_b_id')
        .order('match_number', { ascending: false });

    const { data: teamData } = await supabase.from('real_teams').select('id, short_code');
    const tMap = Object.fromEntries(teamData.map(t => [t.id, t.short_code]));

    if (matches) {
        matchFilter.innerHTML += matches.map(m => `
            <option value="${m.id}">M${m.match_number}: ${tMap[m.team_a_id]} vs ${tMap[m.team_b_id]}</option>
        `).join('');
    }

    await loadPlayerStats();
}

async function loadPlayerStats() {
    loader.style.display = "flex";
    const searchTerm = searchInput.value.toLowerCase();
    const team = teamFilter.value;
    const matchId = matchFilter.value;

    // Querying the performance audit view
    let query = supabase.from('player_performance_audit').select('*');

    if (team) query = query.eq('team_code', team);
    if (matchId) query = query.eq('match_id', matchId);
    
    const { data: stats, error } = await query.order('match_total_points', { ascending: false });

    if (!error) {
        const filtered = stats.filter(s => s.player_name.toLowerCase().includes(searchTerm));
        renderStats(filtered);
    }
    loader.style.display = "none";
}

function renderStats(data) {
    if (data.length === 0) {
        statsContainer.innerHTML = `<div class="empty-state">No performance data found.</div>`;
        return;
    }

    // Grouping by player
    const grouped = data.reduce((acc, curr) => {
        if (!acc[curr.player_id]) {
            acc[curr.player_id] = { name: curr.player_name, team: curr.team_code, matches: [] };
        }
        acc[curr.player_id].matches.push(curr);
        return acc;
    }, {});

    statsContainer.innerHTML = Object.values(grouped).map(player => {
        const totalPoints = player.matches.reduce((sum, m) => sum + m.match_total_points, 0);
        
        return `
        <div class="player-card">
            <div class="player-header" onclick="this.parentElement.classList.toggle('active')">
                <div class="p-info">
                    <span class="team-badge">${player.team}</span>
                    <span class="p-name">${player.name}</span>
                </div>
                <div class="p-score">
                    <strong>${totalPoints}</strong> <small>pts</small>
                    <span class="dropdown-arrow">▼</span>
                </div>
            </div>
            <div class="match-history">
                ${player.matches.map(m => renderDetailedHistoryItem(m)).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderDetailedHistoryItem(m) {
    // Generate Point Log Breakdown
    const log = [];
    if (m.runs > 0) log.push(`${m.runs} Runs (+${m.runs * POINT_SYSTEM.run})`);
    if (m.fours > 0) log.push(`${m.fours} Fours (+${m.fours * POINT_SYSTEM.fours})`);
    if (m.sixes > 0) log.push(`${m.sixes} Sixes (+${m.sixes * POINT_SYSTEM.sixes})`);
    if (m.wickets > 0) log.push(`${m.wickets} Wkts (+${m.wickets * POINT_SYSTEM.wicket})`);
    if (m.maidens > 0) log.push(`${m.maidens} Maidens (+${m.maidens * POINT_SYSTEM.maiden})`);
    if (m.catches > 0) log.push(`${m.catches} Catch (+${m.catches * POINT_SYSTEM.catch})`);
    if (m.is_player_of_match) log.push(`POTM Bonus (+${POINT_SYSTEM.potm})`);

    return `
        <div class="history-item">
            <div class="h-top">
                <span>Match ${m.match_number}</span>
                <span class="h-pts">+${m.match_total_points}</span>
            </div>
            
            <div class="h-stats-grid">
                <div class="stat-pill">🏏 ${m.runs || 0}(${m.balls || 0})</div>
                <div class="stat-pill">☝️ ${m.wickets || 0} Wkts</div>
                <div class="stat-pill">🤲 ${m.catches || 0} Catch</div>
            </div>

            <div class="points-breakdown">
                <label>POINT LOG</label>
                <div class="log-items">
                    ${log.length > 0 ? log.map(item => `<span>${item}</span>`).join('') : '<span>No scoring actions</span>'}
                </div>
            </div>
        </div>
    `;
}

searchInput.addEventListener("input", loadPlayerStats);
teamFilter.addEventListener("change", loadPlayerStats);
matchFilter.addEventListener("change", loadPlayerStats);
initStats();