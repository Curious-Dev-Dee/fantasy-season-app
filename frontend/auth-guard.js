import { supabase } from "./supabase.js";

async function protectPage() {
  // 1. Check session locally first (Fast)
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // Not logged in? Send back to login.
    window.location.replace("login.html");
    return;
  }

  // 2. Logged in? Reveal the page.
  document.body.classList.remove("loading-state");
  console.log("Welcome back:", session.user.email);
}

protectPage();

// Watch for logout in other tabs
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("login.html");
  }
});