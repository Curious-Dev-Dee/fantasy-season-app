import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

let statsData = [];
let fantasyData = []; 
let momData = []; // To store MOM counts
let playersMap = {};
let activeTab = 'batting';

async function init() {
    try {
        await authReady;
    } catch (_) {
        return; 
    }

    try {
        // Fetch all necessary tables concurrently
        const [
            { data: pl }, 
            { data: stats }, 
            { data: fantasy },
            { data: matches }
        ] = await Promise.all([
            supabase.from('ppl_players').select('id,name,team_id,ppl_teams(short_name),role'),
            supabase.from('ppl_player_stats').select('*'),
            supabase.from('v_ppl_player_overall_stats').select('*').order('fantasy_points', { ascending: false }),
            supabase.from('ppl_matches').select('mom_player_id').not('mom_player_id', 'is', null)
        ]);
        
        (pl || []).forEach(p => { playersMap[p.id] = p; });
        statsData = stats || [];
        fantasyData = fantasy || [];

        // Aggregate MOM counts
        let momCounts = {};
        (matches || []).forEach(m => {
            if (m.mom_player_id) {
                momCounts[m.mom_player_id] = (momCounts[m.mom_player_id] || 0) + 1;
            }
        });
        
        momData = Object.entries(momCounts).map(([id, count]) => {
            return { player_id: id, mom_count: count };
        }).sort((a, b) => b.mom_count - a.mom_count);
        
        setupListeners();
        render();
    } catch (err) {
        console.error("Stats load error:", err);
        document.getElementById('statsContent').innerHTML = '<div class="empty">Failed to load stats. Please refresh.</div>';
    } finally {
        document.body.classList.remove("loading-state");
        document.getElementById("skeletonScreen")?.classList.add("hidden");
        initLiveNav();
    }
}

function setupListeners() {
    document.querySelectorAll(".xi-tab").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll('.xi-tab').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeTab = e.currentTarget.dataset.tab;
            render();
        });
    });

    document.getElementById('searchInput').addEventListener("input", render);
}

// ── PODIUM GENERATOR ──
function buildPodiumHtml(top3, type) {
    if (top3.length === 0) return '';
    
    const getStepHtml = (playerObj, rank) => {
        if (!playerObj) return `<div class="podium-step step-${rank}"></div>`;
        
        let statVal = 0, statLbl = '';
        const pid = playerObj.player_id || playerObj.id;

        // Extract primary stat based on active tab
        if (type === 'batting') { 
            statVal = playerObj.total_runs || 0; statLbl = 'Runs'; 
        } else if (type === 'bowling') { 
            statVal = playerObj.wickets || 0; statLbl = 'Wkts'; 
        } else if (type === 'fielding') { 
            statVal = (playerObj.catches||0) + (playerObj.stumpings||0) + (playerObj.run_outs||0); statLbl = 'Dismissals'; 
        } else if (type === 'mos') { 
            statVal = playerObj.fantasy_points || 0; statLbl = 'Points'; 
        } else if (type === 'mom') { 
            statVal = playerObj.mom_count || 0; statLbl = 'Awards'; 
        }

        const p = playersMap[pid];
        const name = p?.name || 'Unknown';
        // Future proofing: Use bucket URL here if photo_url exists
        const avatarStyle = ""; 

        return `
        <div class="podium-step step-${rank}">
            <div class="podium-avatar" style="${avatarStyle}"></div>
            <div class="podium-box">
                <div class="podium-rank-badge">${rank}</div>
                <div class="podium-name">${name}</div>
                <div class="podium-stat">${statVal}</div>
                <div class="podium-lbl">${statLbl}</div>
            </div>
        </div>`;
    };

    // Render order: 2nd place (Left), 1st place (Center), 3rd place (Right)
    return `
    <div class="podium-wrapper">
        ${getStepHtml(top3[1], 2)}
        ${getStepHtml(top3[0], 1)}
        ${getStepHtml(top3[2], 3)}
    </div>`;
}

