import { supabase } from "./supabase.js";

async function protectPage() {
  // 1. Check Session
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    console.warn("Auth Guard: No session found. Redirecting to login...");
    // FIX: Redirect specifically to login.html instead of the deleted root/index
    window.location.replace("login.html"); 
    return;
  }

  // 2. Unlock the UI (Remove the white screen/spinner)
  // This matches your body class in home.html
  document.body.classList.remove("loading-state");
  
  // 3. FIRE THE STARTING GUN
  const event = new CustomEvent('auth-verified', { 
    detail: { user: session.user } 
  });
  window.dispatchEvent(event);
  
  console.log("Auth Guard: User verified", session.user.email);
}

// Run immediately
protectPage();

// Logout Listener: If they log out in another tab, kick them out here.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    // FIX: Redirect specifically to login.html
    window.location.replace("login.html");
  }
});