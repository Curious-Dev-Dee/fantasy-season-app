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

    const { match_id, scoreboard } = await req.json();
    console.log(`[START] Processing Match: ${match_id}`);

    // 1. FETCH PLAYER IDS: Map the names from the JSON to the UUIDs in your DB
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name');
    
    if (pError) throw pError;

    // Create a lookup map for easy ID matching
    const nameToIdMap = Object.fromEntries(dbPlayers.map(p => [p.name.trim(), p.id]));

    // 2. MAP DATA TO YOUR EXACT COLUMNS
    const statsToUpsert = scoreboard.map((p: any) => {
      const playerId = nameToIdMap[p.player_name.trim()];
      
      if (!playerId) {
        console.warn(`[SKIP] Player ID not found for name: ${p.player_name}`);
        return null;
      }

      // Calculation Logic (matches your previous match stats logic)
      let pts = 0;
      const runs = p.runs || 0;
      const sixes = p.sixes || 0;
      const fours = p.fours || 0;
      const wickets = p.wickets || 0;
      const isOut = p.is_out || false;

      pts += (runs * 1);          
      pts += (fours * 1);         
      pts += (sixes * 2);         
      pts += (wickets * 25);      
      
      if (runs >= 50) pts += 8;   
      if (runs >= 100) pts += 16; 
      if (runs === 0 && isOut) pts -= 2; 

      return {
        match_id: match_id,
        player_id: playerId,        // Correct column from your SQL
        runs: runs,
        balls: p.balls || 0,
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: p.overs || 0,
        maidens: p.maidens || 0,
        fantasy_points: pts         // Correct column from your SQL
      };
    }).filter(Boolean); // Remove nulls (unmatched players)

    console.log(`[DB] Preparing to upsert ${statsToUpsert.length} player rows...`);

    // 3. DATABASE UPSERT
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    // 4. TRIGGER LEADERBOARD CALCULATION
    console.log("[RPC] Updating users' total points...");
    await supabase.rpc('update_leaderboard_after_match', { target_match_id: match_id });

    return new Response(JSON.stringify({ success: true, count: statsToUpsert.length }), {
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