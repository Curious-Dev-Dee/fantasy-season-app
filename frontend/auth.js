import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const spinner = document.querySelector(".spinner");
const btnText = document.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

/* =========================
   THE GATEKEEPER PATTERN (Fixes FOUC)
   ========================= */
// We check the session immediately. 
// 1. If User exists -> Redirect immediately (User sees nothing)
// 2. If No User -> Fade in the login screen (User sees login)

supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) {
    // User is already logged in, go to home
    window.location.replace("/home.html"); 
  } else {
    // User is NOT logged in, show the UI gracefully
    if (authContainer) authContainer.style.opacity = "1";
    
    // Set up the listener for future changes (like after they return from Google)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        window.location.replace("/home.html");
      }
    });
  }
});

/* =========================
   UI STATE LOGIC
   ========================= */
function setAuthLoading(isLoading) {
  if (!googleBtn) return;
  
  googleBtn.disabled = isLoading;
  
  if (isLoading) {
    spinner?.classList.remove("hidden");
    if (btnText) btnText.textContent = "Verifying...";
    if (errorEl) errorEl.style.display = "none";
  } else {
    spinner?.classList.add("hidden");
    if (btnText) btnText.textContent = "Continue with Google";
  }
}

/* =========================
   GOOGLE SIGN IN
   ========================= */
async function signInWithGoogle() {
  try {
    setAuthLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Since you are on Vercel, this is safer than window.location.origin
        // Ensure this URL is exactly listed in Supabase Dashboard > Auth > URL Configuration
        redirectTo: `${window.location.origin}/home.html`, 
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) throw error;

  } catch (err) {
    console.error("Auth Error:", err);
    setAuthLoading(false);
    
    if (errorEl) {
      errorEl.textContent = err.message || "Sign-in failed. Please try again.";
      errorEl.style.display = "block";
    }
  }
}

/* =========================
   EVENT LISTENERS
   ========================= */
if (googleBtn) {
  googleBtn.addEventListener("click", signInWithGoogle);
}

// Mobile Safari Fix: Re-enable button if user swipes 'back'
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    setAuthLoading(false);
  }
});