import { supabase } from "./supabase.js";

async function protectPage() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const user = session.user;

  // Ensure profile exists
  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingProfile) {
    await supabase.from("user_profiles").insert({
      user_id: user.id,
      display_name:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email,
      is_active: true,
    });
  }
}

protectPage();
