import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

/* =========================
   1. IMMEDIATE UI RENDER
========================= */
// Prevent white screen by showing UI immediately
if (authContainer) authContainer.classList.remove("hidden");

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // SENIOR DEV FIX: Redirect to Clean URL '/home'
    window.location.replace("/home");
  }
}

// Run check silently
checkSession();

/* =========================
   2. LOGIN LOGIC
========================= */
async function signInWithGoogle() {
  try {
    if (googleBtn) {
        googleBtn.disabled = true;
        if (btnText) btnText.textContent = "Connecting...";
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        /* CRITICAL: This sends the user to https://your-app.vercel.app/home
           Supabase MUST have this URL whitelisted in the dashboard.
        */
        redirectTo: `${window.location.origin}/home`,
      },
    });

    if (error) throw error;

  } catch (err) {
    console.error("Auth Error:", err);
    if (googleBtn) {
        googleBtn.disabled = false;
        if (btnText) btnText.textContent = "Continue with Google";
    }
    if (errorEl) {
      errorEl.textContent = "Login failed. Please try again.";
      errorEl.style.display = "block";
    }
  }
}

googleBtn?.addEventListener("click", signInWithGoogle);