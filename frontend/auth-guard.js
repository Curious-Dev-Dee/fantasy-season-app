import { supabase } from "./supabase.js";

async function protectPage() {
  // 1. Check Session
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // Not logged in? Go to root (login)
    window.location.replace("/");
    return;
  }

  // 2. Unlock the UI (Remove the white screen/spinner)
  document.body.classList.remove("loading-state");
  
  // 3. FIRE THE STARTING GUN
  // This tells home.js (and others) "User is safe, load the data now!"
  const event = new CustomEvent('auth-verified', { detail: { user: session.user } });
  window.dispatchEvent(event);
  
  console.log("Auth Guard: User verified", session.user.email);
}

// Run immediately
protectPage();

// Logout Listener: If they log out in another tab, kick them out here.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("/");
  }
});