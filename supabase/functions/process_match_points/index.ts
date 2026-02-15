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

    const { data: dbPlayers, error: pError } = await supabase.from('players').select('id, name');
    if (pError) throw pError;
    const nameToIdMap = Object.fromEntries(dbPlayers.map(p => [p.name.trim(), p.id]));

    const statsToUpsert = scoreboard.map((p: any) => {
      const playerId = nameToIdMap[p.player_name.trim()];
      if (!playerId) return null;

      // Strict Number conversion to prevent NaN/Null errors
      const runs = Number(p.runs || 0);
      const fours = Number(p.fours || 0);
      const sixes = Number(p.sixes || 0);
      const wickets = Number(p.wickets || 0);
      const isOut = p.is_out === true || p.is_out === "true";

      let pts = (runs * 1) + (fours * 1) + (sixes * 2) + (wickets * 25);
      if (runs >= 50) pts += 8;
      if (runs >= 100) pts += 16;
      if (runs === 0 && isOut) pts -= 2;

      return {
        match_id: match_id,
        player_id: playerId,
        runs: runs,
        balls: Number(p.balls || 0),
        fours: fours,
        sixes: sixes,
        wickets: wickets,
        overs: Number(p.overs || 0),
        maidens: Number(p.maidens || 0),
        fantasy_points: Math.round(pts) // Guaranteed integer
      };
    }).filter(Boolean);

    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    await supabase.rpc('update_leaderboard_after_match', { target_match_id: match_id });

    return new Response(JSON.stringify({ success: true }), {
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