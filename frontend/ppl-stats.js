import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

let statsData = [];
let playersMap = {};
let activeTab = 'batting';

async function init() {
    try {
        await authReady;
    } catch (_) {
        return; // auth-guard handles redirect
    }

    try {
        const [{ data: pl }, { data: stats }] = await Promise.all([
            supabase.from('ppl_players').select('id,name,team_id,ppl_teams(short_name)'),
            supabase.from('ppl_player_stats').select('*')
        ]);
        
        (pl || []).forEach(p => { playersMap[p.id] = p; });
        statsData = stats || [];
        
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

function render() {
    const q = document.getElementById('searchInput').value.toLowerCase();
    const el = document.getElementById('statsContent');

    if (!statsData.length) {
        el.innerHTML = '<div class="empty">No stats yet. Stats appear after matches are completed.</div>';
        return;
    }

    let data = statsData.filter(s => {
        const p = playersMap[s.player_id];
        return !q || (p?.name || '').toLowerCase().includes(q) || (p?.ppl_teams?.short_name || '').toLowerCase().includes(q);
    });

    if (activeTab === 'batting') {
        data = data.filter(s => (s.balls_faced || 0) > 0).sort((a, b) => (b.total_runs || 0) - (a.total_runs || 0));
        el.innerHTML = data.map((s, i) => {
            const p = playersMap[s.player_id];
            const sr = s.balls_faced > 0 ? ((s.total_runs / s.balls_faced) * 100).toFixed(1) : '-';
            const rowCls = i === 0 ? 'sr-top1' : i === 1 ? 'sr-top2' : i === 2 ? 'sr-top3' : '';
            return `
            <div class="stat-row ${rowCls}" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+1}</div>
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
    } 
    else if (activeTab === 'bowling') {
        data = data.filter(s => (s.overs_bowled || 0) > 0).sort((a, b) => (b.wickets || 0) - (a.wickets || 0));
        el.innerHTML = data.map((s, i) => {
            const p = playersMap[s.player_id];
            const econ = s.economy ? s.economy.toFixed(1) : '-';
            const rowCls = i === 0 ? 'sr-top1' : i === 1 ? 'sr-top2' : i === 2 ? 'sr-top3' : '';
            return `
            <div class="stat-row ${rowCls}" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+1}</div>
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
    } 
    else if (activeTab === 'fielding') {
        data = data.filter(s => (s.catches || 0) + (s.stumpings || 0) + (s.run_outs || 0) > 0)
                   .sort((a, b) => (b.catches + b.stumpings + b.run_outs) - (a.catches + a.stumpings + a.run_outs));
        el.innerHTML = data.map((s, i) => {
            const p = playersMap[s.player_id];
            const rowCls = i === 0 ? 'sr-top1' : i === 1 ? 'sr-top2' : i === 2 ? 'sr-top3' : '';
            return `
            <div class="stat-row ${rowCls}" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+1}</div>
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
    } 
    else if (activeTab === 'fantasy') {
        data = data.filter(s => (s.fantasy_points_total || 0) > 0)
                   .sort((a, b) => (b.fantasy_points_total || 0) - (a.fantasy_points_total || 0));
        el.innerHTML = data.map((s, i) => {
            const p = playersMap[s.player_id];
            const avg = s.matches > 0 ? (s.fantasy_points_total / s.matches).toFixed(1) : '-';
            const rowCls = i === 0 ? 'sr-top1' : i === 1 ? 'sr-top2' : i === 2 ? 'sr-top3' : '';
            return `
            <div class="stat-row ${rowCls}" onclick="location.href='ppl-player-profile.html?player=${s.player_id}'">
                <div class="sr-rank">${i+1}</div>
                <div class="sr-player">
                    <div class="sr-name">${p?.name || '?'}</div>
                    <div class="sr-team">${p?.ppl_teams?.short_name || ''}</div>
                </div>
                <div class="sr-stats">
                    <div class="sr-stat-item"><div class="sr-stat-val">${s.matches || 0}</div><div class="sr-stat-lbl">M</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val">${avg}</div><div class="sr-stat-lbl">Avg</div></div>
                    <div class="sr-stat-item"><div class="sr-stat-val highlight">${s.fantasy_points_total || 0}</div><div class="sr-stat-lbl">Pts</div></div>
                </div>
            </div>`;
        }).join('');
    }

    if(data.length === 0) {
        el.innerHTML = '<div class="empty">No players match your search.</div>';
    }
}

// Add this inside your ppl-stats.js file

async function loadFantasyTab() {
    const content = document.getElementById('statsContent');
    content.innerHTML = '<div class="loading"><i class="fas fa-circle-notch fa-spin"></i> Loading Fantasy Leaders...</div>';

    // Fetch from the aggregated view
    const { data, error } = await supabase
        .from('v_ppl_player_overall_stats')
        .select('*')
        .order('fantasy_points', { ascending: false });

    if (error || !data || data.length === 0) {
        content.innerHTML = '<div class="empty">No fantasy data available yet. Check back after Match 1!</div>';
        return;
    }

    content.innerHTML = '';

    data.forEach((player, index) => {
        const rank = index + 1;
        
        // Assign styling for Top 3
        let rankClass = '';
        if (rank === 1) rankClass = 'sr-top1';
        else if (rank === 2) rankClass = 'sr-top2';
        else if (rank === 3) rankClass = 'sr-top3';

        const row = document.createElement('div');
        row.className = `stat-row ${rankClass}`;
        
        row.innerHTML = `
            <div class="sr-rank">${rank}</div>
            <div class="sr-player">
                <div class="sr-name">${player.name}</div>
                <div class="sr-team">${player.team_name || 'TBA'} · ${player.role}</div>
            </div>
            <div class="sr-stats">
                <div class="sr-stat-item">
                    <span class="sr-stat-val highlight">${player.fantasy_points}</span>
                    <span class="sr-stat-lbl">PTS</span>
                </div>
                <div class="sr-stat-item">
                    <span class="sr-stat-val">${player.runs}</span>
                    <span class="sr-stat-lbl">RUNS</span>
                </div>
                <div class="sr-stat-item">
                    <span class="sr-stat-val">${player.wickets}</span>
                    <span class="sr-stat-lbl">WKTS</span>
                </div>
            </div>
        `;
        content.appendChild(row);
    });
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