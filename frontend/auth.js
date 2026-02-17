import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

/* =========================
   1. IMMEDIATE UI RENDER
   Show UI instantly. Don't wait for Supabase.
   This fixes the "White Screen" on mobile.
========================= */
if (authContainer) authContainer.classList.remove("hidden");

async function checkSession() {
  // Check local session only (Instant)
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // User is already logged in. Redirect immediately.
    window.location.replace("home.html");
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
        // This handles both localhost and Vercel automatically
        redirectTo: `${window.location.origin}/home.html`,
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