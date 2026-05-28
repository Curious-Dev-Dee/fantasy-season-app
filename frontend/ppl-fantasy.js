import { supabase } from "./supabase.js";
import { authReady } from "./auth-state.js";

// ─── FANTASY POINTS SYSTEM ────────────────────────────────────────────────
const PTS = {
  run: 1,
  four_bonus: 1,
  six_bonus: 2,
  duck: -5,
  wicket: 30,
  maiden: 30,
  economy_good: 10,    // <=10
  economy_bad1: -5,    // >=15
  economy_bad2: -10,   // >=20
  wkt_bonus_2: 10,
  wkt_bonus_3: 15,
  wkt_bonus_4: 20,
  wkt_bonus_5: 25,
  catch: 8,
  stumping: 8,
  run_out: 8,
  mom: 25
};

// ─── STATE ────────────────────────────────────────────────────────────────
let ME = null;
let phases = {};       // { group_a: {...}, group_b: {...}, knockout: {...} }
let allPlayers = [];   // ppl_players with team join
let activePhase = 'group_a';
let activeInnerTab = 'pick';
let activeLbTab = 'overall';

// Per-phase pick state
let pickState = {
  group_a:  { selected: new Set(), captainId: null, vcId: null, existingTeam: null },
  group_b:  { selected: new Set(), captainId: null, vcId: null, existingTeam: null },
  knockout: { selected: new Set(), captainId: null, vcId: null, existingTeam: null }
};
let roleFilter = 'ALL';

// ─── HELPERS ──────────────────────────────────────────────────────────────
function ps() { return pickState[activePhase]; }
function ph() { return phases[activePhase]; }

function phaseLabel(phase) {
  return phase === 'group_a' ? 'Group A' : phase === 'group_b' ? 'Group B' : 'Knockout';
}
function phaseTabClass(phase) {
  return phase === 'group_a' ? 'active-a' : phase === 'group_b' ? 'active-b' : 'active-ko';
}
function ptsColorClass(phase) {
  return phase === 'group_a' ? 'pts-a' : phase === 'group_b' ? 'pts-b' : 'pts-ko';
}

function spent() {
  let s = 0;
  ps().selected.forEach(id => {
    const p = allPlayers.find(x => x.id === id);
    if (p) s += parseFloat(p.fantasy_price || 0);
  });
  return Math.round(s * 10) / 10;
}
function remaining() {
  const budget = parseFloat(ph()?.total_credits || 100);
  return Math.round((budget - spent()) * 10) / 10;
}
function starCount() {
  let c = 0;
  ps().selected.forEach(id => {
    const p = allPlayers.find(x => x.id === id);
    if (p?.is_star) c++;
  });
  return c;
}
function roleCount(role) {
  let c = 0;
  ps().selected.forEach(id => {
    const p = allPlayers.find(x => x.id === id);
    if (p?.role === role) c++;
  });
  return c;
}

// ─── BOOT ─────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const user = await authReady;
    
    const { data: profile } = await supabase.from('user_profiles')
      .select('user_id,full_name,team_name,is_ppl_admin')
      .eq('user_id', user.id).single();
      
    ME = {
      id: user.id,
      full_name: profile?.full_name || user.email,
      team_name: profile?.team_name || '',
      is_admin: profile?.is_ppl_admin || false
    };
    document.getElementById('user-chip').textContent = ME.team_name || ME.full_name;

    // Load data in parallel
    const [{ data: phasesData }, { data: pl }] = await Promise.all([
      supabase.from('ppl_fantasy_days').select('*').order('created_at'),
      supabase.from('ppl_players')
        .select('id,name,role,fantasy_price,is_star,fantasy_group,team_id,ppl_teams(id,name,short_name,group_name)')
        .eq('is_active', true)
    ]);

    (phasesData || []).forEach(p => { phases[p.phase] = p; });
    allPlayers = pl || [];

    await loadAllExistingTeams();

    document.getElementById('app').style.display = 'block';
    setupEventListeners();
    renderContent();
    
  } catch (err) {
    document.getElementById('auth-wall').innerHTML = `
      <div class="auth-wall">
        <h3>⚡ PPL Fantasy</h3>
        <p>Sign in to pick your fantasy teams for PPL 2026.<br>
            Pick teams for Group A, Group B & Knockout phases!</p>
        <a class="btn-auth" href="index.html">Sign In →</a>
      </div>`;
    document.getElementById('user-chip').textContent = 'Not signed in';
  }
}

