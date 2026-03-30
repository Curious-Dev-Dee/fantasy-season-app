import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRICAPI_KEY = Deno.env.get("CRICAPI_KEY"); // Make sure to add this to your Supabase Secrets

const getTrueOvers = (overs: number) => {
  const wholeOvers = Math.floor(overs);
  const balls = Math.round((overs - wholeOvers) * 10);
  return wholeOvers + (balls / 6);
};

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Find live matches that are locked but not processed
    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('id, api_match_id, tournament_id')
      .eq('status', 'locked')
      .eq('points_processed', false)
      .not('api_match_id', 'is', null);

    if (matchError) throw matchError;
    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({ message: "No live matches to process." }), { status: 200 });
    }

    // 2. Fetch all players so we can map CricAPI ID to Database ID
    const { data: players, error: pError } = await supabase
      .from('players')
      .select('id, api_player_id')
      .not('api_player_id', 'is', null);

    if (pError) throw pError;

    // Create a fast lookup dictionary (CricAPI ID -> DB ID)
    const apiToDbPlayerMap = new Map();
    players.forEach(p => apiToDbPlayerMap.set(p.api_player_id, p.id));

    // 3. Process each live match
    for (const match of matches) {
      console.log(`Fetching live scores for Match API ID: ${match.api_match_id}`);
      
      const response = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}&id=${match.api_match_id}`);
      const apiData = await response.json();

      if (apiData.status !== "success" || !apiData.data || !apiData.data.scorecard) {
        console.log(`Match ${match.api_match_id} not ready or failed.`);
        continue;
      }

      const scorecard = apiData.data.scorecard;
      const playerStatsMap = new Map();

      // Initialize player stat tracker
      const getPlayer = (apiId: string) => {
        if (!playerStatsMap.has(apiId)) {
          playerStatsMap.set(apiId, {
            api_player_id: apiId, runs: 0, balls: 0, fours: 0, sixes: 0, is_out: false,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts_direct: 0, runouts_assisted: 0
          });
        }
        return playerStatsMap.get(apiId);
      };

      // Extract data from CricAPI JSON
      scorecard.forEach((inning: any) => {
        inning.batting?.forEach((b: any) => {
          const p = getPlayer(b.batsman.id);
          p.runs = b.r || 0;
          p.balls = b.b || 0;
          p.fours = b['4s'] || 0; 
          p.sixes = b['6s'] || 0;
          p.is_out = b['dismissal-text'] !== 'not out';
        });

        inning.bowling?.forEach((bw: any) => {
          const p = getPlayer(bw.bowler.id);
          p.wickets = bw.w;
          p.overs = bw.o;
          p.runs_conceded = bw.r;
          p.maidens = bw.m;
        });

        inning.catching?.forEach((c: any) => {
          const p = getPlayer(c.catcher.id);
          p.catches = c.catch;
          p.stumpings = c.stumped;
          p.runouts_direct = c.runout;
        });
      });

      // Calculate Points
      const statsToUpsert: any[] = [];
      const rawStatsArray = Array.from(playerStatsMap.values());

      for (const p of rawStatsArray) {
        const dbPlayerId = apiToDbPlayerMap.get(p.api_player_id);
        
        // Skip players not in DB (like subs who aren't fantasy active)
        if (!dbPlayerId) continue; 

        let pts = 0, sr_pts = 0, er_pts = 0, milestone_pts = 0;
        let boundary_pts = 0, duck_pts = 0, involve_pts = 0;

        pts += p.runs; 
        boundary_pts = (p.fours * 1) + (p.sixes * 2);
        pts += boundary_pts;
        
        if (p.runs >= 100) milestone_pts = 20;
        else if (p.runs >= 75) milestone_pts = 15;
        else if (p.runs >= 50) milestone_pts = 10;
        else if (p.runs >= 30) milestone_pts = 5;
        pts += milestone_pts;

        if (p.runs === 0 && p.is_out) {
            duck_pts = -2;
            pts += duck_pts;
        }

        sr_pts = (p.runs - p.balls);
        pts += sr_pts;

        if (p.wickets > 0) {
          pts += 20 + ((p.wickets - 1) * 25);
        }
        pts += (p.maidens * 10);

        if (p.overs >= 2) {
          const trueOvers = getTrueOvers(p.overs);
          const rpo = p.runs_conceded / trueOvers;
          if (rpo <= 6.0) er_pts = 8;
          else if (rpo <= 9.0) er_pts = 4;
          else er_pts = -4;
          pts += er_pts;
        }

        pts += (p.catches * 8) + (p.stumpings * 8) + ((p.runouts_direct + p.runouts_assisted) * 8);

        if (pts !== 0) {
            involve_pts = 4;
            pts += involve_pts;
        }

        // NO Player of Match logic here (Live match doesn't have it yet)

        statsToUpsert.push({
          player_id: dbPlayerId,
          runs: p.runs, balls: p.balls, fours: p.fours, sixes: p.sixes,
          wickets: p.wickets, overs: p.overs, runs_conceded: p.runs_conceded,
          maidens: p.maidens, catches: p.catches, stumpings: p.stumpings,
          runouts_direct: p.runouts_direct, runouts_assisted: p.runouts_assisted,
          is_out: p.is_out, sr_points: sr_pts, er_points: er_pts,
          milestone_points: milestone_pts, boundary_points: boundary_pts,
          duck_penalty: duck_pts, involvement_points: involve_pts,
          fantasy_points: Math.round(pts)
        });
      }

      // Update Database
      if (statsToUpsert.length > 0) {
        await supabase.rpc('process_live_match_points', {
          p_match_id: match.id,
          p_tournament_id: match.tournament_id,
          p_stats_rows: statsToUpsert
        });
        console.log(`Successfully updated live points for match ${match.id}`);
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Live sync complete." }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
});