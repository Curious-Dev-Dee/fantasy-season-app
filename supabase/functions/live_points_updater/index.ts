import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRICAPI_KEY = Deno.env.get("CRICAPI_KEY") as string;

const getTrueOvers = (overs: number) => {
  const wholeOvers = Math.floor(overs);
  const balls = Math.round((overs - wholeOvers) * 10);
  return wholeOvers + (balls / 6);
};

// ✅ Fetch with 3 proxy fallbacks
const fetchScorecard = async (matchId: string) => {
  const target = `https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${matchId}`;

  const attempts = [
    // 1. codetabs FIRST — only working proxy
    async () => {
      const res = await fetch(
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) throw new Error(`codetabs HTTP ${res.status}`);
      return await res.json();
    },
    // 2. Direct as fallback (in case IP block lifts)
    async () => {
      const res = await fetch(target, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Direct HTTP ${res.status}`);
      return await res.json();
    },
];

  for (let i = 0; i < attempts.length; i++) {
const label = ["codetabs", "Direct"][i];
    try {
      const json = await attempts[i]();
      if (json?.status === "success") {
        console.log(`✅ [${label}] Scorecard fetched for ${matchId}`);
        return json.data;
      } else {
        console.warn(`⚠️ [${label}] CricAPI returned status: ${json?.status} for ${matchId}`);
      }
    } catch (e) {
      console.error(`❌ [${label}] Failed for ${matchId}:`, e.message);
    }
  }

  return null; // All attempts failed
};

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('id, api_match_id, tournament_id')
      .eq('status', 'locked')
      .eq('points_processed', false);

    if (matchError) console.error("Match fetch error:", matchError.message);
    if (!matches || matches.length === 0) return new Response("No live matches.");

    console.log(`Found ${matches.length} live match(es).`);

    const { data: players } = await supabase.from('players').select('id, api_player_id');
    const apiToDbPlayerMap = new Map();
    players?.forEach(p => apiToDbPlayerMap.set(String(p.api_player_id), p.id));

    for (const match of matches) {
      console.log(`\n--- Processing match ${match.api_match_id} ---`);

      const data = await fetchScorecard(match.api_match_id);

      if (!data?.scorecard) {
        console.warn(`No scorecard data for match ${match.api_match_id} — all proxies failed.`);
        continue;
      }
console.log("teamInfo:", JSON.stringify(data.teamInfo?.map((t:any) => t.name)));
console.log("score array:", JSON.stringify(data.score?.map((s:any) => ({ inning: s.inning, r: s.r }))));
      // ✅ LIVE SCORES UPSERT — for matches page scoreboard
// Find scores by team name match (not index) to handle innings order correctly
// ✅ Calculate scores directly from scorecard — score[] is empty in early innings
const getInningsStats = (inningIndex: number) => {
  const inn = data.scorecard?.[inningIndex];
  if (!inn) return { r: null, w: null, o: null };

  const r = inn.batting?.reduce((acc: number, b: any) => acc + (b.r || 0), 0) ?? null;
  const w = inn.batting?.filter((b: any) =>
    b["dismissal-text"] &&
    !["batting", "not out", ""].includes(b["dismissal-text"].toLowerCase())
  ).length ?? null;
  const o = inn.bowling?.reduce((acc: number, b: any) => acc + getTrueOvers(b.o || 0), 0) ?? null;

  return { r, w, o };
};

const inn1 = getInningsStats(0);
const inn2 = getInningsStats(1);

await supabase.from('live_scores').upsert(
  {
    match_id: match.id,
    match_status: data.status,
    team1_name: data.teamInfo?.[0]?.name ?? null,
    team1_score: inn1.r,
    team1_wickets: inn1.w,
    team1_overs: inn1.o,
    team2_name: data.teamInfo?.[1]?.name ?? null,
    team2_score: inn2.r,
    team2_wickets: inn2.w,
    team2_overs: inn2.o,
    winner: data.matchWinner ?? null,
    batting: data.scorecard.map((inn: any) => inn.batting),
    bowling: data.scorecard.map((inn: any) => inn.bowling),
    updated_at: new Date().toISOString()
  },
  { onConflict: 'match_id' }
);
console.log(`✅ live_scores updated for match ${match.id}`);
      const rawStats = new Map();

      data.scorecard.forEach((inning: any) => {
        // Batting
        (inning.batting || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.batsman?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false
          };
          s.runs += (item.r || 0);
          s.balls += (item.b || 0);
          s.fours += (item["4s"] || 0);
          s.sixes += (item["6s"] || 0);
          if (
            item["dismissal-text"] &&
            !["batting", "not out", ""].includes(item["dismissal-text"].toLowerCase())
          ) {
            s.is_out = true;
          }
          rawStats.set(dbId, s);
        });

        // Bowling
        (inning.bowling || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.bowler?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false
          };
          s.wickets += (item.w || 0);
          s.overs += getTrueOvers(item.o || 0); // ✅ decimal overs fix
          s.runs_conceded += (item.r || 0);
          s.maidens += (item.m || 0);
          rawStats.set(dbId, s);
        });

        // Fielding
        (inning.catching || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.catcher?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false
          };
          s.catches += (item.catch || 0);
          s.stumpings += (item.stumped || 0);
          s.runouts += (item.runout || 0);
          rawStats.set(dbId, s);
        });
      });

      console.log(`Mapped ${rawStats.size} players for match ${match.api_match_id}`);

      if (rawStats.size === 0) {
        console.warn(`Zero players mapped — possible api_player_id type mismatch!`);
        continue;
      }

      const statsToUpsert = Array.from(rawStats.entries()).map(([dbId, s]) => {
        let pts = 0;
        let sr_pts = 0, er_pts = 0, milestone_pts = 0, boundary_pts = 0, duck_pts = 0, involve_pts = 0;

        // Batting points
        pts += s.runs;
        boundary_pts = (s.fours * 1) + (s.sixes * 2);
        pts += boundary_pts;

        if (s.runs >= 100) milestone_pts = 20;
        else if (s.runs >= 75) milestone_pts = 15;
        else if (s.runs >= 50) milestone_pts = 10;
        else if (s.runs >= 30) milestone_pts = 5;
        pts += milestone_pts;

        if (s.runs === 0 && s.is_out && s.balls > 0) {
          duck_pts = -2;
          pts += duck_pts;
        }

        if (s.balls > 0) {
          sr_pts = (s.runs - s.balls);
          pts += sr_pts;
        }

        // Bowling points
        if (s.wickets > 0) pts += 20 + ((s.wickets - 1) * 25);
        pts += (s.maidens * 10);

        if (s.overs >= 2) {
          const rpo = s.runs_conceded / s.overs;
          if (rpo <= 6.0) er_pts = 8;
          else if (rpo <= 9.0) er_pts = 4;
          else er_pts = -4;
          pts += er_pts;
        }

        // Fielding points
        pts += (s.catches * 8) + (s.stumpings * 8) + (s.runouts * 8);

        // Involvement bonus
        if (pts !== 0) { involve_pts = 4; pts += involve_pts; }

        return {
          player_id: dbId,
          runs: s.runs, balls: s.balls, fours: s.fours, sixes: s.sixes,
          wickets: s.wickets, overs: s.overs,
          runs_conceded: s.runs_conceded, maidens: s.maidens,
          catches: s.catches, stumpings: s.stumpings, runouts_direct: s.runouts,
          is_out: s.is_out,
          sr_points: sr_pts, er_points: er_pts,
          milestone_points: milestone_pts, boundary_points: boundary_pts,
          duck_penalty: duck_pts, involvement_points: involve_pts,
          fantasy_points: Math.round(pts)
        };
      });

      console.log(`Sending ${statsToUpsert.length} player stats to RPC...`);
      const { error: rpcError } = await supabase.rpc('process_live_match_points', {
        p_match_id: match.id,
        p_tournament_id: match.tournament_id,
        p_stats_rows: statsToUpsert
      });

      if (rpcError) console.error(`RPC error for match ${match.id}:`, rpcError.message);
      else console.log(`✅ RPC success for match ${match.id}`);
    }

    return new Response("Success", { status: 200 });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
});