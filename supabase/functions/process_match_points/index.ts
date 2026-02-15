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

    // 1. Fetch Player IDs to map Names to UUIDs
    const { data: dbPlayers, error: pError } = await supabase
      .from('players')
      .select('id, name');
    
    if (pError) throw pError;
    const nameToIdMap = Object.fromEntries(dbPlayers.map(p => [p.name.trim(), p.id]));

    // 2. Map data to your schema
    const statsToUpsert = scoreboard.map((p: any) => {
      const playerId = nameToIdMap[p.player_name.trim()];
      if (!playerId) return null;

      let pts = (p.runs * 1) + (p.sixes * 2) + (p.fours * 1) + (p.wickets * 25);
      if (p.runs >= 50) pts += 8;
      if (p.runs === 0 && p.is_out) pts -= 2;

      return {
        match_id: match_id,
        player_id: playerId,
        runs: p.runs || 0,
        balls: p.balls || 0,
        fours: p.fours || 0,
        sixes: p.sixes || 0,
        wickets: p.wickets || 0,
        overs: p.overs || 0,
        maidens: p.maidens || 0,
        fantasy_points: pts
      };
    }).filter(Boolean);

    console.log(`[DB] Upserting ${statsToUpsert.length} player rows...`);

    // 3. The Upsert - Now matching the new unique constraint
    const { error: upsertError } = await supabase
      .from('player_match_stats')
      .upsert(statsToUpsert, { onConflict: 'match_id, player_id' });

    if (upsertError) throw upsertError;

    // 4. Update Leaderboards
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