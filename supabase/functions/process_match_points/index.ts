import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\(c\s*&\s*wk\)/g, "") // removes (c & wk)
        .replace(/\(wk\)/g, "")        // removes (wk)
        .replace(/\(c\)/g, "")         // removes (c)
        .replace(/&/g, "")             // removes stray &
        .replace(/\s+/g, " ")          // collapses multiple spaces into one
        .trim();
}

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
    if (!Array.isArray(scoreboard)) throw new Error("scoreboard must be an array");

    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('id, tournament_id')
      .eq('id', match_id)
      .maybeSingle();

    if (matchError) throw matchError;
    if (!match) throw new Error("match not found");
    if (tournament_id && tournament_id !== match.tournament_id) {
      throw new Error("tournament_id does not match the selected match");
    }

    const effectiveTournamentId = match.tournament_id;
    const isAbandoned = winner_id === "abandoned";
    const normalizedWinnerId = isAbandoned ? null : winner_id;
    const normalizedPomId = isAbandoned ? null : pom_id;

    if (!isAbandoned && !normalizedWinnerId) {
      throw new Error("winner_id is missing");
    }
    if (!isAbandoned && !normalizedPomId) {
      throw new Error("pom_id is missing for a scored match");
    }
    if (isAbandoned && scoreboard.length > 0) {
      throw new Error("Leave scoreboard empty if the match was abandoned before a ball was bowled");
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

    const duplicateNames = new Set<string>();
    const nameToIdMap = new Map<string, string>();
    dbPlayers.forEach((player) => {
      const normalized = normalizeName(player.name);
      if (nameToIdMap.has(normalized)) duplicateNames.add(player.name);
      nameToIdMap.set(normalized, player.id);
    });

    if (duplicateNames.size > 0) {
      throw new Error(`Ambiguous active player names in database: ${Array.from(duplicateNames).sort().join(", ")}`);
    }

    const missingPlayerNames: string[] = [];

    const statsToUpsert = scoreboard.map((p: any) => {
      if (typeof p?.player_name !== "string" || !normalizeName(p.player_name)) {
        throw new Error("Every scoreboard row must include player_name");
      }

      const playerNameClean = normalizeName(p.player_name);
      const playerId = nameToIdMap.get(playerNameClean);
      if (!playerId) {
        missingPlayerNames.push(p.player_name.trim());
        return null;
      }

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
        
        // New Economy Logic
        if (rpo <= 6.0) {
            er_pts = 8;
        } else if (rpo <= 9.0) {
            er_pts = 4;
        } else {
            er_pts = -4;
        }
        
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

    if (missingPlayerNames.length > 0) {
      const uniqueMissingNames = [...new Set(missingPlayerNames)];
      throw new Error(`Unknown player names in scoreboard: ${uniqueMissingNames.join(", ")}`);
    }

    if (!isAbandoned && statsToUpsert.length === 0) {
      throw new Error("Scoreboard has no valid player rows");
    }

    const { data: processingResult, error: processingError } = await supabase.rpc(
      'finalize_match_processing_atomic',
      {
        p_match_id: match_id,
        p_tournament_id: effectiveTournamentId,
        p_stats_rows: statsToUpsert,
        p_winner_id: normalizedWinnerId,
        p_pom_id: normalizedPomId,
        p_is_abandoned: isAbandoned
      }
    );

    if (processingError) throw processingError;

    return new Response(JSON.stringify(
      processingResult ?? {
        success: true,
        processed_rows: statsToUpsert.length,
        mode: isAbandoned ? 'abandoned_before_start' : 'scored_match'
      }
    ), {
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
