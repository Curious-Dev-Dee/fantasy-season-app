import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRICAPI_KEY = Deno.env.get("CRICAPI_KEY") as string;





// ─── Helper: convert CricAPI decimal overs to true overs ─────────────────────
const getTrueOvers = (overs: number) => {
  const wholeOvers = Math.floor(overs);
  const balls = Math.round((overs - wholeOvers) * 10);
  return wholeOvers + (balls / 6);
};

// ─── Fetch scorecard (Proxy ONLY - Bulletproof Version) ──────────────────────
const fetchScorecard = async (matchId: string) => {
  // We use %26 here so the ID doesn't get lost in the proxy
  const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=https://api.cricapi.com/v1/match_scorecard?apikey=${CRICAPI_KEY}%26id=${matchId}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Proxy Server Error: ${res.status}`);
    
    const json = await res.json();
    
    if (json?.status === "success") {
      console.log(`✅ Success! Data found for ${matchId}`);
      return json.data;
    } else {
      console.warn(`⚠️ API says: ${json?.reason || "No data yet"}`);
      return null;
    }
  } catch (e) {
    console.error(`❌ Connection failed:`, e.message);
    return null;
  }
};

// ─── Main serve ──────────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch all locked + unprocessed matches
    const { data: matches, error: matchError } = await supabase
      .from("matches")
      .select("id, api_match_id, tournament_id, team_a_id, team_b_id")
      .eq("status", "locked")
      .eq("points_processed", false);

    if (matchError) console.error("Match fetch error:", matchError.message);
    if (!matches || matches.length === 0) return new Response("No live matches.");

    console.log(`Found ${matches.length} live match(es).`);

    // Build api_player_id → db UUID map
    const { data: players } = await supabase
      .from("players")
      .select("id, api_player_id");

    const apiToDbPlayerMap = new Map<string, string>();
    players?.forEach((p) => apiToDbPlayerMap.set(String(p.api_player_id), p.id));

    // ── Process each match ──────────────────────────────────────────────────
    for (const match of matches) {
      console.log(`\n--- Processing match ${match.api_match_id} ---`);

      const data = await fetchScorecard(match.api_match_id);

      if (!data?.scorecard) {
        console.warn(`No scorecard for ${match.api_match_id} — skipping.`);
        continue;
      }

      // ── 1. Extract toss, winner, result from scorecard response ────────────
      const tossWinner   = data.tossWinner ?? null;   // e.g. "mumbai indians" (lowercase)
      const tossChoice   = data.tossChoice ?? null;   // e.g. "bowl"
      const matchWinner  = data.matchWinner ?? null;  // e.g. "Rajasthan Royals"
      const matchResult  = data.status ?? null;       // e.g. "RR won by 27 runs"
      const matchEnded   = data.matchEnded ?? false;

      console.log(`Toss: ${tossWinner} chose to ${tossChoice}`);
      console.log(`Winner: ${matchWinner} | Ended: ${matchEnded}`);

      // ── 2. Calculate innings scores ────────────────────────────────────────
      const getInningsStats = (index: number) => {
        const scoreEntry = data.score?.[index];
        if (scoreEntry) {
          return { r: scoreEntry.r, w: scoreEntry.w, o: scoreEntry.o };
        }
        const inn = data.scorecard?.[index];
        if (!inn) return { r: null, w: null, o: null };
        const r = inn.batting?.reduce((acc: number, b: any) => acc + (b.r || 0), 0) ?? null;
        const w = inn.batting?.filter((b: any) =>
          b["dismissal-text"] &&
          !["batting", "not out", ""].includes(b["dismissal-text"].toLowerCase())
        ).length ?? null;
        const o = inn.bowling?.reduce((acc: number, b: any) => acc + getTrueOvers(b.o || 0), 0) ?? null;
        return { r, w, o };
      };

      const inn1 = getInningsStats(0);
      const inn2 = getInningsStats(1);

      // ── 3. Upsert live_scores (NOW includes toss + result) ─────────────────
      const { error: liveScoreError } = await supabase
        .from("live_scores")
        .upsert(
          {
            match_id:      match.id,
            match_status:  data.status,
            match_result:  matchResult,
            toss_winner:   tossWinner,   // ✅ NEW
            toss_choice:   tossChoice,   // ✅ NEW
            winner:        matchWinner,  // team name string

            team1_name:    data.teamInfo?.[0]?.name ?? data.teams?.[0] ?? null,
            team1_score:   inn1.r,
            team1_wickets: inn1.w,
            team1_overs:   inn1.o,

            team2_name:    data.teamInfo?.[1]?.name ?? data.teams?.[1] ?? null,
            team2_score:   inn2.r,
            team2_wickets: inn2.w,
            team2_overs:   inn2.o,

            batting:    data.scorecard.map((inn: any) => inn.batting),
            bowling:    data.scorecard.map((inn: any) => inn.bowling),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "match_id" }
        );

      if (liveScoreError) console.error(`live_scores error:`, liveScoreError.message);
      else console.log(`✅ live_scores updated for match ${match.id}`);



      // ── 5. Build player raw stats map ──────────────────────────────────────
      const rawStats = new Map<string, any>();

      data.scorecard.forEach((inning: any) => {
        // Batting
        (inning.batting || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.batsman?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false,
          };
          s.runs  += (item.r    || 0);
          s.balls += (item.b    || 0);
          s.fours += (item["4s"] || 0);
          s.sixes += (item["6s"] || 0);
          if (
            item["dismissal-text"] &&
            !["batting", "not out", ""].includes(item["dismissal-text"].toLowerCase())
          ) {
            s.is_out = true;
          }
          rawStats.set(dbId, s);
        });

        // Bowling
        (inning.bowling || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.bowler?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false,
          };
          s.wickets       += (item.w || 0);
          s.overs         += getTrueOvers(item.o || 0);
          s.runs_conceded += (item.r || 0);
          s.maidens       += (item.m || 0);
          rawStats.set(dbId, s);
        });

        // Fielding
        (inning.catching || []).forEach((item: any) => {
          const dbId = apiToDbPlayerMap.get(String(item.catcher?.id));
          if (!dbId) return;
          const s = rawStats.get(dbId) || {
            runs: 0, balls: 0, fours: 0, sixes: 0,
            wickets: 0, overs: 0, runs_conceded: 0, maidens: 0,
            catches: 0, stumpings: 0, runouts: 0, is_out: false,
          };
          s.catches   += (item.catch   || 0);
          s.stumpings += (item.stumped || 0);
          s.runouts   += (item.runout  || 0);
          rawStats.set(dbId, s);
        });
      });

      console.log(`Mapped ${rawStats.size} players for match ${match.api_match_id}`);

      if (rawStats.size === 0) {
        console.warn(`Zero players mapped — possible api_player_id mismatch!`);
        continue;
      }

      // ── 6. Calculate fantasy points ────────────────────────────────────────
      const statsToUpsert = Array.from(rawStats.entries()).map(([dbId, s]) => {
        let pts = 0;
        let sr_pts = 0, er_pts = 0, milestone_pts = 0;
        let boundary_pts = 0, duck_pts = 0, involve_pts = 0;

        // Batting
        pts += s.runs;
        boundary_pts = (s.fours * 1) + (s.sixes * 2);
        pts += boundary_pts;

        if      (s.runs >= 100) milestone_pts = 20;
        else if (s.runs >= 75)  milestone_pts = 15;
        else if (s.runs >= 50)  milestone_pts = 10;
        else if (s.runs >= 30)  milestone_pts = 5;
        pts += milestone_pts;

        if (s.runs === 0 && s.is_out && s.balls > 0) {
          duck_pts = -2;
          pts += duck_pts;
        }

if (s.balls > 0) {
          sr_pts = (s.runs - s.balls);
          pts += sr_pts;
        }

        // Bowling
        // 1. Base points (25 per wicket)
        pts += (s.wickets * 25);

        // 2. Milestone Bonus
        let wicket_bonus = 0;
        if (s.wickets >= 5) {
          wicket_bonus = 20;
        } else if (s.wickets === 4) {
          wicket_bonus = 15;
        } else if (s.wickets === 3) {
          wicket_bonus = 10;
        } else if (s.wickets === 2) {
          wicket_bonus = 5;
        }
        pts += wicket_bonus;

        pts += (s.maidens * 10);

        if (s.overs >= 2) {
          const rpo = s.runs_conceded / s.overs;
          if      (rpo <= 6.0) er_pts = 8;
          else if (rpo <= 9.0) er_pts = 4;
          else                 er_pts = -4;
          pts += er_pts;
        }

        // Fielding
        pts += (s.catches * 8) + (s.stumpings * 8) + (s.runouts * 8);

        // Involvement bonus
        if (pts !== 0) { involve_pts = 4; pts += involve_pts; }

        return {
          player_id:          dbId,
          runs:               s.runs,
          balls:              s.balls,
          fours:              s.fours,
          sixes:              s.sixes,
          wickets:            s.wickets,
          overs:              s.overs,
          runs_conceded:      s.runs_conceded,
          maidens:            s.maidens,
          catches:            s.catches,
          stumpings:          s.stumpings,
          runouts_direct:     s.runouts,
          is_out:             s.is_out,
          sr_points:          sr_pts,
          er_points:          er_pts,
          milestone_points:   milestone_pts,
          boundary_points:    boundary_pts,
          duck_penalty:       duck_pts,
          involvement_points: involve_pts,
          fantasy_points:     Math.round(pts),
        };
      });

      // ── 7. Send to RPC ─────────────────────────────────────────────────────
      console.log(`Sending ${statsToUpsert.length} player stats to RPC...`);
      const { error: rpcError } = await supabase.rpc("process_live_match_points", {
        p_match_id:      match.id,
        p_tournament_id: match.tournament_id,
        p_stats_rows:    statsToUpsert,
      });

      if (rpcError) console.error(`RPC error for match ${match.id}:`, rpcError.message);
      else console.log(`✅ RPC success for match ${match.id}`);
    }

    return new Response("Success", { status: 200 });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
});