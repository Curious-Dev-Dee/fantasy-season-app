import { supabase } from "./supabase.js";

async function protectPage() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.replace("/login");
    return;
  }

  // Remove the loading state once verified
  document.body.classList.remove("loading-state");
  document.body.classList.add("loaded");
  
  // Custom event for home.js to start loading data 
  const event = new CustomEvent('auth-verified', { 
    detail: { user: session.user } 
  });
  window.dispatchEvent(event);
}

protectPage();

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("/login");
  }
});