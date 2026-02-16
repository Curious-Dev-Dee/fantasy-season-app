import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ... (keep the serve and client setup at the top)

    const { match_id, tournament_id, scoreboard, pom_id } = await req.json();
    console.log(`[START] Processing Match: ${match_id}`);

    // 1. Fetch all players to map Names to IDs
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name')
      .eq('is_active', true);

    if (pError) throw pError;
    
    const nameToIdMap = Object.fromEntries(
      dbPlayers.map(p => [p.name.trim().toLowerCase(), p.id])
    );

    // 2. Map JSON stats and Apply NEW Rules
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
      const runouts = Number(p.runouts_direct || 0) + Number(p.runouts_assisted || 0);
      const isOut = String(p.is_out) === "true";

      // --- NEW FANTASY SCORING LOGIC ---
      let pts = 0;

      // A. Batting
      pts += runs; // +1 per run
      pts += (fours * 1); // +1 bonus
      pts += (sixes * 2); // +2 bonus
      
      if (runs >= 100) pts += 20;
      else if (runs >= 75) pts += 15;
      else if (runs >= 50) pts += 10;
      else if (runs >= 30) pts += 5;

      if (runs === 0 && isOut) pts -= 2;

      // Strike Rate Bonus (Runs - Balls)
      pts += (runs - balls);

      // B. Bowling
      if (wickets > 0) {
        pts += 20 + ((wickets - 1) * 25); // 1st: 20, 2nd+: 25
      }
      pts += (maidens * 10);

      // Economy Rate Calculation (Min 2 Overs)
      const oversVal = Number(p.overs || 0);
      if (oversVal >= 2) {
        const rpo = Number(p.runs_conceded || 0) / oversVal;
        if (rpo < 5) pts += 8;
        else if (rpo < 6) pts += 6;
        else if (rpo <= 7) pts += 4;
        else if (rpo > 12) pts -= 6;
        else if (rpo > 11) pts -= 4;
      }

      // C. Fielding
      pts += (catches * 8);
      pts += (stumpings * 8);
      pts += (runouts * 8); // Flat 8 as requested

      // D. Involvement Bonus (+4)
      // If the player did anything (positive or negative), they get +4
      if (pts !== 0) pts += 4;

      // E. Player of the Match (+20)
      const isPOM = (playerId === pom_id);
      if (isPOM) pts += 20;

      return {
        match_id,
        player_id: playerId,
        runs,
        balls,
        fours,
        sixes,
        wickets,
        overs: oversVal,
        maidens,
        catches,
        stumpings,
        runouts_direct: Number(p.runouts_direct || 0),
        runouts_assisted: Number(p.runouts_assisted || 0),
        is_player_of_match: isPOM, // Saved to DB
        fantasy_points: Math.round(pts)
      };
    }).filter(Boolean);

    // 3. Upsert into DB (triggers will handle the rest)
// ... (rest of the function stays the same)

    // 3. Upsert Player Stats
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    // 4. Trigger the SQL RPC to update User Leaderboards
    const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', { 
      target_match_id: match_id 
    });

    if (rpcError) throw rpcError;

    // 5. Mark match as processed
    await supabase.from('matches').update({ points_processed: true }).eq('id', match_id);

    return new Response(JSON.stringify({ success: true, players_processed: statsToUpsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[CRITICAL ERROR]: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});