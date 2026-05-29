import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ─── FANTASY POINT RULES ─────────────────────────────────────────────────────
// Batting
const BATTING = {
  run: 1,
  four_bonus: 1,
  six_bonus: 2,
  half_century: 8,    // 50+ runs bonus
  century: 16,        // 100+ runs bonus
  duck_penalty: -2,   // dismissed for 0 (batters only, not bowler run-out)
  sr_tiers: [         // Strike Rate bonus/penalty (min 10 balls)
    { min: 170, pts: 6 },
    { min: 150, pts: 4 },
    { min: 130, pts: 2 },
    { min: 60,  pts: 0 },
    { min: 50,  pts: -2 },
    { min: 0,   pts: -4 },
  ],
};
// Bowling
const BOWLING = {
  wicket: 25,
  maiden: 8,
  three_wicket: 4,    // 3-wicket haul bonus
  five_wicket: 8,     // 5-wicket haul bonus
  er_tiers: [         // Economy Rate bonus/penalty (min 2 overs)
    { max: 5,   pts: 6 },
    { max: 6,   pts: 4 },
    { max: 7,   pts: 2 },
    { max: 9,   pts: 0 },
    { max: 10,  pts: -2 },
    { max: 999, pts: -4 },
  ],
};
// Fielding
const FIELDING = {
  catch: 8,
  stumping: 12,
  run_out_direct: 12,
  run_out_assisted: 6,
  three_catch_bonus: 4,
};
// Bonus
const BONUS = {
  mom: 10,
};

function getBattingSRPts(runs: number, balls: number): number {
  if (balls < 10) return 0;
  const sr = (runs / balls) * 100;
  for (const tier of BATTING.sr_tiers) {
    if (sr >= tier.min) return tier.pts;
  }
  return BATTING.sr_tiers[BATTING.sr_tiers.length - 1].pts;
}

