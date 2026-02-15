import { supabase } from "./supabase.js";

const searchInput = document.getElementById("playerSearch");
const teamFilter = document.getElementById("teamFilter");
const matchFilter = document.getElementById("matchFilter");
const statsContainer = document.getElementById("statsContainer");
const loader = document.getElementById("loadingOverlay");

async function initStats() {
    // 1. Load Teams
    const { data: teams } = await supabase.from('real_teams').select('short_code');
    if (teams) {
        teamFilter.innerHTML += teams.map(t => `<option value="${t.short_code}">${t.short_code}</option>`).join('');
    }

    // 2. Load Matches for Filter
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
                </div>
            </div>
            <div class="match-history">
                ${player.matches.map(m => `
                    <div class="history-item">
                        <div class="h-top">
                            <span>Match ${m.match_number}</span>
                            <span class="h-pts">+${m.match_total_points}</span>
                        </div>
                        <div class="h-stats">
                            ${m.runs > 0 ? `<span>🏏 ${m.runs}(${m.balls})</span>` : ''}
                            ${m.wickets > 0 ? `<span>☝️ ${m.wickets} Wkts</span>` : ''}
                            ${m.catches > 0 ? `<span>🤲 ${m.catches} C</span>` : ''}
                            ${m.maidens > 0 ? `<span>🎯 ${m.maidens} M</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }).join('');
}

searchInput.addEventListener("input", loadPlayerStats);
teamFilter.addEventListener("change", loadPlayerStats);
matchFilter.addEventListener("change", loadPlayerStats);
initStats();