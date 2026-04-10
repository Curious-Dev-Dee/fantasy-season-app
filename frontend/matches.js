/* ═══════════════════════════════════════════════════════════════
   MATCHES.JS — IPL 2026 Cricket Experts
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'https://tuvqgcosbweljslbfgqc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0._doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ═══════════════════ UTILITIES ═══════════════════ */

function getLogoUrl(path) {
  if (!path) return null;
  const { data } = sb.storage.from('team-logos').getPublicUrl(path);
  return data?.publicUrl || null;
}

function fmtOvers(o) {
  if (o == null || o === 0) return '0';
  const full  = Math.floor(o);
  const balls = Math.round((o - full) * 10);
  return `${full}.${balls}`;
}

function formatMatchTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
  }) + ' IST';
}

function formatShortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function formatShortTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function formatDateGroup(iso) {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function getTrueOvers(decOvers) {
  const whole = Math.floor(decOvers);
  const balls = Math.round((decOvers - whole) * 10);
  return whole + balls / 6;
}

/* ═══════════════════ SCORE MAPPING ═══════════════════ */

/**
 * Given a match (with team_a/team_b) and a live_scores row,
 * determines which innings score belongs to which team using toss data.
 * Returns { scoreA, scoreB } each = { score, wkts, overs } | null
 */
function getTeamScores(match, ls) {
  if (!ls) return { scoreA: null, scoreB: null };

  const nameA = (match.team_a?.name || '').toLowerCase();
  const codeA = (match.team_a?.short_code || '').toLowerCase();
  const tossW = (ls.toss_winner || '').toLowerCase();
  const tossC = (ls.toss_choice || '').toLowerCase();

  let aFirst = false;

  if (tossW && tossC) {
    const aWon = tossW.includes(nameA.split(' ')[0]) || tossW === codeA;
    aFirst = aWon ? (tossC === 'bat') : (tossC === 'bowl');
  } else {
    // Fallback: check if team1_name matches team A
    const t1 = (ls.team1_name || '').toLowerCase();
    aFirst = t1.includes(nameA.split(' ')[0]) || t1 === codeA;
  }

  if (aFirst) {
    return {
      scoreA: { score: ls.team1_score, wkts: ls.team1_wickets, overs: ls.team1_overs },
      scoreB: { score: ls.team2_score, wkts: ls.team2_wickets, overs: ls.team2_overs },
    };
  } else {
    return {
      scoreA: { score: ls.team2_score, wkts: ls.team2_wickets, overs: ls.team2_overs },
      scoreB: { score: ls.team1_score, wkts: ls.team1_wickets, overs: ls.team1_overs },
    };
  }
}

/**
 * Determines which team batted in which innings (for scorecard labels).
 * Returns [inns0_teamName, inns1_teamName]
 */
function getInningsLabels(ls, teamA, teamB) {
  const ta = teamA || 'Team A';
  const tb = teamB || 'Team B';
  const status = (ls?.match_status || '').toLowerCase();
  const taKw = ta.toLowerCase().split(' ')[0];

  // If result has "run" => the team mentioned batted first
  if (status.includes('run')) {
    return status.includes(taKw) ? [ta, tb] : [tb, ta];
  }
  // If result has "wkt/wicket" => winning team chased (batted second → innings 1)
  if (status.includes('wkt') || status.includes('wicket')) {
    return status.includes(taKw) ? [tb, ta] : [ta, tb];
  }

  // Fallback via toss
  const tossW = (ls?.toss_winner || '').toLowerCase();
  const tossC = (ls?.toss_choice || '').toLowerCase();
  if (tossW && tossC) {
    const aWon = tossW.includes(taKw);
    const aBatFirst = aWon ? (tossC === 'bat') : (tossC === 'bowl');
    return aBatFirst ? [ta, tb] : [tb, ta];
  }

  // Last resort: overs
  const o1 = ls?.team1_overs || 0;
  const o2 = ls?.team2_overs || 0;
  if (o1 > 0 && o2 === 0) return [ta, tb];
  if (o2 > 0 && o1 === 0) return [tb, ta];

  return [ta, tb];
}

/* ═══════════════════ DATA FETCH ═══════════════════ */

const MATCH_SELECT = `
  id, match_number, status, points_processed, actual_start_time, venue,
  team_a:real_teams!matches_team_a_id_fkey(id, name, short_code, photo_name),
  team_b:real_teams!matches_team_b_id_fkey(id, name, short_code, photo_name),
  winner:real_teams!matches_winner_id_fkey(id, name, short_code),
  live_scores(
    team1_name, team1_score, team1_wickets, team1_overs,
    team2_name, team2_score, team2_wickets, team2_overs,
    winner, match_result, match_status,
    toss_winner, toss_choice,
    batting, bowling
  )
`;

function getLiveScores(match) {
  const ls = match.live_scores;
  return Array.isArray(ls) ? ls[0] : ls;
}

/* ═══════════════════ HTML BUILDERS ═══════════════════ */

function badgeHtml(type) {
  switch (type) {
    case 'live':      return `<span class="badge badge-live"><span class="live-dot"></span>LIVE</span>`;
    case 'result':    return `<span class="badge badge-result">RESULT</span>`;
    case 'upcoming':  return `<span class="badge badge-upcoming">UPCOMING</span>`;
    case 'abandoned': return `<span class="badge badge-abandoned">NO RESULT</span>`;
    default:          return '';
  }
}

function buildMatchCard(m, type) {
  const ls    = getLiveScores(m);
  const logoA = getLogoUrl(m.team_a?.photo_name);
  const logoB = getLogoUrl(m.team_b?.photo_name);
  const codeA = m.team_a?.short_code || '—';
  const codeB = m.team_b?.short_code || '—';
  const isLive = type === 'live';

  let scoreAHtml = '', scoreBHtml = '', resultLine = '';
  if (ls) {
    const { scoreA, scoreB } = getTeamScores(m, ls);
    if (scoreA?.score != null) {
      scoreAHtml = `<div class="team-score">${scoreA.score}/${scoreA.wkts ?? 0} <span class="overs">(${fmtOvers(scoreA.overs)})</span></div>`;
    }
    if (scoreB?.score != null) {
      scoreBHtml = `<div class="team-score">${scoreB.score}/${scoreB.wkts ?? 0} <span class="overs">(${fmtOvers(scoreB.overs)})</span></div>`;
    }
    const txt = ls.match_result || ls.match_status || '';
    if (txt) resultLine = `<div class="match-result-line">${txt}</div>`;
  }

  const metaHtml = isLive
    ? `<div class="match-meta"><div class="match-meta-row"><i class="fas fa-location-dot" style="color:var(--accent)"></i> ${m.venue || 'TBD'}</div></div>`
    : `<div class="match-meta">
        <div class="match-meta-row"><i class="fas fa-clock"></i> ${formatShortDate(m.actual_start_time)} · ${formatShortTime(m.actual_start_time)} IST</div>
        <div class="match-meta-row"><i class="fas fa-location-dot"></i> ${m.venue || 'TBD'}</div>
      </div>`;

  return `
    <div class="card match-card${isLive ? ' live-card' : ''}" onclick="openScoreboard('${m.id}')">
      <div class="match-card-top">
        <span class="match-num-label">Match ${m.match_number ?? '—'}</span>
        ${badgeHtml(type)}
      </div>
      <div class="teams-row">
        <div class="team-block left">
          ${logoA ? `<div class="team-logo" style="background-image:url('${logoA}')"></div>` : ''}
          <div class="team-code">${codeA}</div>
          ${scoreAHtml}
        </div>
        <div class="vs-block"><span class="vs-text">VS</span></div>
        <div class="team-block right">
          ${logoB ? `<div class="team-logo" style="background-image:url('${logoB}')"></div>` : ''}
          <div class="team-code">${codeB}</div>
          ${scoreBHtml}
        </div>
      </div>
      ${resultLine}
      ${metaHtml}
    </div>`;
}

/* ═══════════════════ TAB RENDERERS ═══════════════════ */

/* ── LIVE ── */
async function renderLive() {
  const el = document.getElementById('liveContent');

  const { data, error } = await sb.from('matches')
    .select(MATCH_SELECT)
    .eq('status', 'locked')
    .eq('points_processed', false)
    .order('match_number', { ascending: true });

  if (error) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-emoji">⚠️</span>Could not load live matches.</div>`;
    return;
  }

  if (!data?.length) {
    el.innerHTML = `
      <div class="empty-msg" style="padding:40px 20px 20px">
        <span class="empty-emoji">🏏</span>
        <span class="empty-title">No Live Matches</span>
        Check the Results or Upcoming tab
      </div>`;
    return;
  }

  el.innerHTML = `
    <p class="section-label">${data.length} Match${data.length > 1 ? 'es' : ''} Live Now</p>
    ${data.map(m => buildMatchCard(m, 'live')).join('')}`;
}

