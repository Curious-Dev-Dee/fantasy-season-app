import { supabase } from "./supabase.js";

async function protectPage() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    console.warn("Auth Guard: No session found. Redirecting to login...");
    window.location.replace("login.html"); 
    return;
  }

  // ❌ DELETED the document.body.classList.remove("loading-state") from here!
  // home.js will handle revealing the UI once data is ready.
  
  const event = new CustomEvent('auth-verified', { 
    detail: { user: session.user } 
  });
  window.dispatchEvent(event);
}

protectPage();

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("login.html");
  }
});