async function loadAllExistingTeams() {
  const phaseIds = Object.values(phases).map(p => p.id);
  if (!phaseIds.length) return;

  const { data: teams } = await supabase.from('ppl_user_teams')
    .select('*,ppl_user_team_players(player_id,is_captain,is_vice_captain,fantasy_points)')
    .eq('user_id', ME.id)
    .in('phase_id', phaseIds);

  if (!teams) return;
  teams.forEach(team => {
    const phase = team.phase;
    if (!phase || !pickState[phase]) return;
    pickState[phase].existingTeam = team;
    pickState[phase].selected = new Set(team.ppl_user_team_players.map(p => p.player_id));
    pickState[phase].captainId = team.captain_player_id;
    pickState[phase].vcId = team.vice_captain_player_id;
  });
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('tab-group-a').onclick = (e) => switchPhase('group_a', e.currentTarget);
  document.getElementById('tab-group-b').onclick = (e) => switchPhase('group_b', e.currentTarget);
  document.getElementById('tab-knockout').onclick = (e) => switchPhase('knockout', e.currentTarget);

  document.getElementById('inner-tab-pick').onclick = (e) => switchInnerTab(e.currentTarget, 'pick');
  document.getElementById('inner-tab-myteam').onclick = (e) => switchInnerTab(e.currentTarget, 'myteam');
  document.getElementById('inner-tab-standings').onclick = (e) => switchInnerTab(e.currentTarget, 'standings');

  document.getElementById('clearBtn').onclick = clearSel;
  document.getElementById('submit-btn').onclick = submitTeam;
  
  // Expose global functions for inline HTML attributes dynamically generated
  window.setFilter = setFilter;
  window.togglePlayer = togglePlayer;
  window.setCap = setCap;
  window.setVC = setVC;
  window.switchLbTab = switchLbTab;
}

function switchPhase(phase, btn) {
  activePhase = phase;
  roleFilter = 'ALL';
  document.querySelectorAll('.phase-tab').forEach(t => {
    t.classList.remove('active-a','active-b','active-ko');
  });
  btn.classList.add(phaseTabClass(phase));
  renderContent();
}

function switchInnerTab(btn, tab) {
  activeInnerTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderContent();
}

function renderContent() {
  const phase = ph();
  const showBar = activeInnerTab === 'pick' && phase && !phase.is_locked;
  document.getElementById('sel-bar').style.display = showBar ? 'block' : 'none';

  if (activeInnerTab === 'pick')          renderPick();
  else if (activeInnerTab === 'myteam')   renderMyTeam();
  else                                    renderStandings();
}