/* ── RESULTS ── */
async function renderResults() {
  const el = document.getElementById('resultsContent');

  const { data, error } = await sb.from('matches')
    .select(MATCH_SELECT)
    .eq('status', 'locked')
    .eq('points_processed', true)
    .order('match_number', { ascending: false });

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-emoji">🏏</span>No results yet. Check back after the first match!</div>`;
    return;
  }

  el.innerHTML = `
    <p class="section-label">${data.length} Result${data.length > 1 ? 's' : ''}</p>
    ${data.map(m => buildMatchCard(m, 'result')).join('')}`;
}

/* ── UPCOMING ── */
async function renderUpcoming() {
  const el = document.getElementById('upcomingContent');

  const { data, error } = await sb.from('matches')
    .select(MATCH_SELECT)
    .eq('status', 'upcoming')
    .order('match_number', { ascending: true })
    .limit(15);

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-emoji">📅</span>No upcoming matches scheduled yet.</div>`;
    return;
  }

  const [next, ...rest] = data;
  const logoA = getLogoUrl(next.team_a?.photo_name);
  const logoB = getLogoUrl(next.team_b?.photo_name);

  el.innerHTML = `
    <p class="section-label">Next Match</p>
    <div class="card next-match-card">
      <div class="match-card-top">
        <span class="match-num-label">Match ${next.match_number ?? '—'}</span>
        <span class="badge badge-upcoming">UPCOMING</span>
      </div>
      <div class="teams-row">
        <div class="team-block left">
          ${logoA ? `<div class="team-logo" style="background-image:url('${logoA}');width:48px;height:48px"></div>` : ''}
          <div class="team-code" style="font-size:26px">${next.team_a?.short_code || '—'}</div>
        </div>
        <div class="vs-block">
          <span class="vs-text">VS</span>
          <div class="countdown-chip" id="countdownEl">—</div>
        </div>
        <div class="team-block right">
          ${logoB ? `<div class="team-logo" style="background-image:url('${logoB}');width:48px;height:48px"></div>` : ''}
          <div class="team-code" style="font-size:26px">${next.team_b?.short_code || '—'}</div>
        </div>
      </div>
      <div class="match-meta" style="margin-top:10px">
        <div class="match-meta-row accent-row"><i class="fas fa-clock"></i> ${formatMatchTime(next.actual_start_time)}</div>
        <div class="match-meta-row" style="margin-top:2px"><i class="fas fa-location-dot"></i> ${next.venue || 'TBD'}</div>
      </div>
    </div>
    ${rest.length ? `<p class="section-label">Coming Up</p>${rest.map(m => buildMatchCard(m, 'upcoming')).join('')}` : ''}`;

  if (next.actual_start_time) {
    const cdEl = document.getElementById('countdownEl');
    const tick = () => {
      if (!cdEl) return;
      const dist = new Date(next.actual_start_time).getTime() - Date.now();
      if (dist <= 0) { cdEl.textContent = 'Starting soon'; return; }
      const d  = Math.floor(dist / 86400000);
      const h  = Math.floor((dist % 86400000) / 3600000);
      const mn = Math.floor((dist % 3600000) / 60000);
      const s  = Math.floor((dist % 60000) / 1000);
      cdEl.textContent = d > 0 ? `${d}d ${h}h ${mn}m` : `${h}h ${mn}m ${s}s`;
    };
    tick();
    setInterval(tick, 1000);
  }
}

