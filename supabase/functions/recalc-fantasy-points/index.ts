import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("https://tuvqgcosbweljslbfgqc.supabase.co")!,
    Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY1OTI1OCwiZXhwIjoyMDg2MjM1MjU4fQ.ZqeBiAlM9dem6bn-TM3hDrw1tSb7xSp_rAK6zYYrXkE")!
  );

  // Recalculate batting scorecards from ppl_deliveries
  const { error } = await supabase.rpc('recalc_all_player_match_points');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
});