// ─── PICK TAB ─────────────────────────────────────────────────────────────
function renderPick() {
  const el = document.getElementById('tab-content');
  const phase = ph();
  if (!phase) { el.innerHTML = '<div class="empty">Phase not configured.</div>'; return; }

  if (activePhase === 'knockout' && phase.is_locked && !ps().existingTeam) {
    el.innerHTML = `<div class="ko-locked-card" style="background: rgba(251,146,60,0.06); border: 1px solid rgba(251,146,60,0.2); border-radius: var(--card-radius); padding: 24px 16px; text-align: center; margin-top: 8px;">
      <h3 style="font-family: var(--font-display); font-size: 22px; font-weight: 900; color: var(--orange); margin-bottom: 8px;">🏆 Knockout Phase Locked</h3>
      <p style="font-size: 13px; color: var(--text-faint); line-height: 1.7;">Group stage is still in progress.<br>Once the top 2 from each group qualify,<br>you can pick your Knockout XI here.</p>
    </div>`; return;
  }

  if (phase.is_locked && !ps().existingTeam) {
    el.innerHTML = `<div class="phase-banner locked">🔒 ${phaseLabel(activePhase)} is locked. You didn't submit a team.</div>`; return;
  }
  if (phase.is_locked) {
    el.innerHTML = `<div class="phase-banner locked">🔒 Locked. See your picks in <strong>My Team</strong>.</div>`; return;
  }

  const BUDGET   = parseFloat(phase.total_credits || 100);
  const MAX_STARS = parseInt(phase.max_star_players || 4);
  const TEAM_SIZE = parseInt(phase.team_size || 11);
  const MIN_BAT  = parseInt(phase.min_batters || 3);
  const MIN_BOWL = parseInt(phase.min_bowlers || 3);
  const MIN_AR   = parseInt(phase.min_allrounders || 1);

  const rem = remaining();
  const stars = starCount();
  const remCls = rem < 0 ? 'over' : rem < 10 ? 'warn' : 'good';
  const starsCls = stars >= MAX_STARS ? 'gold' : 'white';

  const bannerClass = `open-${activePhase === 'group_a' ? 'a' : activePhase === 'group_b' ? 'b' : 'ko'}`;

  let html = `<div class="phase-banner ${bannerClass}">
    <span>🟢 ${phaseLabel(activePhase)} — Open</span>
    ${phase.lock_deadline ? `<span style="font-size:11px;opacity:0.8">Locks: ${new Date(phase.lock_deadline).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>` : ''}
  </div>`;

  html += `<div class="budget-bar" style="position: sticky; top: 63px; z-index: 90; margin: 0 -16px 12px; padding: 12px 16px; border-radius: 0; border-left: none; border-right: none; background: rgba(2,6,23,0.95); backdrop-filter: blur(15px); box-shadow: 0 4px 20px rgba(0,0,0,0.4);">
    <div class="budget-item">
      <div class="budget-val ${remCls}">${rem}</div>
      <div class="budget-lbl">Credits</div>
    </div>
    <div class="budget-div"></div>
    <div class="budget-item">
      <div class="budget-val ${roleCount('BAT') < MIN_BAT ? 'warn' : 'good'}">${roleCount('BAT')}</div>
      <div class="budget-lbl">BAT (${MIN_BAT}+)</div>
    </div>
    <div class="budget-div"></div>
    <div class="budget-item">
      <div class="budget-val ${roleCount('AR') < MIN_AR ? 'warn' : 'good'}">${roleCount('AR')}</div>
      <div class="budget-lbl">AR (${MIN_AR}+)</div>
    </div>
    <div class="budget-div"></div>
    <div class="budget-item">
      <div class="budget-val ${roleCount('BOWL') < MIN_BOWL ? 'warn' : 'good'}">${roleCount('BOWL')}</div>
      <div class="budget-lbl">BWL (${MIN_BOWL}+)</div>
    </div>
    <div class="budget-div"></div>
    <div class="budget-item">
      <div class="budget-val ${starsCls}">${stars}<span style="font-size:11px;color:var(--text-faint)">/${MAX_STARS}</span></div>
      <div class="budget-lbl">⭐ Star</div>
    </div>
  </div>`;

  if (ps().existingTeam) html += `<div class="msg msg-ok">✅ Team saved — update below if needed</div>`;

  html += `<div class="rules-box">
    💡 <strong style="color:var(--text-dim)">Rules:</strong>
    ${TEAM_SIZE} players · ${BUDGET} credits · Max ${MAX_STARS} ⭐ Stars · 
    Min ${MIN_BAT} BAT · Min ${MIN_AR} AR · Min ${MIN_BOWL} BOWL · Set C (2×) & VC (1.5×)
  </div>`;

  html += `<div class="filter-row">
    ${['ALL','BAT','AR','BOWL'].map(r =>
      `<button class="filter-btn${roleFilter===r?' active':''}" onclick="setFilter('${r}')">${r === 'ALL' ? 'All Roles' : r}</button>`
    ).join('')}
  </div>`;

  let phasePlayers = [];
  if (activePhase === 'group_a') {
    phasePlayers = allPlayers.filter(p => p.fantasy_group === 'A' || p.ppl_teams?.group_name === 'A');
  } else if (activePhase === 'group_b') {
    phasePlayers = allPlayers.filter(p => p.fantasy_group === 'B' || p.ppl_teams?.group_name === 'B');
  } else {
    phasePlayers = allPlayers;
  }

  const teamMap = {};
  phasePlayers.forEach(p => {
    if (!teamMap[p.team_id]) {
      teamMap[p.team_id] = {
        name: p.ppl_teams?.name || '?',
        players: []
      };
    }
    teamMap[p.team_id].players.push(p);
  });

  const sorted = Object.entries(teamMap).sort(([,a],[,b]) => a.name.localeCompare(b.name));
  const grpClass = activePhase === 'group_a' ? 'grp-a' : activePhase === 'group_b' ? 'grp-b' : 'grp-ko';

  sorted.forEach(([, team]) => {
    const filtered = roleFilter === 'ALL' ? team.players : team.players.filter(p => p.role === roleFilter);
    if (!filtered.length) return;
    html += `<div class="team-hdr ${grpClass}">${team.name}</div>`;
    filtered.sort((a,b) => b.fantasy_price - a.fantasy_price).forEach(p => {
      html += buildPlayerCard(p, BUDGET, MAX_STARS, TEAM_SIZE);
    });
  });

  if (!sorted.length) {
    html += `<div class="empty">No players found for this phase.<br>Admin needs to assign players to teams.</div>`;
  }

  el.innerHTML = html;
}

function buildPlayerCard(p, BUDGET, MAX_STARS, TEAM_SIZE) {
  const isSel = ps().selected.has(p.id);
  const isCap = ps().captainId === p.id;
  const isVC  = ps().vcId === p.id;
  const rem = remaining();

  const cantBudget = !isSel && rem < parseFloat(p.fantasy_price || 0);
  const cantStars  = !isSel && p.is_star && starCount() >= MAX_STARS;
  const cantSize   = !isSel && ps().selected.size >= TEAM_SIZE;
  const faded = (cantBudget || cantStars || cantSize) ? ' faded' : '';

  let cls = 'player-row';
  if (isCap) cls += ' is-captain';
  else if (isVC) cls += ' is-vc';
  else if (isSel) cls += ' selected';
  if (p.is_star) cls += ' star-player';
  cls += faded;

  const clickable = !(faded && !isSel);
  const checkTxt = isCap ? 'C' : isVC ? 'V' : isSel ? '✓' : '+';

  const cvBtns = (isSel || isCap || isVC) ? `
    <div class="cv-btns" onclick="event.stopPropagation()">
      <button class="cv-btn${isCap?' active-gold':''}" onclick="setCap('${p.id}')">C</button>
      <button class="cv-btn${isVC?' active-silver':''}" onclick="setVC('${p.id}')">VC</button>
    </div>` : '';

  return `<div class="${cls}" ${clickable ? `onclick="togglePlayer('${p.id}')"` : ''} id="pr-${p.id}">
    <div class="p-check">${checkTxt}</div>
    <div class="p-info">
      <div class="p-name">${p.name}
        ${isCap ? '<span class="cap-badge">C</span>' : isVC ? '<span class="vc-badge">VC</span>' : ''}
        ${p.is_star ? '<span class="star-icon">⭐</span>' : ''}
        <span class="role-badge role-${p.role}">${p.role}</span>
      </div>
      <div class="p-meta">${p.ppl_teams?.short_name || ''}</div>
    </div>
    <div class="p-right">
      <div class="p-price${p.is_star?' is-star':''}">${p.fantasy_price}</div>
      ${cvBtns}
    </div>
  </div>`;
}

function setFilter(r) { roleFilter = r; renderPick(); }

function togglePlayer(id) {
  const phase = ph();
  const TEAM_SIZE = parseInt(phase?.team_size || 11);
  const MAX_STARS = parseInt(phase?.max_star_players || 4);

  const p = allPlayers.find(x => x.id === id);
  if (!p) return;

  if (ps().selected.has(id)) {
    ps().selected.delete(id);
    if (ps().captainId === id) ps().captainId = null;
    if (ps().vcId === id) ps().vcId = null;
  } else {
    if (ps().selected.size >= TEAM_SIZE) { showMsg(`Max ${TEAM_SIZE} players`,'err'); return; }
    if (remaining() < parseFloat(p.fantasy_price || 0)) { showMsg(`Not enough credits`,'err'); return; }
    if (p.is_star && starCount() >= MAX_STARS) { showMsg(`Max ${MAX_STARS} ⭐ stars allowed`,'err'); return; }
    ps().selected.add(id);
  }
  renderPick();
}

function setCap(id) {
  if (ps().vcId === id) ps().vcId = null;
  ps().captainId = id;
  if (!ps().selected.has(id)) ps().selected.add(id);
  renderPick();
}
function setVC(id) {
  if (ps().captainId === id) ps().captainId = null;
  ps().vcId = id;
  if (!ps().selected.has(id)) ps().selected.add(id);
  renderPick();
}
function clearSel() {
  pickState[activePhase] = { selected: new Set(), captainId: null, vcId: null, existingTeam: null };
  renderPick();
}

async function submitTeam() {
  const phase = ph();
  const TEAM_SIZE = parseInt(phase?.team_size || 11);
  const MAX_STARS = parseInt(phase?.max_star_players || 4);
  const BUDGET    = parseFloat(phase?.total_credits || 100);
  const MIN_BAT   = parseInt(phase?.min_batters || 3);
  const MIN_BOWL  = parseInt(phase?.min_bowlers || 3);
  const MIN_AR    = parseInt(phase?.min_allrounders || 1);

  const state = ps();

  if (state.selected.size !== TEAM_SIZE) { showMsg(`Pick exactly ${TEAM_SIZE} players (have ${state.selected.size})`,'err'); return; }
  if (!state.captainId) { showMsg('Set your Captain (C)','err'); return; }
  if (!state.vcId)      { showMsg('Set your Vice Captain (VC)','err'); return; }
  if (state.captainId === state.vcId) { showMsg('C and VC must be different','err'); return; }
  if (spent() > BUDGET) { showMsg(`Over budget! ${spent()}/${BUDGET}`,'err'); return; }
  if (starCount() > MAX_STARS) { showMsg(`Too many ⭐ stars`,'err'); return; }
  if (roleCount('BAT') < MIN_BAT) { showMsg(`Need at least ${MIN_BAT} Batters`,'err'); return; }
  if (roleCount('BOWL') < MIN_BOWL) { showMsg(`Need at least ${MIN_BOWL} Bowlers`,'err'); return; }
  if (roleCount('AR') < MIN_AR) { showMsg(`Need at least ${MIN_AR} All-rounder`,'err'); return; }

  const btn = document.getElementById('submit-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    let teamId;
    const teamPayload = {
      user_id: ME.id,
      phase_id: phase.id,
      phase: activePhase,
      user_name: ME.team_name || ME.full_name,
      captain_player_id: state.captainId,
      vice_captain_player_id: state.vcId,
      total_credits_used: spent(),
      total_budget_used: spent(),
      is_locked: false
    };

    if (state.existingTeam) {
      await supabase.from('ppl_user_teams').update(teamPayload).eq('id', state.existingTeam.id);
      teamId = state.existingTeam.id;
      await supabase.from('ppl_user_team_players').delete().eq('user_team_id', teamId);
    } else {
      const { data: nt, error: te } = await supabase.from('ppl_user_teams').insert(teamPayload).select().single();
      if (te) throw te;
      teamId = nt.id;
    }

    const picks = [...state.selected].map(pid => ({
      user_team_id: teamId,
      player_id: pid,
      user_id: ME.id,
      is_captain: pid === state.captainId,
      is_vice_captain: pid === state.vcId
    }));
    const { error: pe } = await supabase.from('ppl_user_team_players').insert(picks);
    if (pe) throw pe;

    showMsg(`✅ ${phaseLabel(activePhase)} team saved!`, 'ok');
    await loadAllExistingTeams();
    renderContent();
  } catch(e) {
    showMsg('Error: ' + (e.message || JSON.stringify(e)), 'err');
  } finally {
    btn.textContent = '💾 Save Team'; btn.disabled = false;
  }
}

// ─── MY TEAM TAB ──────────────────────────────────────────────────────────
async function renderMyTeam() {
  const el = document.getElementById('tab-content');
  const state = ps();

  const { data: scores } = await supabase.from('ppl_fantasy_scores')
    .select('phase_points, phase_id, ppl_fantasy_days(phase)')
    .eq('user_id', ME.id);

  let totalPts = 0, gaPts = 0, gbPts = 0, koPts = 0;
  (scores || []).forEach(s => {
    const ph = s.ppl_fantasy_days?.phase;
    const pts = parseFloat(s.phase_points || 0);
    totalPts += pts;
    if (ph === 'group_a') gaPts = pts;
    else if (ph === 'group_b') gbPts = pts;
    else if (ph === 'knockout') koPts = pts;
  });

  let html = `<div style="background:var(--bg-card);border:1px solid var(--border-accent);border-radius:var(--card-radius);padding:16px;margin-bottom:14px">
    <div style="font-family:var(--font-display);font-size:42px;font-weight:900;color:var(--accent);line-height:1;text-align:center">${totalPts.toFixed(1)}</div>
    <div style="text-align:center;font-size:12px;color:var(--text-faint);margin-top:4px;margin-bottom:12px">Total Fantasy Points</div>
    <div style="display:flex;gap:6px">
      <div style="flex:1;text-align:center;padding:8px;border-radius:10px;background:var(--bg-page)">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:900;color:var(--accent)">${gaPts.toFixed(1)}</div>
        <div style="font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px">Group A</div>
      </div>
      <div style="flex:1;text-align:center;padding:8px;border-radius:10px;background:var(--bg-page)">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:900;color:var(--rank-color)">${gbPts.toFixed(1)}</div>
        <div style="font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px">Group B</div>
      </div>
      <div style="flex:1;text-align:center;padding:8px;border-radius:10px;background:var(--bg-page)">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:900;color:var(--orange)">${koPts.toFixed(1)}</div>
        <div style="font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px">Knockout</div>
      </div>
    </div>
  </div>`;

  if (!state.existingTeam) {
    html += `<div class="empty">No ${phaseLabel(activePhase)} team submitted yet.<br>Go to <strong>Pick XI</strong> to create one.</div>`;
    el.innerHTML = html;
    return;
  }

  const phase = ph();
  const picks = state.existingTeam.ppl_user_team_players || [];
  const phaseScore = (scores || []).find(s => s.phase_id === phase?.id);
  const phasePts = parseFloat(phaseScore?.phase_points || state.existingTeam.total_points || 0);
  const budgetUsed = picks.reduce((s, pick) => {
    const p = allPlayers.find(pl => pl.id === pick.player_id);
    return s + parseFloat(p?.fantasy_price || 0);
  }, 0);

  const ptsCls = ptsColorClass(activePhase);

  html += `<div class="my-team-hdr">
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">${phaseLabel(activePhase)} · ${ME.team_name || ME.full_name}</div>
    <div class="my-pts ${ptsCls}">${phasePts.toFixed(1)}</div>
    <div class="my-rank">${phaseScore ? `Phase Rank will update after matches` : 'Points update as matches complete'}</div>
    <div style="font-size:11px;color:var(--text-faint);margin-top:6px">Credits used: <strong style="color:var(--text-dim)">${Math.round(budgetUsed*10)/10}/${phase?.total_credits||100}</strong></div>
  </div>`;

  const sortedPicks = [...picks].sort((a,b) => {
    if (a.player_id === state.existingTeam.captain_player_id) return -1;
    if (b.player_id === state.existingTeam.captain_player_id) return 1;
    if (a.player_id === state.existingTeam.vice_captain_player_id) return -1;
    if (b.player_id === state.existingTeam.vice_captain_player_id) return 1;
    const pa = allPlayers.find(pl => pl.id === a.player_id);
    const pb = allPlayers.find(pl => pl.id === b.player_id);
    return (pb?.fantasy_price||0) - (pa?.fantasy_price||0);
  });

  html += sortedPicks.map(pick => {
    const p     = allPlayers.find(pl => pl.id === pick.player_id);
    const isCap = pick.player_id === state.existingTeam.captain_player_id;
    const isVC  = pick.player_id === state.existingTeam.vice_captain_player_id;
    const mult  = isCap ? 2 : isVC ? 1.5 : 1;
    const raw   = parseFloat(pick.fantasy_points || 0);
    const fin   = raw * mult;
    const badge = isCap ? '<span class="cap-badge">C</span>' : isVC ? '<span class="vc-badge">VC</span>' : '';
    const starB = p?.is_star ? '<span class="star-icon">⭐</span>' : '';
    return `<div class="my-player-row">
      <div class="p-info">
        <div class="p-name">${p?.name||'?'}${badge}${starB}
          <span class="role-badge role-${p?.role||'BAT'}">${p?.role||'BAT'}</span>
        </div>
        <div class="p-meta">${p?.ppl_teams?.short_name||''} · ${p?.fantasy_price||0} cr</div>
      </div>
      <div class="my-pts-cell">
        ${raw > 0 ? fin.toFixed(1) : '—'}
        ${mult > 1 ? `<div class="mult">×${mult}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  html += `<div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--card-radius);padding:14px;margin-top:16px">
    <div style="font-family:var(--font-display);font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:10px">📊 Points System</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Per Run</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+1</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>SR (Runs−Balls)</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">±</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Per Four</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+1</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Per Six</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+2</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Duck</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--red)">−5</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Catch/Stump/RO</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+8</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>MOM</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+25</span></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Per Wicket</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+30</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Maiden</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+30</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Eco ≤10</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+10</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Eco ≥15</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--red)">−5</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Eco ≥20</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--red)">−10</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>2/3/4/5+ wkts</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">+10/15/20/25</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle)"><span>Captain / VC</span><span style="font-family:var(--font-display);font-size:13px;font-weight:800;color:var(--accent)">2× / 1.5×</span></div>
      </div>
    </div>
  </div>`;

  el.innerHTML = html;
}

// ─── STANDINGS TAB ────────────────────────────────────────────────────────
async function renderStandings() {
  const el = document.getElementById('tab-content');
  const phase = ph();

  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="lb-tab${activeLbTab==='overall'?' active':''}" onclick="switchLbTab('overall',this)" style="flex:1;padding:8px;border-radius:var(--btn-radius);border:1px solid var(--border-card);background:var(--bg-card);color:var(--text-faint);font-family:var(--font-display);font-size:11px;font-weight:800;text-transform:uppercase;cursor:pointer;text-align:center;transition:var(--transition)">🏆 Overall</button>
      <button class="lb-tab${activeLbTab==='phase'?' active':''}" onclick="switchLbTab('phase',this)" style="flex:1;padding:8px;border-radius:var(--btn-radius);border:1px solid var(--border-card);background:var(--bg-card);color:var(--text-faint);font-family:var(--font-display);font-size:11px;font-weight:800;text-transform:uppercase;cursor:pointer;text-align:center;transition:var(--transition)">${phaseLabel(activePhase)}</button>
    </div>
    <div id="lb-body"><div class="loading">Loading standings…</div></div>`;

  // Fix inline styles for active tab
  document.querySelectorAll('.lb-tab.active').forEach(b => {
    b.style.background = 'rgba(245,158,11,0.1)';
    b.style.borderColor = 'rgba(245,158,11,0.3)';
    b.style.color = '#fbbf24';
  });

  loadLbBody(phase);
}

function switchLbTab(tab, btn) {
  activeLbTab = tab;
  document.querySelectorAll('.lb-tab').forEach(b => {
    b.classList.remove('active');
    b.style.background = 'var(--bg-card)';
    b.style.borderColor = 'var(--border-card)';
    b.style.color = 'var(--text-faint)';
  });
  btn.classList.add('active');
  btn.style.background = 'rgba(245,158,11,0.1)';
  btn.style.borderColor = 'rgba(245,158,11,0.3)';
  btn.style.color = '#fbbf24';
  
  loadLbBody(ph());
}

async function loadLbBody(phase) {
  const el = document.getElementById('lb-body');
  if (!el) return;

  if (activeLbTab === 'overall') {
    const { data: rows } = await supabase.from('ppl_overall_leaderboard').select('*').order('overall_rank');
    if (!rows?.length) {
      el.innerHTML = `<div class="empty">Overall leaderboard appears after matches complete.</div>`; return;
    }
    el.innerHTML = rows.map((r, i) => {
      const isMe = r.user_id === ME.id;
      const rankColor = i===0 ? '#fbbf24' : i===1 ? 'var(--text-dim)' : i===2 ? '#b45309' : 'var(--text-faint)';
      const icon = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `#${r.overall_rank}`;
      return `<div style="background:${isMe?'#051209':'var(--bg-card)'}; border:1px solid ${isMe?'rgba(154,224,0,0.35)':'var(--border-card)'}; border-radius:12px; padding:12px 14px; margin-bottom:7px; display:flex; align-items:center; gap:12px">
        <div style="font-family:var(--font-display);font-size:18px;font-weight:900;color:${rankColor};min-width:32px;text-align:center">${icon}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${r.team_name||r.full_name||'Player'}${isMe?'<span style="font-size:10px;color:var(--accent);font-weight:700;margin-left:5px">← You</span>':''}</div>
          <div style="font-size:11px;color:var(--text-faint);margin-top:2px">
            <span style="color:var(--accent)">A: ${parseFloat(r.group_a_points||0).toFixed(1)}</span> &nbsp;
            <span style="color:var(--rank-color)">B: ${parseFloat(r.group_b_points||0).toFixed(1)}</span> &nbsp;
            <span style="color:var(--orange)">KO: ${parseFloat(r.knockout_points||0).toFixed(1)}</span>
          </div>
        </div>
        <div style="font-family:var(--font-display);font-size:22px;font-weight:900;color:var(--rank-color)">${parseFloat(r.total_points||0).toFixed(1)}</div>
      </div>`;
    }).join('');

  } else {
    if (!phase) { el.innerHTML = '<div class="empty">Phase not found.</div>'; return; }
    const { data: rows } = await supabase.from('ppl_fantasy_scores')
      .select('user_id, phase_points, rank_for_phase, ppl_user_teams!inner(user_name)')
      .eq('phase_id', phase.id)
      .order('phase_points', { ascending: false });

    if (!rows?.length) {
      el.innerHTML = `<div class="empty">${phaseLabel(activePhase)} leaderboard appears after matches complete.</div>`; return;
    }
    el.innerHTML = rows.map((r, i) => {
      const isMe = r.user_id === ME.id;
      const name = r.ppl_user_teams?.user_name || 'Player';
      const rankColor = i===0 ? '#fbbf24' : i===1 ? 'var(--text-dim)' : i===2 ? '#b45309' : 'var(--text-faint)';
      const icon = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : `#${i+1}`;
      return `<div style="background:${isMe?'#051209':'var(--bg-card)'}; border:1px solid ${isMe?'rgba(154,224,0,0.35)':'var(--border-card)'}; border-radius:12px; padding:12px 14px; margin-bottom:7px; display:flex; align-items:center; gap:12px">
        <div style="font-family:var(--font-display);font-size:18px;font-weight:900;color:${rankColor};min-width:32px;text-align:center">${icon}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${name}${isMe?'<span style="font-size:10px;color:var(--accent);font-weight:700;margin-left:5px">← You</span>':''}</div>
          <div style="font-size:11px;color:var(--text-faint);margin-top:2px">${phaseLabel(activePhase)}</div>
        </div>
        <div style="font-family:var(--font-display);font-size:22px;font-weight:900;color:var(--rank-color)">${parseFloat(r.phase_points||0).toFixed(1)}</div>
      </div>`;
    }).join('');
  }
}

function showMsg(msg, type) {
  const el = document.getElementById('tab-content');
  const old = el?.querySelector('.msg'); if (old) old.remove();
  const div = document.createElement('div');
  div.className = `msg msg-${type==='err'?'err':'ok'}`;
  div.textContent = msg;
  el?.prepend(div);
  setTimeout(() => div.remove(), 4000);
}

// Start application
boot();