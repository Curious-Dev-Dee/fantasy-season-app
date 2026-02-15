import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** * Standard CORS headers to allow your Admin Dashboard 
 * to talk to this Edge Function
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Handle Browser Pre-flight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Initialize Supabase Client with Service Role (Bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 3. Parse and Log Incoming Data
    const { match_id, scoreboard, tournament_id } = await req.json();
    console.log(`[START] Processing Match: ${match_id}`);
    console.log(`[INFO] Players received in batch: ${scoreboard?.length}`);

    if (!match_id || !scoreboard || scoreboard.length === 0) {
      throw new Error("Missing match_id or empty scoreboard data.");
    }

    // 4. Map the flattened scoreboard to your DB schema
    const statsToUpsert = scoreboard.map((p: any) => {
      // Points Logic (Standard T20 Rules)
      let points = 0;
      const runs = p.runs || 0;
      const sixes = p.sixes || 0;
      const fours = p.fours || 0;
      const wickets = p.wickets || 0;
      const isOut = p.is_out || false;

      points += (runs * 1);          // 1 pt per run
      points += (fours * 1);         // 1 pt bonus per boundary
      points += (sixes * 2);         // 2 pt bonus per six
      points += (wickets * 25);      // 25 pts per wicket
      
      if (runs >= 50) points += 8;   // Half-century bonus
      if (runs >= 100) points += 16; // Century bonus
      if (runs === 0 && isOut) points -= 2; // Duck penalty

      return {
        match_id: match_id,
        name: p.player_name,         // Column the cache was missing
        runs: runs,
        balls: p.balls || 0,
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: p.overs || 0,
        runs_conceded: p.runs_conceded || 0,
        maidens: p.maidens || 0,
        points: points
      };
    });

    // 5. Bulk Upsert into player_match_stats
    console.log("[DB] Attempting upsert to player_match_stats...");
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, name' });

    if (upsertError) {
      console.error("[DB ERROR] Upsert failed:", upsertError.message);
      throw upsertError;
    }

    // 6. Final Step: Trigger the Leaderboard Refresh
    console.log("[RPC] Triggering leaderboard calculation...");
    const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', {
        target_match_id: match_id
    });

    if (rpcError) console.warn("[RPC WARNING] Leaderboard update might have failed:", rpcError.message);

    return new Response(
      JSON.stringify({ success: true, message: `Processed ${statsToUpsert.length} players` }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error("[CRITICAL ERROR]:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});