import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- IPL 2026 CONFIGURATION ---
const LEAGUE_STAGE_END = 70;
const PLAYOFF_START = 71;
const KNOCKOUT_PHASE = 72;   // Match 72 = Start of the 10-sub pool
const BOOSTER_WINDOW_START = 11; 
const BOOSTER_WINDOW_END = 70;

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const now = new Date().toISOString();

    const { data: matches, error: matchError } = await supabase
      .from("matches")
      .select("*")
      .lte("actual_start_time", now) 
      .eq("lock_processed", false)
      .eq("status", "upcoming");

    if (matchError) throw matchError;

    for (const match of matches ?? []) {
      await lockSingleMatch(supabase, match);
    }

    return new Response(
      JSON.stringify({ status: "ok", locked: matches?.length ?? 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response("Lock failed", { status: 500 });
  }
});

async function lockSingleMatch(supabase: any, match: any) {
  console.log(`Locking match ${match.id}`);

  const { error: lockError } = await supabase
    .from("matches")
    .update({
      status: "locked",
      lock_processed: true,
      locked_at: new Date().toISOString(),
    })
    .eq("id", match.id)
    .eq("lock_processed", false);

  if (lockError) {
    console.error("Match lock failed", lockError);
    return;
  }

  // DELETE the old select and PASTE this:
const { data: teams, error: teamError } = await supabase
    .from("user_fantasy_teams")
    .select(`
      id,
      user_id,
      captain_id,
      vice_captain_id,
      total_credits,
      active_booster, 
      user_fantasy_team_players(
        player_id, 
        players(category)
      )
    `)
    .eq("tournament_id", match.tournament_id);

  if (teamError) {
    console.error("Fetching teams failed", teamError);
    return;
  }

  for (const team of teams ?? []) {
    await lockUserTeamForMatch(supabase, match, team);
  }
}

async function lockUserTeamForMatch(supabase: any, match: any, team: any) {
  // 1. Safety Check: Don't lock twice
  const { data: existing } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("match_id", match.id)
    .maybeSingle();

  if (existing) return;

  // 2. Fetch History to calculate subs
  const { data: lastSnapshot } = await supabase
    .from("user_match_teams")
    .select(`id, match_id, total_subs_used, matches!inner(match_number)`)
    .eq("user_id", team.user_id)
    .neq("match_id", match.id)
    .order("locked_at", { ascending: false }).limit(1).maybeSingle();

  // 3. Organize current players and their categories
  const currentPlayersInfo = (team.user_fantasy_team_players ?? []).map((p: any) => ({
    id: p.player_id,
    category: p.players?.category 
  }));
  const currentIds = currentPlayersInfo.map(p => p.id);
  const previousPlayers = lastSnapshot ? await getSnapshotPlayers(supabase, lastSnapshot.id) : [];

  // 4. Calculate Sub Cost with "Free Uncapped" Rule
  const newPlayers = currentPlayersInfo.filter((p: any) => !previousPlayers.includes(p.id));
  const hasUncappedDiscount = newPlayers.some((p: any) => p.category === "uncapped");
  const rawChangeCount = newPlayers.length;

  let subsUsed = 0;
  const matchNum = match.match_number;

  if (matchNum === 1 || matchNum === PLAYOFF_START) {
    subsUsed = 0; // Unlimited matches
  } else {
    // Apply the "Free 1 Uncapped per match" discount
    subsUsed = (hasUncappedDiscount && rawChangeCount > 0) ? rawChangeCount - 1 : rawChangeCount;
  }

  // 5. BOOSTER LOGIC: Apply and "Burn"
  let finalBoosterToApply = 'NONE';
  if (matchNum >= BOOSTER_WINDOW_START && matchNum <= BOOSTER_WINDOW_END && team.active_booster !== 'NONE') {
      
      const { data: ptData } = await supabase
        .from("user_tournament_points")
        .select("used_boosters")
        .eq("user_id", team.user_id)
        .eq("tournament_id", match.tournament_id)
        .maybeSingle();
        
      const currentUsedBoosters = ptData?.used_boosters || [];
      
      // Only apply if they haven't used this specific one before
      if (!currentUsedBoosters.includes(team.active_booster)) {
          finalBoosterToApply = team.active_booster;
          
          // RULE: FREE_11 makes this match's subs cost zero
          if (finalBoosterToApply === 'FREE_11') {
              subsUsed = 0;
          }
          
          // Mark this booster as SPENT in the database
          currentUsedBoosters.push(finalBoosterToApply);
          await supabase
            .from("user_tournament_points")
            .update({ used_boosters: currentUsedBoosters })
            .eq("user_id", team.user_id)
            .eq("tournament_id", match.tournament_id);
      }
  }

  // 6. Final Sub Totals
  let totalSubsUsed = 0;
  if (matchNum === 1 || matchNum === PLAYOFF_START) {
      totalSubsUsed = 0;
  } else if (matchNum === KNOCKOUT_PHASE) {
      totalSubsUsed = subsUsed; // Reset count for Match 72 pool
  } else if (lastSnapshot) {
      totalSubsUsed = (lastSnapshot.total_subs_used ?? 0) + subsUsed;
  }

  // 7. Save the Match Snapshot
  const { data: snapshot, error } = await supabase
    .from("user_match_teams")
    .insert({
      user_id: team.user_id,
      match_id: match.id,
      tournament_id: match.tournament_id,
      captain_id: team.captain_id,
      vice_captain_id: team.vice_captain_id,
      total_credits: team.total_credits,
      subs_used_for_match: subsUsed,
      total_subs_used: totalSubsUsed,
      active_booster: finalBoosterToApply, // NEW: Record the booster name
      locked_at: match.actual_start_time,
    })
    .select().single();

  if (error) {
    console.error("Snapshot insert failed", error);
    return;
  }

  // 8. Save the players list for history
  const rows = currentIds.map((playerId: string) => ({
    user_match_team_id: snapshot.id,
    player_id: playerId,
  }));
  await supabase.from("user_match_team_players").insert(rows);
}

async function getSnapshotPlayers(supabase: any, snapshotId: string) {
  const { data } = await supabase
    .from("user_match_team_players")
    .select("player_id")
    .eq("user_match_team_id", snapshotId);

  return data?.map((d) => d.player_id) ?? [];
}