import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { match_id, scoreboard } = await req.json();
    
    // Logging for debugging
    console.log(`[START] Processing Match: ${match_id}`);
    console.log(`[INFO] Players in batch: ${scoreboard?.length}`);

    if (!match_id || !scoreboard || scoreboard.length === 0) {
      throw new Error("Data missing: match_id or scoreboard is empty.");
    }

    const statsToUpsert = scoreboard.map((p: any) => {
      // Calculate Fantasy Points
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
        name: p.player_name, // Mapping 'player_name' from Admin to 'name' in DB
        runs: runs,
        balls: p.balls || 0,
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: p.overs || 0,
        runs_conceded: p.runs_conceded || 0,
        maidens: p.maidens || 0,
        points: pts
      };
    });

    // Attempting DB Write
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, name' });

    if (upsertError) {
      console.error(`[DB ERROR] ${upsertError.message}`);
      throw upsertError;
    }

    // Trigger Leaderboard Update RPC
    const { error: rpcError } = await supabase.rpc('update_leaderboard_after_match', {
        target_match_id: match_id
    });

    if (rpcError) console.error(`[RPC ERROR] ${rpcError.message}`);

    return new Response(
      JSON.stringify({ success: true, processed: statsToUpsert.length }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error(`[CRITICAL] ${error.message}`);
    return new Response(
      JSON.stringify({ error: error.message }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});