function render() {
    const q = document.getElementById('searchInput').value.toLowerCase();
    const el = document.getElementById('statsContent');
    const notesContainer = document.getElementById('notesContainer');

    // EXPLANATORY NOTES
    if (activeTab === 'mos') {
        notesContainer.innerHTML = `<div class="info-note"><i class="fas fa-info-circle"></i> <b>Man of the Series Calculation:</b> Overall tournament performance. Points are summed from Runs scored, Wickets taken, and Fielding dismissals. The highest total secures the award.</div>`;
    } else if (activeTab === 'mom') {
        notesContainer.innerHTML = `<div class="info-note"><i class="fas fa-info-circle"></i> <b>Man of the Match Selection:</b> In each match, the player with the highest combined impact points (Runs + Wickets + Fielding) is awarded MOM.</div>`;
    } else {
        notesContainer.innerHTML = '';
    }

    if (!statsData.length && !fantasyData.length && !momData.length) {
        el.innerHTML = '<div class="empty">No stats yet. Stats appear after matches are completed.</div>';
        return;
    }

    let rawList = [];

    // --- MAN OF SERIES (MOS) TAB ---
    if (activeTab === 'mos') {
        rawList = fantasyData.filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.team_name || '').toLowerCase().includes(q));
        if (rawList.length === 0) { el.innerHTML = '<div class="empty">No players match your search.</div>'; return; }
        
        const top3 = rawList.slice(0, 3);
        const rest = rawList.slice(3);

        let listHtml = rest.map((player, i) => {
            // Fix wicket zero-bug by pulling from base stats
            const baseStats = statsData.find(s => s.player_id === player.id) || {};
            const trueWickets = baseStats.wickets || 0;
            const trueRuns = baseStats.total_runs || 0;

            return `
            <div class="stat-row" onclick="location.href='ppl-player-profile.html?player=${player.id}'">
                <div class="sr-rank">${i + 4}</div>
                <div class="sr-player">
                    <div class="sr-name">${player.name}</div>
                    <div class="sr-team">${player.team_name || 'TBA'} · ${player.role || 'Unknown'}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><span class="sr-stat-val highlight">${player.fantasy_points || 0}</span><span class="sr-stat-lbl">PTS</span></div>
                    <div class="sr-stat-item"><span class="sr-stat-val">${trueRuns}</span><span class="sr-stat-lbl">RUNS</span></div>
                    <div class="sr-stat-item"><span class="sr-stat-val">${trueWickets}</span><span class="sr-stat-lbl">WKTS</span></div>
                </div>
            </div>`;
        }).join('');

        el.innerHTML = buildPodiumHtml(top3, 'mos') + `<div class="stats-list-container">${listHtml}</div>`;
        return;
    }

    // --- MOST MOM TAB ---
    if (activeTab === 'mom') {
        rawList = momData.filter(s => {
            const p = playersMap[s.player_id];
            return !q || (p?.name || '').toLowerCase().includes(q) || (p?.ppl_teams?.short_name || '').toLowerCase().includes(q);
        });
        if (rawList.length === 0) { el.innerHTML = '<div class="empty">No Man of the Match awards distributed yet.</div>'; return; }

        const top3 = rawList.slice(0, 3);
        const rest = rawList.slice(3);

        let listHtml = rest.map((s, i) => {
            const p = playersMap[s.player_id];
            return `
            <div class="stat-row" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+4}</div>
                <div class="sr-player">
                    <div class="sr-name">${p?.name || '?'}</div>
                    <div class="sr-team">${p?.ppl_teams?.short_name || ''}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><div class="sr-stat-val highlight">${s.mom_count}</div><div class="sr-stat-lbl">Awards</div></div>
                </div>
            </div>`;
        }).join('');

        el.innerHTML = buildPodiumHtml(top3, 'mom') + `<div class="stats-list-container">${listHtml}</div>`;
        return;
    }

    // --- BATTING, BOWLING, FIELDING TABS ---
    let data = statsData.filter(s => {
        const p = playersMap[s.player_id];
        return !q || (p?.name || '').toLowerCase().includes(q) || (p?.ppl_teams?.short_name || '').toLowerCase().includes(q);
    });

    if (activeTab === 'batting') {
        data = data.filter(s => (s.balls_faced || 0) > 0).sort((a, b) => (b.total_runs || 0) - (a.total_runs || 0));
        if (data.length === 0) { el.innerHTML = '<div class="empty">No data available.</div>'; return; }
        
        const top3 = data.slice(0, 3);
        const rest = data.slice(3);

        let listHtml = rest.map((s, i) => {
            const p = playersMap[s.player_id];
            const sr = s.balls_faced > 0 ? ((s.total_runs / s.balls_faced) * 100).toFixed(1) : '-';
            return `
            <div class="stat-row" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+4}</div>
                <div class="sr-player">
                    <div class="sr-name">${p?.name || '?'}</div>
                    <div class="sr-team">${p?.ppl_teams?.short_name || ''}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.matches || 0}</div><div class="sr-stat-lbl">M</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${sr}</div><div class="sr-stat-lbl">SR</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.highest_score || 0}</div><div class="sr-stat-lbl">HS</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val highlight">${s.total_runs || 0}</div><div class="sr-stat-lbl">Runs</div></div>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = buildPodiumHtml(top3, 'batting') + `<div class="stats-list-container">${listHtml}</div>`;
    } 
    else if (activeTab === 'bowling') {
        data = data.filter(s => (s.overs_bowled || 0) > 0).sort((a, b) => (b.wickets || 0) - (a.wickets || 0));
        if (data.length === 0) { el.innerHTML = '<div class="empty">No data available.</div>'; return; }
        
        const top3 = data.slice(0, 3);
        const rest = data.slice(3);

        let listHtml = rest.map((s, i) => {
            const p = playersMap[s.player_id];
            const econ = s.economy ? s.economy.toFixed(1) : '-';
            return `
            <div class="stat-row" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+4}</div>
                <div class="sr-player">
                    <div class="sr-name">${p?.name || '?'}</div>
                    <div class="sr-team">${p?.ppl_teams?.short_name || ''}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.matches || 0}</div><div class="sr-stat-lbl">M</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${econ}</div><div class="sr-stat-lbl">Econ</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.best_bowling || '-'}</div><div class="sr-stat-lbl">Best</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val highlight">${s.wickets || 0}</div><div class="sr-stat-lbl">Wkts</div></div>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = buildPodiumHtml(top3, 'bowling') + `<div class="stats-list-container">${listHtml}</div>`;
    } 
    else if (activeTab === 'fielding') {
        data = data.filter(s => (s.catches || 0) + (s.stumpings || 0) + (s.run_outs || 0) > 0)
                   .sort((a, b) => (b.catches + b.stumpings + b.run_outs) - (a.catches + a.stumpings + a.run_outs));
        if (data.length === 0) { el.innerHTML = '<div class="empty">No data available.</div>'; return; }
        
        const top3 = data.slice(0, 3);
        const rest = data.slice(3);

        let listHtml = rest.map((s, i) => {
            const p = playersMap[s.player_id];
            return `
            <div class="stat-row" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+4}</div>
                <div class="sr-player">
                    <div class="sr-name">${p?.name || '?'}</div>
                    <div class="sr-team">${p?.ppl_teams?.short_name || ''}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.matches || 0}</div><div class="sr-stat-lbl">M</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.stumpings || 0}</div><div class="sr-stat-lbl">Stump</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.run_outs || 0}</div><div class="sr-stat-lbl">RO</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val highlight">${s.catches || 0}</div><div class="sr-stat-lbl">Catch</div></div>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = buildPodiumHtml(top3, 'fielding') + `<div class="stats-list-container">${listHtml}</div>`;
    }
}

// Global Nav Sync (Live dot indicator)
async function initLiveNav() {
    const navLiveDot = document.getElementById("navLiveDot");
    const navMatchLabel = document.getElementById("navMatchLabel");
    if (!navLiveDot) return;

    const updateNavUI = async () => {
        const { data: match } = await supabase.from("ppl_matches").select("id").eq("status", "in_progress").limit(1).maybeSingle();
        if (match) {
            navMatchLabel.textContent = "LIVE";
            navLiveDot.classList.remove("hidden");
        } else {
            navMatchLabel.textContent = "Scores";
            navLiveDot.classList.add("hidden");
        }
    };
    updateNavUI();
    supabase.channel('ppl-nav-updates').on('postgres_changes', { event: 'UPDATE', table: 'ppl_matches' }, updateNavUI).subscribe();
}

init();