import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Handle CORS Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { match_id, scoreboard } = await req.json();
    console.log(`[START] Processing Match: ${match_id}`);

    // 2. Fetch Player Directory to map Names to UUIDs
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name');
    
    if (pError) throw pError;
    const nameToIdMap = Object.fromEntries(dbPlayers.map(p => [p.name.trim(), p.id]));

    // 3. Map scoreboard to DB schema with Strict Number Conversion
    const statsToUpsert = scoreboard.map((p: any) => {
      const playerId = nameToIdMap[p.player_name.trim()];
      if (!playerId) {
        console.warn(`[SKIP] No ID found for: ${p.player_name}`);
        return null;
      }

      // Force conversion to Number to prevent 'NaN' results
      const runs = Number(p.runs || 0);
      const balls = Number(p.balls || 0);
      const fours = Number(p.fours || 0);
      const sixes = Number(p.sixes || 0);
      const wickets = Number(p.wickets || 0);
      const maidens = Number(p.maidens || 0);
      const overs = Number(p.overs || 0);
      const isOut = p.is_out === true || p.is_out === "true";

      // Calculate Points
      let pts = 0;
      pts += (runs * 1);          // 1 pt per run
      pts += (fours * 1);         // 1 pt bonus per 4
      pts += (sixes * 2);         // 2 pt bonus per 6
      pts += (wickets * 25);      // 25 pts per wicket
      
      if (runs >= 50) pts += 8;   // Half-century bonus
      if (runs >= 100) pts += 16; // Century bonus
      if (runs === 0 && isOut) pts -= 2; // Duck penalty

      return {
        match_id: match_id,
        player_id: playerId,
        runs: runs,
        balls: balls,
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: overs,
        maidens: maidens,
        fantasy_points: Math.round(pts) // Ensure integer for DB
      };
    }).filter(Boolean);

    console.log(`[DB] Upserting ${statsToUpsert.length} player rows...`);

    // 4. Perform Upsert using the match_id + player_id unique constraint
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    // 5. Update Global Leaderboards
    console.log("[RPC] Recalculating user leaderboard totals...");
    await supabase.rpc('update_leaderboard_after_match', { target_match_id: match_id });

    return new Response(JSON.stringify({ success: true, count: statsToUpsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[CRITICAL ERROR]: ${error.message}`); //
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});