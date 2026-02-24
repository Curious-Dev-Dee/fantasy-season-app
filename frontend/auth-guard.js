import { supabase } from "./supabase.js";

async function protectPage() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // Not logged in? Go to login page
    window.location.replace("/login");
    return;
  }

  // Verification successful: Reveal the page
  document.body.classList.remove("loading-state");
  document.body.classList.add("loaded");
  
  // Signal home.js that user is ready
  const event = new CustomEvent('auth-verified', { detail: { user: session.user } });
  window.dispatchEvent(event);
}

// Run immediately on page load
protectPage();

// Monitor logout from other tabs
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("/login");
  }
});