/* ── FIXTURES ── */
async function renderFixtures() {
  const el = document.getElementById('fixturesContent');

  const { data, error } = await sb.from('matches')
    .select(MATCH_SELECT)
    .order('match_number', { ascending: true });

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-emoji">📋</span>Fixtures not loaded yet.</div>`;
    return;
  }

  const groups = {};
  data.forEach(m => {
    const key = formatDateGroup(m.actual_start_time) || 'TBD';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  let html = '';
  for (const [month, ms] of Object.entries(groups)) {
    html += `<p class="month-label">${month}</p>`;
    ms.forEach(m => {
      const isLive   = m.status === 'locked' && !m.points_processed;
      const isResult = m.status === 'locked' &&  m.points_processed;
      const type = isLive ? 'live' : isResult ? 'result' : m.status === 'abandoned' ? 'abandoned' : 'upcoming';
      html += buildMatchCard(m, type);
    });
  }
  el.innerHTML = html;
}

/* ── POINTS TABLE ── */
async function renderPointsTable() {
  const el = document.getElementById('pointsContent');

  const { data: rows, error } = await sb.from('ipl_points_table')
    .select('*')
    .order('position', { ascending: true });

  if (error || !rows?.length) {
    el.innerHTML = `
      <div class="pt-wrap">
        <div class="pt-qualifier-bar"><div class="pt-qualifier-dot"></div>Top 4 qualify for playoffs</div>
        <div class="empty-msg" style="padding:40px 20px">
          <span style="font-size:36px;display:block;margin-bottom:12px">🏆</span>
          <span class="empty-title">Points Table Coming</span>
          Updates automatically as match results come in.
        </div>
      </div>`;
    return;
  }

  const tbody = rows.map((row, i) => {
    const nrr     = parseFloat(row.nrr ?? row.net_run_rate ?? 0) || 0;
    const sign    = nrr >= 0 ? '+' : '';
    const nrrCls  = nrr >= 0 ? 'pt-nrr-pos' : 'pt-nrr-neg';
    const logoUrl = getLogoUrl(row.team_logo);
    const qualCls = i < 4 ? 'qualifier' : '';

    return `<tr class="${qualCls}">
      <td><span class="pt-rank">${row.position || i + 1}</span></td>
      <td>
        <div class="pt-team-cell">
          ${logoUrl ? `<div class="pt-logo" style="background-image:url('${logoUrl}')"></div>` : ''}
          <span class="pt-team-name">${row.team_code || row.team_name}</span>
        </div>
      </td>
      <td>${row.played || 0}</td>
      <td>${row.won || 0}</td>
      <td>${row.lost || 0}</td>
      <td>${row.no_result || 0}</td>
      <td class="${nrrCls}">${sign}${nrr.toFixed(3)}</td>
      <td class="pt-pts">${row.points || 0}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="pt-wrap">
      <div class="pt-qualifier-bar"><div class="pt-qualifier-dot"></div>Top 4 qualify for playoffs</div>
      <table class="pt-table">
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align:left">Team</th>
            <th>P</th><th>W</th><th>L</th><th>NR</th><th>NRR</th><th>PTS</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

/* ── STATS ── */
async function renderStats() {
  const el = document.getElementById('statsContent');

  const { data: stats, error } = await sb.from('ipl_player_stats').select('*').limit(100);

  if (error || !stats?.length) {
    el.innerHTML = [
      statPlaceholder('icon-orange', 'fa-baseball-bat-ball', 'Most Runs'),
      statPlaceholder('icon-green',  'fa-circle-dot',        'Most Wickets'),
      statPlaceholder('icon-blue',   'fa-hands-catching',    'Most Fielding'),
      statPlaceholder('icon-gold',   'fa-star',              'Player of Match'),
    ].join('');
    return;
  }

  const sort  = (key) => [...stats].sort((a,b) => (b[key]||0) - (a[key]||0)).slice(0,5);
  const sortFn = (fn) => [...stats].sort((a,b) => fn(b) - fn(a)).slice(0,5);

  el.innerHTML = [
    buildStatsSection('icon-orange', 'fa-baseball-bat-ball', 'Most Runs',
      sort('runs'), r => r.runs, r => `${r.innings||0} inns · SR ${r.strike_rate||'—'}`),
    buildStatsSection('icon-green', 'fa-circle-dot', 'Most Wickets',
      sort('wickets'), r => r.wickets, r => `Eco ${r.economy||'—'}`),
    buildStatsSection('icon-blue', 'fa-hands-catching', 'Most Fielding',
      sortFn(r => (r.catches||0)+(r.runouts||0)),
      r => (r.catches||0)+(r.runouts||0),
      r => `${r.catches||0} catches · ${r.runouts||0} run outs`),
    buildStatsSection('icon-gold', 'fa-star', 'Player of Match',
      sort('mom_count'), r => r.mom_count, r => r.team_code||''),
  ].join('');
}

function buildStatsSection(iconCls, icon, title, rows, valFn, subFn) {
  const items = rows.map((r, i) => {
    const posCls = i === 0 ? 'pos-gold' : i === 1 ? 'pos-silver' : i === 2 ? 'pos-bronze' : '';
    return `
      <div class="stats-row">
        <div class="stats-row-left">
          <span class="stats-pos ${posCls}">${i + 1}</span>
          <div>
            <div class="stats-player-name">${r.player_name || '—'}</div>
            <div class="stats-player-sub">${subFn(r)}</div>
          </div>
        </div>
        <div class="stats-value">${valFn(r) ?? '—'}</div>
      </div>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:10px">
      <div class="stats-card-header">
        <div class="stats-icon ${iconCls}"><i class="fas ${icon}"></i></div>
        <span class="stats-card-title">${title}</span>
      </div>
      ${items || '<div class="empty-msg" style="padding:20px">No data yet</div>'}
    </div>`;
}

function statPlaceholder(iconCls, icon, title) {
  const rows = [1,2,3,4,5].map(i => `
    <div class="stats-row">
      <div class="stats-row-left">
        <span class="stats-pos" style="color:var(--text-ghost)">${i}</span>
        <div>
          <div class="shimmer" style="height:14px;width:${90+i*12}px;margin-bottom:4px"></div>
          <div class="shimmer" style="height:10px;width:70px"></div>
        </div>
      </div>
      <div class="shimmer" style="height:24px;width:36px"></div>
    </div>`).join('');

  return `
    <div class="card" style="margin-bottom:10px">
      <div class="stats-card-header">
        <div class="stats-icon ${iconCls}"><i class="fas ${icon}"></i></div>
        <span class="stats-card-title">${title}</span>
        <span class="coming-soon" style="margin-left:auto"><i class="fas fa-clock"></i> Soon</span>
      </div>
      ${rows}
    </div>`;
}

/* ═══════════════════ MODAL — SCORECARD ═══════════════════ */

const modal    = document.getElementById('scoreModal');
const sheet    = document.getElementById('scoreModalSheet');
const closeBtn = document.getElementById('modalClose');
let currentMatch    = null;
let currentInnings  = 0;

closeBtn.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

let touchStartY = 0;
sheet.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchmove',  e => {
  if (e.touches[0].clientY - touchStartY > 80) closeModal();
}, { passive: true });

function closeModal() {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

window.switchInnings = function(idx) {
  currentInnings = idx;
  document.querySelectorAll('.inn-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  renderScorecard(currentMatch, idx);
};

window.openScoreboard = async function(matchId) {
  if (!matchId || matchId === 'undefined') return;

  // Open modal immediately with loading state
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  currentInnings = 0;

  document.getElementById('modalMatchLabel').textContent = 'Loading...';
  document.getElementById('scoreHero').innerHTML = `<div class="loading-state" style="padding:24px 20px"><div class="spinner spinner-sm"></div></div>`;
  document.getElementById('inningsTabs').innerHTML = '';
  document.getElementById('modalBody').innerHTML  = `<div class="loading-state"><div class="spinner"></div><div class="loading-text">Loading Scorecard...</div></div>`;

  const { data: match, error } = await sb.from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .single();

  if (error || !match) {
    document.getElementById('scoreHero').innerHTML = `<div class="empty-msg" style="padding:24px">Could not load match data.</div>`;
    return;
  }

  currentMatch = match;
  document.getElementById('modalMatchLabel').textContent = `Match ${match.match_number ?? '—'}`;

  renderScoreHero(match);

  // Build innings tabs
  // Build innings tabs
  const ls = getLiveScores(match);
  if (ls?.batting) {
    let batting = ls.batting;
    if (typeof batting === 'string') { try { batting = JSON.parse(batting); } catch(e) { batting = []; } }
    if (Array.isArray(batting) && batting.length > 0) {
      document.getElementById('inningsTabs').innerHTML = `
        <button class="inn-tab active" onclick="switchInnings(0)">1st Innings</button>
        <button class="inn-tab" onclick="switchInnings(1)">2nd Innings</button>`;
    }
  }

  renderScorecard(match, 0);
};

function renderScoreHero(match) {
  const ls    = getLiveScores(match);
  const logoA = getLogoUrl(match.team_a?.photo_name);
  const logoB = getLogoUrl(match.team_b?.photo_name);
  const codeA = match.team_a?.short_code || '—';
  const codeB = match.team_b?.short_code || '—';
  const isLive = match.status === 'locked' && !match.points_processed;

  let scoreAHtml = '', scoreBHtml = '';
  if (ls) {
    const { scoreA, scoreB } = getTeamScores(match, ls);
    if (scoreA?.score != null) scoreAHtml = `<div class="hero-score">${scoreA.score}/${scoreA.wkts ?? 0} <span class="overs">(${fmtOvers(scoreA.overs)})</span></div>`;
    if (scoreB?.score != null) scoreBHtml = `<div class="hero-score">${scoreB.score}/${scoreB.wkts ?? 0} <span class="overs">(${fmtOvers(scoreB.overs)})</span></div>`;
  }

  const winnerName = match.winner?.name || match.winner?.short_code || '';
  const resultTxt  = ls?.match_result || ls?.match_status ||
    (winnerName ? `${winnerName} won` : (match.status === 'abandoned' ? 'Match Abandoned' : ''));

  document.getElementById('scoreHero').className = `score-hero${isLive ? ' live-hero' : ''}`;
  document.getElementById('scoreHero').innerHTML = `
    <div class="score-hero-teams">
      <div class="hero-team left">
        ${logoA ? `<div class="hero-logo" style="background-image:url('${logoA}')"></div>` : ''}
        <div class="hero-code">${codeA}</div>
        ${scoreAHtml}
      </div>
      <div class="hero-vs">VS</div>
      <div class="hero-team right">
        ${logoB ? `<div class="hero-logo" style="background-image:url('${logoB}')"></div>` : ''}
        <div class="hero-code">${codeB}</div>
        ${scoreBHtml}
      </div>
    </div>
    ${resultTxt ? `<div class="result-banner">${resultTxt}</div>` : ''}
    <div class="hero-venue">
      <i class="fas fa-location-dot"></i> ${match.venue || 'TBD'}
    </div>`;
}

function renderScorecard(match, innIdx) {
  const bodyEl = document.getElementById('modalBody');
  const ls = getLiveScores(match);

  if (!ls?.batting) {
    bodyEl.innerHTML = `
      <div class="empty-msg" style="padding:48px 20px">
        <span class="empty-emoji">📋</span>
        Scorecard not available yet.<br>
        <span style="font-size:11px">Appears once the match is underway.</span>
      </div>`;
    return;
  }

  let batting = ls.batting;
  let bowling = ls.bowling;
  if (typeof batting === 'string') { try { batting = JSON.parse(batting); } catch(e) { batting = []; } }
  if (typeof bowling === 'string') { try { bowling = JSON.parse(bowling); } catch(e) { bowling = []; } }

  if (!Array.isArray(batting) || !batting[innIdx]) {
    bodyEl.innerHTML = `
      <div class="empty-msg" style="padding:48px 20px">
        <span class="empty-emoji">⏳</span>
        <span class="empty-title">This innings hasn't started yet.</span>
      </div>`;
    return;
  }

  const [lab0, lab1] = getInningsLabels(ls, match.team_a?.name || match.team_a?.short_code, match.team_b?.name || match.team_b?.short_code);
  const batTeam = innIdx === 0 ? lab0 : lab1;
  const bowlTeam = innIdx === 0 ? lab1 : lab0;

  const batters = batting[innIdx] || [];
  const bowlers = (bowling && bowling[innIdx]) || [];

  if (batters.length === 0 && bowlers.length === 0) {
    bodyEl.innerHTML = `
      <div class="empty-msg" style="padding:60px 20px">
        <span class="empty-emoji">⏳</span>
        <span class="empty-title">Waiting for first ball</span>
        The scorecard will appear once play begins.
      </div>`;
    return;
  }

  const battingRows = batters
    .filter(b => b?.batsman)
    .map(b => {
      const sr = b.b > 0 ? ((b.r / b.b) * 100).toFixed(1) : '—';
      const srCls = b.b === 0 ? '' : parseFloat(sr) >= 150 ? 'sr-good' : parseFloat(sr) >= 100 ? 'sr-ok' : 'sr-slow';
      const dismissal = b['dismissal-text'] || (b.r !== undefined ? 'not out' : '—');
      return `<tr>
        <td>
          <span class="sc-name">${b.batsman?.name || '—'}</span>
          <span class="sc-dismissal">${dismissal}</span>
        </td>
        <td class="${b.r >= 50 ? 'hl' : ''}">${b.r ?? '—'}</td>
        <td>${b.b ?? '—'}</td>
        <td>${b['4s'] ?? '—'}</td>
        <td>${b['6s'] ?? '—'}</td>
        <td class="${srCls}">${sr}</td>
      </tr>`;
    }).join('');

  const bowlingRows = bowlers
    .filter(b => b?.bowler)
    .map(b => {
      const trueOvers = getTrueOvers(b.o || 0);
      const eco = (trueOvers > 0 && b.r != null) ? (b.r / trueOvers).toFixed(2) : null;
      const ecoCls = eco === null ? '' : parseFloat(eco) < 7 ? 'eco-good' : parseFloat(eco) < 9 ? 'eco-ok' : 'eco-exp';
      return `<tr>
        <td><span class="sc-name">${b.bowler?.name || '—'}</span></td>
        <td>${b.o ?? '—'}</td>
        <td>${b.m ?? '—'}</td>
        <td>${b.r ?? '—'}</td>
        <td class="${b.w >= 3 ? 'hl' : ''}">${b.w ?? '—'}</td>
        <td class="${ecoCls}">${eco ?? '—'}</td>
      </tr>`;
    }).join('');

  bodyEl.innerHTML = `
    <div class="sc-section">
      <div class="sc-section-title">${batTeam} — Batting</div>
      <div class="sc-wrap">
        <table class="sc-table">
          <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
          <tbody>${battingRows || noDataRow(6)}</tbody>
        </table>
      </div>
    </div>
    <div class="sc-section">
      <div class="sc-section-title">${bowlTeam} — Bowling</div>
      <div class="sc-wrap">
        <table class="sc-table">
          <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Eco</th></tr></thead>
          <tbody>${bowlingRows || noDataRow(6)}</tbody>
        </table>
      </div>
    </div>`;
}

function noDataRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:16px;color:var(--text-faint)">No data yet</td></tr>`;
}

/* ═══════════════════ TABS ═══════════════════ */

const tabs        = document.querySelectorAll('.tab-btn');
const panels      = document.querySelectorAll('.tab-panel');
const loaded      = new Set();
let   liveChannel = null;

function loadTab(id) {
  if (loaded.has(id)) return;
  loaded.add(id);
  if (id === 'live')     renderLive();
  if (id === 'results')  renderResults();
  if (id === 'upcoming') renderUpcoming();
  if (id === 'fixtures') renderFixtures();
  if (id === 'points')   renderPointsTable();
  if (id === 'stats')    renderStats();
}

function activateTab(id) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  panels.forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));

  loadTab(id);

  if (id === 'live') {
    subscribeToLiveScores();
  } else {
    if (liveChannel) {
      sb.removeChannel(liveChannel);
      liveChannel = null;
    }
  }
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

function subscribeToLiveScores() {
  if (liveChannel) sb.removeChannel(liveChannel);
  liveChannel = sb.channel('live-score-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_scores' }, () => {
      loaded.delete('live');
      renderLive();
      // Also refresh open modal if it's showing this match
      if (currentMatch && modal.classList.contains('open')) {
        openScoreboard(currentMatch.id);
      }
    })
    .subscribe();
}

// Boot
activateTab('live');

window.addEventListener('beforeunload', () => {
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
});

/* ═══════════════════ TOAST ═══════════════════ */
window.showToast = function(msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  }, 3000);
};