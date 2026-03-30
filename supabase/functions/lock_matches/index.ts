import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- IPL 2026 CONFIGURATION ---
const PLAYOFF_START = 71;
const KNOCKOUT_PHASE = 72;   // Match 72 = Start of the 10-sub pool
const BOOSTER_WINDOW_START = 2; 
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
      .select("id")
      .lte("actual_start_time", now) 
      .eq("lock_processed", false)
      .eq("status", "upcoming");

    if (matchError) throw matchError;

    let lockedCount = 0;
    const failedMatchIds: string[] = [];

    for (const match of matches ?? []) {
      const { data, error } = await supabase.rpc("lock_match_atomic", {
        p_match_id: match.id,
        p_playoff_start: PLAYOFF_START,
        p_knockout_phase: KNOCKOUT_PHASE,
        p_booster_window_start: BOOSTER_WINDOW_START,
        p_booster_window_end: BOOSTER_WINDOW_END,
      });

      if (error) {
        failedMatchIds.push(match.id);
        console.error(`Atomic lock failed for match ${match.id}`, error);
        continue;
      }

      if (data?.locked) {
        lockedCount += 1;
      }
    }

    return new Response(
      JSON.stringify({
        status: failedMatchIds.length === 0 ? "ok" : "partial",
        locked: lockedCount,
        failed_match_ids: failedMatchIds,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response("Lock failed", { status: 500 });
  }
});
