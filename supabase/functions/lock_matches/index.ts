import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      // FIX: Now checks against the Actual Start Time (handles rain delays)
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

  const { data: teams, error: teamError } = await supabase
    .from("user_fantasy_teams")
    .select(`
      id,
      user_id,
      captain_id,
      vice_captain_id,
      total_credits,
      user_fantasy_team_players(player_id)
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

async function lockUserTeamForMatch(
  supabase: any,
  match: any,
  team: any
) {
  // 1. Prevent double snapshots
  const { data: existing } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .eq("match_id", match.id)
    .maybeSingle();

  if (existing) return;

  // 2. Fetch the most recent snapshot for sub-comparison
  // ... (inside lockUserTeamForMatch)
const { data: lastSnapshot } = await supabase
    .from("user_match_teams")
    .select("id, total_subs_used")
    .eq("user_id", team.user_id)
    .neq("match_id", match.id) // <--- ADD THIS LINE
    .order("locked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousPlayers = lastSnapshot
    ? await getSnapshotPlayers(supabase, lastSnapshot.id)
    : [];

  const currentPlayers = team.user_fantasy_team_players.map(
    (p: any) => p.player_id
  );

  // 3. ENHANCED SUB LOGIC
  // 3. ENHANCED SUB LOGIC (Stage-Aware)
  let subsUsed = 0;
  let totalSubsUsed = 0;

  // Define Stage Boundaries
  const isSuper8 = match.match_number >= 41 && match.match_number < 53;
  const isKnockout = match.match_number >= 53;

  // Check if the user has ALREADY locked a team in this stage
  const { data: stageHistory } = await supabase
    .from("user_match_teams")
    .select("id")
    .eq("user_id", team.user_id)
    .gte("match_id", isKnockout ? 'YOUR_MATCH_53_UUID' : (isSuper8 ? 'YOUR_MATCH_41_UUID' : 'YOUR_MATCH_1_UUID')) // Use actual IDs if possible, or keep match_number logic
    .maybeSingle();

  // THE FIX: If it's the start of a stage OR the user has no history in this stage yet
  const isFirstActiveMatchOfStage = !stageHistory;

  if (isFirstActiveMatchOfStage && (isSuper8 || isKnockout)) {
    subsUsed = 0;      // "Free 11" logic
    totalSubsUsed = 0; // Reset total
  } else if (lastSnapshot) {
    subsUsed = currentPlayers.filter(
      (p: string) => !previousPlayers.includes(p)
    ).length;

    // Special Case: If moving from Group -> Super 8 for the first time
    if (isSuper8 && lastSnapshot.match_number < 41) {
        totalSubsUsed = subsUsed; 
    } else {
        totalSubsUsed = lastSnapshot.total_subs_used + subsUsed;
    }
  }
  // 4. BOOSTER TRACKING
  // Only allow Booster activation from Match 43 to Match 52
  let boosterToApply = false;
  if (match.match_number >= 43 && match.match_number <= 52) {
    boosterToApply = team.use_booster || false;
  }

  // 5. Create the Snapshot
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
      use_booster: boosterToApply, // NEW: Locks the booster choice
      locked_at: match.actual_start_time,
    })
    .select()
    .single();

  if (error) {
    console.error("Snapshot insert failed", error);
    return;
  }

  // 6. If Booster was used, mark it permanently in the user's tournament record
  if (boosterToApply) {
    await supabase
      .from("user_tournament_points")
      .update({ s8_booster_used: true })
      .eq("user_id", team.user_id)
      .eq("tournament_id", match.tournament_id);
  }

  const rows = currentPlayers.map((playerId: string) => ({
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