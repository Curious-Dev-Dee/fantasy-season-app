import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

// Force UI to show immediately to prevent stuck loading screens
if (authContainer) authContainer.classList.remove("hidden");

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    // Redirect to clean URL '/home'
    window.location.replace("/home");
  }
}

checkSession();

async function signInWithGoogle() {
  try {
    if (googleBtn) {
        googleBtn.disabled = true;
        if (btnText) btnText.textContent = "Connecting...";
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // IMPORTANT: Must match the "Redirect URI" in Supabase & Google Console
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