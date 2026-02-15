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

    const { match_id, tournament_id, scoreboard } = await req.json();
    console.log(`[START] Processing Match: ${match_id}`);

    // 1. Fetch all players to map Names to IDs
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name')
      .eq('is_active', true);

    if (pError) throw pError;
    
    // Create a normalized map for easier lookup
    const nameToIdMap = Object.fromEntries(
      dbPlayers.map(p => [p.name.trim().toLowerCase(), p.id])
    );

    // 2. Map JSON stats to Database Columns and Calculate Points
    const statsToUpsert = scoreboard.map((p: any) => {
      const playerNameClean = p.player_name.trim().toLowerCase();
      const playerId = nameToIdMap[playerNameClean];
      
      if (!playerId) {
        console.warn(`⚠️ Player not found in DB: ${p.player_name}`);
        return null;
      }

      // Convert all inputs to Numbers to prevent math errors
      const runs = Number(p.runs || 0);
      const fours = Number(p.fours || 0);
      const sixes = Number(p.sixes || 0);
      const wickets = Number(p.wickets || 0);
      const maidens = Number(p.maidens || 0);
      const catches = Number(p.catches || 0);
      const stumpings = Number(p.stumpings || 0);
      const runouts = Number(p.runouts_direct || 0) + Number(p.runouts_assisted || 0);
      const isOut = String(p.is_out) === "true";

      // --- SCORING LOGIC ---
      let pts = 0;

      // Batting
      pts += (runs * 1);           // 1 pt per run
      pts += (fours * 1);          // +1 pt per boundary
      pts += (sixes * 2);          // +2 pts per six
      if (runs >= 50) pts += 8;    // Half-century bonus
      if (runs >= 100) pts += 16;  // Century bonus
      if (runs === 0 && isOut) pts -= 2; // Duck penalty

      // Bowling
      pts += (wickets * 25);       // 25 pts per wicket
      pts += (maidens * 12);       // 12 pts per maiden
      if (wickets >= 3) pts += 4;  // 3-wicket haul
      if (wickets >= 5) pts += 8;  // 5-wicket haul

      // Fielding
      pts += (catches * 8);        // 8 pts per catch
      pts += (stumpings * 12);     // 12 pts per stumping
      pts += (runouts * 6);        // 6 pts per run-out

      return {
        match_id: match_id,
        player_id: playerId,
        runs,
        balls: Number(p.balls || 0),
        fours,
        sixes,
        wickets,
        overs: Number(p.overs || 0),
        maidens,
        catches,
        stumpings,
        runouts_direct: Number(p.runouts_direct || 0),
        runouts_assisted: Number(p.runouts_assisted || 0),
        fantasy_points: Math.round(pts)
      };
    }).filter(Boolean);

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