function getBowlingERPts(runs: number, balls: number): number {
  if (balls < 12) return 0; // min 2 overs
  const er = (runs / balls) * 6;
  for (const tier of BOWLING.er_tiers) {
    if (er <= tier.max) return tier.pts;
  }
  return BOWLING.er_tiers[BOWLING.er_tiers.length - 1].pts;
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  try {
    const { match_id, recalc_all } = await req.json();
    
    // Safety check for the "Recalculate All" button so it doesn't throw a 400 error
    if (recalc_all) {
      return json({ success: true, message: "Recalc all recognized (logic to be added later)" }, 200);
    }

    if (!match_id) return json({ error: 'match_id required' }, 400);

    // ── 1. Load match ────────────────────────────────────────────────────────
    const { data: match, error: mErr } = await sb
      .from('ppl_matches')
      .select('id, status, mom_player_id, is_super_over, phase_id')
      .eq('id', match_id)
      .single();
    if (mErr || !match) return json({ error: 'Match not found' }, 404);

    // ── 2. Load innings for this match ───────────────────────────────────────
    const { data: innings } = await sb
      .from('ppl_innings')
      .select('id, batting_team_id, bowling_team_id')
      .eq('match_id', match_id);

    if (!innings?.length) return json({ error: 'No innings found' }, 404);

    // ── 3. Load all deliveries for this match ────────────────────────────────
    const { data: deliveries } = await sb
      .from('ppl_deliveries')
      .select('*')
      .eq('match_id', match_id)
      .order('over_number').order('ball_number');

    if (!deliveries?.length) return json({ error: 'No deliveries found' }, 404);

    // ── 4. Compute batting scorecards ─────────────────────────────────────────
    const battingMap: Record<string, {
      innings_id: string; match_id: string; runs: number; balls_faced: number;
      fours: number; sixes: number; is_out: boolean; dismissal_type: string | null;
      bowler_id: string | null; fielder_id: string | null; asst_fielder_id: string | null;
      batting_position: number;
    }> = {};
    let battingOrder: string[] = [];

    for (const d of deliveries) {
      if (!d.batter_id) continue;
      if (!battingMap[d.batter_id]) {
        battingOrder.push(d.batter_id);
        battingMap[d.batter_id] = {
          innings_id: d.innings_id,
          match_id: match_id,
          runs: 0, balls_faced: 0,
          fours: 0, sixes: 0,
          is_out: false, dismissal_type: null,
          bowler_id: null, fielder_id: null, asst_fielder_id: null,
          batting_position: battingOrder.length,
        };
      }
      const b = battingMap[d.batter_id];
      const runs_off_bat = d.bat_runs ?? d.runs_off_bat ?? 0;
      if (!d.extra_type || d.extra_type === 'noball') {
        b.runs += runs_off_bat;
      }
      if (d.is_legal_delivery && !d.extra_type) {
        b.balls_faced++;
      } else if (d.extra_type === 'noball') {
        b.balls_faced++;
      }
      if (d.is_four) b.fours++;
      if (d.is_six) b.sixes++;
      if (d.is_wicket && d.dismissed_player_id === d.batter_id) {
        b.is_out = true;
        b.dismissal_type = d.dismissal_type;
        b.bowler_id = d.bowler_id;
        b.fielder_id = d.fielder_id;
        b.asst_fielder_id = d.asst_fielder_id;
      }
    }

    for (const d of deliveries) {
      if (d.is_wicket && d.dismissed_player_id && d.dismissed_player_id !== d.batter_id) {
        if (!battingMap[d.dismissed_player_id]) {
          battingMap[d.dismissed_player_id] = {
            innings_id: d.innings_id, match_id: match_id,
            runs: 0, balls_faced: 0, fours: 0, sixes: 0,
            is_out: true, dismissal_type: d.dismissal_type,
            bowler_id: null, fielder_id: d.fielder_id, asst_fielder_id: d.asst_fielder_id,
            batting_position: battingOrder.length + 1,
          };
        } else {
          const b = battingMap[d.dismissed_player_id];
          b.is_out = true;
          b.dismissal_type = d.dismissal_type;
          b.fielder_id = d.fielder_id;
          b.asst_fielder_id = d.asst_fielder_id;
        }
      }
    }

    // ── 5. Compute bowling scorecards ─────────────────────────────────────────
    const bowlingMap: Record<string, {
      innings_id: string; match_id: string;
      balls_bowled: number; runs_conceded: number; wickets: number;
      wides: number; no_balls: number; maidens: number;
    }> = {};

    for (const d of deliveries) {
      if (!d.bowler_id) continue;
      if (!bowlingMap[d.bowler_id]) {
        bowlingMap[d.bowler_id] = {
          innings_id: d.innings_id, match_id: match_id,
          balls_bowled: 0, runs_conceded: 0, wickets: 0,
          wides: 0, no_balls: 0, maidens: 0,
        };
      }
      const bw = bowlingMap[d.bowler_id];
      const wide_r = d.wide_runs ?? 0;
      const nb_r = d.noball_runs ?? 0;
      const bat_r = d.bat_runs ?? d.runs_off_bat ?? 0;
      bw.runs_conceded += bat_r + wide_r + nb_r;
      if (d.is_legal_delivery) bw.balls_bowled++;
      if (d.extra_type === 'wide') bw.wides++;
      if (d.extra_type === 'noball') bw.no_balls++;
      if (d.is_wicket && !['runout'].includes(d.dismissal_type ?? '')) {
        bw.wickets++;
      }
    }

    type OverKey = string;
    const overBowler: Record<OverKey, { bowler: string; runs: number; legal: number; hasExtra: boolean }> = {};
    for (const d of deliveries) {
      if (!d.bowler_id || !d.innings_id) continue;
      const key = `${d.innings_id}:${d.over_number}`;
      if (!overBowler[key]) overBowler[key] = { bowler: d.bowler_id, runs: 0, legal: 0, hasExtra: false };
      const o = overBowler[key];
      if (d.is_legal_delivery) o.legal++;
      o.runs += (d.bat_runs ?? d.runs_off_bat ?? 0) + (d.wide_runs ?? 0) + (d.noball_runs ?? 0);
      if (d.extra_type) o.hasExtra = true;
    }
    
    const ballsPerOver = 6;
    for (const [, o] of Object.entries(overBowler)) {
      if (o.legal >= ballsPerOver && o.runs === 0 && !o.hasExtra) {
        if (bowlingMap[o.bowler]) bowlingMap[o.bowler].maidens++;
      }
    }

    for (const pid of Object.keys(bowlingMap)) {
      const bw = bowlingMap[pid];
      const fullOvers = Math.floor(bw.balls_bowled / 6);
      const rem = bw.balls_bowled % 6;
      (bw as any).overs_bowled = parseFloat(`${fullOvers}.${rem}`);
      (bw as any).economy = bw.balls_bowled > 0
        ? parseFloat(((bw.runs_conceded / bw.balls_bowled) * 6).toFixed(2))
        : 0;
    }

    // ── 6. Compute fielding stats ─────────────────────────────────────────────
    const fieldingMap: Record<string, {
      match_id: string; catches: number; run_outs_direct: number;
      run_outs_assisted: number; stumpings: number;
    }> = {};

    const ensureF = (pid: string) => {
      if (!fieldingMap[pid]) fieldingMap[pid] = {
        match_id: match_id, catches: 0, run_outs_direct: 0,
        run_outs_assisted: 0, stumpings: 0,
      };
    };

    for (const d of deliveries) {
      if (!d.is_wicket) continue;
      const dt = d.dismissal_type ?? '';
      if (dt === 'caught' && d.fielder_id) {
        ensureF(d.fielder_id);
        fieldingMap[d.fielder_id].catches++;
      } else if (dt === 'stumped' && d.fielder_id) {
        ensureF(d.fielder_id);
        fieldingMap[d.fielder_id].stumpings++;
      } else if (dt === 'runout') {
        if (d.fielder_id) {
          ensureF(d.fielder_id);
          if (!d.asst_fielder_id) {
            fieldingMap[d.fielder_id].run_outs_direct++;
          } else {
            fieldingMap[d.fielder_id].run_outs_assisted++;
          }
        }
        if (d.asst_fielder_id) {
          ensureF(d.asst_fielder_id);
          fieldingMap[d.asst_fielder_id].run_outs_assisted++;
        }
      }
    }

    // ── 7. Upsert scorecards into DB ─────────────────────────────────────────
    await sb.from('ppl_batting_scorecard').delete().eq('match_id', match_id);
    await sb.from('ppl_bowling_scorecard').delete().eq('match_id', match_id);
    await sb.from('ppl_fielding_stats').delete().eq('match_id', match_id);

    if (Object.keys(battingMap).length) {
      const rows = Object.entries(battingMap).map(([pid, b]) => ({ player_id: pid, ...b }));
      await sb.from('ppl_batting_scorecard').insert(rows);
    }
    if (Object.keys(bowlingMap).length) {
      const rows = Object.entries(bowlingMap).map(([pid, bw]) => ({ player_id: pid, ...bw }));
      await sb.from('ppl_bowling_scorecard').insert(rows);
    }
    if (Object.keys(fieldingMap).length) {
      const rows = Object.entries(fieldingMap).map(([pid, f]) => ({ player_id: pid, ...f }));
      await sb.from('ppl_fielding_stats').insert(rows);
    }

    // ── 8. Compute fantasy points per player ─────────────────────────────────
    const fantasyMap: Record<string, {
      batting_points: number; bowling_points: number;
      fielding_points: number; bonus_points: number; total_points: number;
    }> = {};

    const allPlayerIds = new Set([
      ...Object.keys(battingMap),
      ...Object.keys(bowlingMap),
      ...Object.keys(fieldingMap),
    ]);
    if (match.mom_player_id) allPlayerIds.add(match.mom_player_id);

    for (const pid of allPlayerIds) {
      let bat = 0, bowl = 0, field = 0, bonus = 0;

      const bsc = battingMap[pid];
      if (bsc) {
        bat += bsc.runs * BATTING.run;
        bat += bsc.fours * BATTING.four_bonus;
        bat += bsc.sixes * BATTING.six_bonus;
        if (bsc.runs >= 100) bat += BATTING.century;
        else if (bsc.runs >= 50) bat += BATTING.half_century;
        if (bsc.is_out && bsc.runs === 0) bat += BATTING.duck_penalty;
        bat += getBattingSRPts(bsc.runs, bsc.balls_faced);
      }

      const blsc = bowlingMap[pid] as any;
      if (blsc) {
        bowl += blsc.wickets * BOWLING.wicket;
        bowl += blsc.maidens * BOWLING.maiden;
        if (blsc.wickets >= 5) bowl += BOWLING.five_wicket;
        else if (blsc.wickets >= 3) bowl += BOWLING.three_wicket;
        bowl += getBowlingERPts(blsc.runs_conceded, blsc.balls_bowled);
      }

      const fsc = fieldingMap[pid];
      if (fsc) {
        field += fsc.catches * FIELDING.catch;
        field += fsc.stumpings * FIELDING.stumping;
        field += fsc.run_outs_direct * FIELDING.run_out_direct;
        field += fsc.run_outs_assisted * FIELDING.run_out_assisted;
        if (fsc.catches >= 3) field += FIELDING.three_catch_bonus;
      }

      if (match.mom_player_id === pid) bonus += BONUS.mom;

      fantasyMap[pid] = {
        batting_points: bat,
        bowling_points: bowl,
        fielding_points: field,
        bonus_points: bonus,
        total_points: bat + bowl + field + bonus,
      };
    }

    // ── 9. Upsert ppl_player_match_points ────────────────────────────────────
    await sb.from('ppl_player_match_points').delete().eq('match_id', match_id);

    const pmpRows = Object.entries(fantasyMap).map(([pid, pts]) => ({
      match_id: match_id,
      player_id: pid,
      category: match.is_super_over ? 'super_over' : 'regular',
      phase: match.phase_id ?? null,
      batting_points: pts.batting_points,
      bowling_points: pts.bowling_points,
      fielding_points: pts.fielding_points,
      bonus_points: pts.bonus_points,
      total_points: pts.total_points,
      points: pts.total_points,
      updated_at: new Date().toISOString(),
    }));

    if (pmpRows.length) {
      await sb.from('ppl_player_match_points').insert(pmpRows);
    }

    // ── 10. Update ppl_user_team_players fantasy_points ──────────────────────
    if (match.phase_id) {
      const { data: userTeams } = await sb
        .from('ppl_user_teams')
        .select('id, captain_player_id, vice_captain_player_id')
        .eq('phase_id', match.phase_id);

      if (userTeams?.length) {
        const teamIds = userTeams.map((t: any) => t.id);

        const { data: teamPlayers } = await sb
          .from('ppl_user_team_players')
          .select('id, user_team_id, player_id, is_captain, is_vice_captain')
          .in('user_team_id', teamIds);

        if (teamPlayers?.length) {
          const { data: allPhaseMatches } = await sb
            .from('ppl_matches')
            .select('id')
            .eq('phase_id', match.phase_id)
            .eq('status', 'completed');

          const phaseMatchIds = allPhaseMatches?.map((m: any) => m.id) ?? [];

          const { data: phasePMP } = await sb
            .from('ppl_player_match_points')
            .select('player_id, total_points')
            .in('match_id', phaseMatchIds);

          const playerPhaseTotal: Record<string, number> = {};
          for (const row of (phasePMP ?? [])) {
            playerPhaseTotal[row.player_id] = (playerPhaseTotal[row.player_id] ?? 0) + (row.total_points ?? 0);
          }

          const updates = teamPlayers.map((tp: any) => {
            const basePoints = playerPhaseTotal[tp.player_id] ?? 0;
            let final = basePoints;
            if (tp.is_captain) final = basePoints * 2;
            else if (tp.is_vice_captain) final = basePoints * 1.5;
            return sb.from('ppl_user_team_players')
              .update({ fantasy_points: final })
              .eq('id', tp.id);
          });

          await Promise.all(updates);

          const teamTotals: Record<string, number> = {};
          for (const tp of teamPlayers) {
            const basePoints = playerPhaseTotal[(tp as any).player_id] ?? 0;
            let final = basePoints;
            if ((tp as any).is_captain) final = basePoints * 2;
            else if ((tp as any).is_vice_captain) final = basePoints * 1.5;
            teamTotals[(tp as any).user_team_id] = (teamTotals[(tp as any).user_team_id] ?? 0) + final;
          }

          const teamUpdates = Object.entries(teamTotals).map(([tid, pts]) =>
            sb.from('ppl_user_teams').update({ total_points: pts, updated_at: new Date().toISOString() }).eq('id', tid)
          );
          await Promise.all(teamUpdates);

          // ── 11. Recalculate ppl_fantasy_scores for this phase ──────────────
          const { data: allUserTeams } = await sb
            .from('ppl_user_teams')
            .select('id, user_id, total_points')
            .eq('phase_id', match.phase_id);

          if (allUserTeams?.length) {
            const sorted = [...allUserTeams].sort((a: any, b: any) => (b.total_points ?? 0) - (a.total_points ?? 0));

            const fsRows = sorted.map((t: any, i: number) => ({
              user_id: t.user_id,
              phase_id: match.phase_id,
              phase: match.phase_id,
              phase_points: t.total_points ?? 0,
              rank_for_phase: i + 1,
              updated_at: new Date().toISOString(),
            }));

            await sb.from('ppl_fantasy_scores')
              .delete()
              .eq('phase_id', match.phase_id);

            await sb.from('ppl_fantasy_scores').insert(fsRows);
          }
        }
      }
    }

    return json({
      success: true,
      match_id: match_id,
      players_scored: pmpRows.length,
      batting_entries: Object.keys(battingMap).length,
      bowling_entries: Object.keys(bowlingMap).length,
      fielding_entries: Object.keys(fieldingMap).length,
      fantasy_map: fantasyMap,
    });

  } catch (err: any) {
    console.error('recalc-fantasy-points error:', err);
    return json({ error: err.message ?? 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}