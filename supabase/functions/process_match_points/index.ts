import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { 
        match_id, 
        tournament_id, 
        scoreboard = [], 
        pom_id = null, 
        winner_id = null 
    } = body;

    if (!match_id) throw new Error("match_id is missing");
    const isAbandoned = winner_id === "abandoned";
    const normalizedWinnerId = isAbandoned ? null : winner_id;
    const normalizedPomId = isAbandoned ? null : pom_id;

    if (!isAbandoned && !normalizedWinnerId) {
      throw new Error("winner_id is missing");
    }
    if (!isAbandoned && !normalizedPomId) {
      throw new Error("pom_id is missing for completed match");
    }

    const getTrueOvers = (overs: number) => {
      const wholeOvers = Math.floor(overs);
      const balls = Math.round((overs - wholeOvers) * 10);
      return wholeOvers + (balls / 6);
    };

    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name')
      .eq('is_active', true);

    if (pError) throw pError;
    
    const nameToIdMap = Object.fromEntries(
      dbPlayers.map(p => [p.name.trim().toLowerCase(), p.id])
    );

    const statsToUpsert = scoreboard.map((p: any) => {
      const playerNameClean = p.player_name.trim().toLowerCase();
      const playerId = nameToIdMap[playerNameClean];
      if (!playerId) return null;

      const runs = Number(p.runs || 0);
      const balls = Number(p.balls || 0);
      const fours = Number(p.fours || 0);
      const sixes = Number(p.sixes || 0);
      const wickets = Number(p.wickets || 0);
      const maidens = Number(p.maidens || 0);
      const catches = Number(p.catches || 0);
      const stumpings = Number(p.stumpings || 0);
      // FIXED: Defined these variables correctly
      const r_dir = Number(p.runouts_direct || 0);
      const r_asst = Number(p.runouts_assisted || 0);
      const isOut = String(p.is_out) === "true";

      let pts = 0;
      let sr_pts = 0;
      let er_pts = 0;
      let milestone_pts = 0;
      let boundary_pts = 0;
      let duck_pts = 0;
      let involve_pts = 0;

      pts += runs; 
      boundary_pts = (fours * 1) + (sixes * 2);
      pts += boundary_pts;
      
      if (runs >= 100) milestone_pts = 20;
      else if (runs >= 75) milestone_pts = 15;
      else if (runs >= 50) milestone_pts = 10;
      else if (runs >= 30) milestone_pts = 5;
      pts += milestone_pts;

      if (runs === 0 && isOut) {
          duck_pts = -2;
          pts += duck_pts;
      }

      sr_pts = (runs - balls);
      pts += sr_pts;

      if (wickets > 0) {
        pts += 20 + ((wickets - 1) * 25);
      }
      pts += (maidens * 10);

      const rawOvers = Number(p.overs || 0);
      if (rawOvers >= 2) {
        const trueOvers = getTrueOvers(rawOvers);
        const rpo = Number(p.runs_conceded || 0) / trueOvers;
        if (rpo < 5) er_pts = 8;
        else if (rpo < 6) er_pts = 6;
        else if (rpo <= 7) er_pts = 4;
        else if (rpo > 12) er_pts = -6;
        else if (rpo > 11) er_pts = -4;
        pts += er_pts;
      }

      pts += (catches * 8);
      pts += (stumpings * 8);
      pts += ((r_dir + r_asst) * 8);

      if (pts !== 0) {
          involve_pts = 4;
          pts += involve_pts;
      }

      const isPOM = (playerId === normalizedPomId);
      if (isPOM) pts += 20;

      return {
        match_id,
        player_id: playerId,
        runs,
        balls,
        fours,
        sixes,
        wickets,
        overs: rawOvers,
        runs_conceded: Number(p.runs_conceded || 0),
        maidens,
        catches,
        stumpings,
        runouts_direct: r_dir,
        runouts_assisted: r_asst,
        is_player_of_match: isPOM,
        is_out: isOut,
        sr_points: sr_pts,
        er_points: er_pts,
        milestone_points: milestone_pts,
        // FIXED: Column name matched to boundary_pts
        boundary_points: boundary_pts,
        duck_penalty: duck_pts,
        involvement_points: involve_pts,
        fantasy_points: Math.round(pts)
      };
    }).filter(Boolean);

    if (!isAbandoned && statsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_match_stats')
        .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

      if (upsertError) throw upsertError;
    }

    const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', { 
      target_match_id: match_id,
      p_winner_id: normalizedWinnerId,
      p_pom_id: normalizedPomId
    });

    if (rpcError) throw rpcError;

    await supabase.from('matches').update({ 
        points_processed: !isAbandoned,
        winner_id: normalizedWinnerId,
        man_of_the_match_id: normalizedPomId,
        status: isAbandoned ? 'abandoned' : 'completed'
    }).eq('id', match_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
