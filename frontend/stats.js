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

    // 1. Querying the table directly with correct column names and joins
    let query = supabase
        .from('player_match_stats')
        .select(`
            *,
            player_info:players(name),
            team_info:real_teams!match_id(short_code),
            match_info:matches(match_number)
        `)
        .order('fantasy_points', { ascending: false }); // FIXED: Use fantasy_points, not match_total_points

    if (team) query = query.eq('team_info.short_code', team);
    if (matchId) query = query.eq('match_id', matchId);
    
    const { data: stats, error } = await query;

    if (!error && stats) {
        // 2. Filter by player name from the joined 'players' table
        const filtered = stats.filter(s => 
            s.player_info?.name.toLowerCase().includes(searchTerm)
        );
        renderStats(filtered);
    } else {
        console.error("Stats fetch error:", error);
    }
    loader.style.display = "none";
}

function renderStats(data) {
    if (data.length === 0) {
        statsContainer.innerHTML = `<div class="empty-state">No performance data found.</div>`;
        return;
    }

    // 3. Grouping by player with updated data mapping
    const grouped = data.reduce((acc, curr) => {
        if (!acc[curr.player_id]) {
            acc[curr.player_id] = { 
                name: curr.player_info?.name, 
                team: curr.team_info?.short_code || 'TBA', 
                matches: [] 
            };
        }
        acc[curr.player_id].matches.push(curr);
        return acc;
    }, {});

    statsContainer.innerHTML = Object.values(grouped).map(player => {
        // FIXED: Summing 'fantasy_points' instead of 'match_total_points'
        const totalPoints = player.matches.reduce((sum, m) => sum + (m.fantasy_points || 0), 0);
        
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
    const log = [];
    
    // --- BATTING SECTION ---
    if (m.runs > 0) log.push(`${m.runs} Runs (+${m.runs})`);
    
    // Stored point values from Edge Function
    if (m.boundary_points > 0) log.push(`Boundaries (+${m.boundary_points})`);
    if (m.milestone_points > 0) log.push(`Milestone (+${m.milestone_points})`);
    
    if (m.sr_points !== 0) {
        const srSign = m.sr_points > 0 ? '+' : '';
        log.push(`Strike Rate (${srSign}${m.sr_points})`);
    }

    // --- BOWLING SECTION ---
    if (m.wickets > 0) {
        // Calculation: 1st Wicket 20, others 25 as per Edge Function
        const wicketPts = 20 + (Math.max(0, m.wickets - 1) * 25);
        log.push(`${m.wickets} Wkts (+${wicketPts})`);
    }
    if (m.maidens > 0) log.push(`${m.maidens} Maidens (+${m.maidens * 10})`);
    
    if (m.er_points !== 0) {
        const erSign = m.er_points > 0 ? '+' : '';
        log.push(`Economy (${erSign}${m.er_points})`);
    }

    // --- FIELDING SECTION ---
    if (m.catches > 0) log.push(`${m.catches} Catch (+${m.catches * 8})`);
    if (m.stumpings > 0) log.push(`${m.stumpings} Stump (+${m.stumpings * 8})`);
    
    const totalRunouts = (m.runouts_direct || 0) + (m.runouts_assisted || 0);
    if (totalRunouts > 0) log.push(`${totalRunouts} Runout (+${totalRunouts * 8})`);

    // --- BONUSES & PENALTIES ---
    if (m.involvement_points > 0) log.push(`Involvement (+${m.involvement_points})`);
    if (m.is_player_of_match) log.push(`POM (+20)`);
    if (m.duck_penalty !== 0) log.push(`Duck Penalty (${m.duck_penalty})`);

    return `
        <div class="history-item">
            <div class="h-top">
                <span>Match ${m.match_number?.match_number || m.match_number}</span>
                <span class="h-pts">+${m.fantasy_points} pts</span>
            </div>
            
            <div class="h-stats-grid">
                <div class="stat-pill">🏏 ${m.runs || 0}(${m.balls || 0})</div>
                <div class="stat-pill">☝️ ${m.wickets || 0} Wkts</div>
                <div class="stat-pill ${m.is_player_of_match ? 'gold' : ''}">
                    ${m.is_player_of_match ? '🏆 POM' : `🤲 ${m.catches || 0} Catch`}
                </div>
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