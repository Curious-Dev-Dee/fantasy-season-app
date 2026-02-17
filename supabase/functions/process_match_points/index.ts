import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { match_id, tournament_id, scoreboard, pom_id } = await req.json();

    const getTrueOvers = (overs: number) => {
      const whole = Math.floor(overs);
      const balls = Math.round((overs - whole) * 10);
      return whole + (balls / 6);
    };

    const statsToUpsert = scoreboard.map((p: any) => {
      const playerId = p.player_id; // CRITICAL: Use the ID sent by Admin JS
      if (!playerId) return null;

      const runs = Number(p.runs || 0);
      const balls = Number(p.balls || 0);
      const wickets = Number(p.wickets || 0);
      const isOut = String(p.is_out) === "true";

      // SCORING LOGIC
      let pts = 0;
      pts += runs + (Number(p.fours || 0) * 1) + (Number(p.sixes || 0) * 2);
      if (runs >= 100) pts += 20; else if (runs >= 50) pts += 10;
      if (runs === 0 && isOut) pts -= 2;
      pts += (runs - balls); // Strike Rate Bonus

      if (wickets > 0) pts += 20 + ((wickets - 1) * 25);
      
      const rawOvers = Number(p.overs || 0);
      if (rawOvers >= 2) {
        const trueOvers = getTrueOvers(rawOvers);
        const rpo = Number(p.runs_conceded || 0) / trueOvers;
        if (rpo < 5) pts += 8; else if (rpo > 12) pts -= 6;
      }

      pts += (Number(p.catches || 0) * 8) + (Number(p.stumpings || 0) * 8) + (Number(p.runouts_direct || 0) * 8);
      if (pts !== 0) pts += 4; // Involvement Bonus
      if (playerId === pom_id) pts += 20;

      return {
        match_id, player_id: playerId, runs, balls, wickets,
        overs: rawOvers, is_player_of_match: playerId === pom_id,
        fantasy_points: Math.round(pts)
      };
    }).filter(Boolean);

    const { error: upsertError } = await supabase.from('player_match_stats').upsert(statsToUpsert, { onConflict: 'match_id, player_id' });
    if (upsertError) throw upsertError;

    await supabase.rpc('update_leaderboard_after_match', { target_match_id: match_id });
    await supabase.from('matches').update({ points_processed: true }).eq('id', match_id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});